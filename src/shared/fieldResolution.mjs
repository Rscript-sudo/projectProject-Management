const PROJECT_FIELD_RE = /^(项目|工程)(名称|编号|代码|类型)$|^(建设|施工|监理|承建|业主|甲方|乙方)单位$|总监/
const DATE_FIELD_RE = /(日期|时间|星期|周数|月份|报告期|日期范围)$/
const WEATHER_FIELD_RE = /天气|气温|温度/
const PERSON_FIELD_RE = /人员|姓名|主持人|记录人|编制人|审核人|批准人|负责人/
const QUANTITY_FIELD_RE = /数量|工程量|金额|比例|统计|明细|累计/
const APPROVAL_FIELD_RE = /签字|签章|审批|批准|审核结论|是否同意|支付决定/
const LOCATION_FIELD_RE = /部位|地点|位置|区域|区段|点位|地址/
const NARRATIVE_FIELD_RE = /内容|情况|落实|说明|问题|计划|建议|措施|要求|分析|概况|进度|风险|事项|意见|范围|目标|方法|制度/

const UNIT_RE = /(公里|千米|米|延米|平方米|立方米|吨|千克|公斤|台|套|个|处|项|段|芯|孔|樘|根|块|万元|元|%)/

export const FIELD_CONTRACT_SCHEMA_VERSION = 2

export function normalizeFieldName(value = '') {
  return String(value).replace(/^\{\{|\}\}$/g, '').trim()
}

export function inferSemanticType(field = '') {
  const name = normalizeFieldName(field)
  if (APPROVAL_FIELD_RE.test(name)) return 'approval'
  if (WEATHER_FIELD_RE.test(name)) return 'weather'
  if (PROJECT_FIELD_RE.test(name)) return 'project'
  if (DATE_FIELD_RE.test(name)) return 'date'
  if (PERSON_FIELD_RE.test(name)) return 'person'
  if (QUANTITY_FIELD_RE.test(name)) return 'quantity'
  if (LOCATION_FIELD_RE.test(name)) return 'location'
  if (NARRATIVE_FIELD_RE.test(name)) return 'narrative'
  return 'text'
}

function defaultPolicy(type) {
  switch (type) {
    case 'project': return { fillMode: 'project-data', expansionLevel: 'exact', missingPolicy: 'soft-warning' }
    case 'date': return { fillMode: 'system-computed', expansionLevel: 'normalize', missingPolicy: 'soft-warning' }
    case 'weather': return { fillMode: 'external-data', expansionLevel: 'exact', missingPolicy: 'auto-query' }
    case 'person': return { fillMode: 'fact-extraction', expansionLevel: 'exact', missingPolicy: 'leave-empty' }
    case 'quantity': return { fillMode: 'fact-extraction', expansionLevel: 'exact', missingPolicy: 'leave-empty' }
    case 'location': return { fillMode: 'fact-extraction', expansionLevel: 'summarize', missingPolicy: 'soft-warning' }
    case 'approval': return { fillMode: 'manual', expansionLevel: 'none', missingPolicy: 'leave-empty' }
    case 'narrative': return { fillMode: 'ai-expansion', expansionLevel: 'contextual', missingPolicy: 'soft-warning' }
    default: return { fillMode: 'fact-extraction', expansionLevel: 'normalize', missingPolicy: 'leave-empty' }
  }
}

function modeToFillMode(mode, semanticType) {
  if (mode === 'project') return 'project-data'
  if (mode === 'system') return semanticType === 'weather' ? 'external-data' : 'system-computed'
  if (mode === 'keep' || mode === 'manual') return 'manual'
  if (mode === 'ai') return semanticType === 'narrative' ? 'ai-expansion' : 'fact-extraction'
  return defaultPolicy(semanticType).fillMode
}

export function buildFieldContract(field, configured = {}) {
  const key = normalizeFieldName(field)
  const semanticType = configured.semanticType || inferSemanticType(key)
  const defaults = defaultPolicy(semanticType)
  const fillMode = configured.fillMode || modeToFillMode(configured.mode, semanticType)
  const expansionLevel = configured.expansionLevel || (fillMode === 'ai-expansion' ? 'contextual' : defaults.expansionLevel)
  return {
    schemaVersion: FIELD_CONTRACT_SCHEMA_VERSION,
    key,
    label: configured.label || key,
    semanticType,
    fillMode,
    expansionLevel,
    sourcePriority: configured.sourcePriority || sourcePriorityFor(semanticType),
    dependencies: configured.dependencies || dependenciesFor(semanticType),
    requiredForGeneration: configured.requiredForGeneration === true,
    requiredForDelivery: configured.requiredForDelivery === true || configured.required === true,
    missingPolicy: configured.missingPolicy || configured.missingInfoPolicy || defaults.missingPolicy,
    source: configured.source || '',
    requirement: configured.requirement || '',
    minWords: Math.max(0, Number(configured.minWords) || 0),
    maxWords: Math.max(0, Number(configured.maxWords) || (semanticType === 'narrative' ? 300 : 80)),
    antiFabrication: configured.antiFabrication !== false,
    projectTypeConstraint: semanticType === 'narrative' || semanticType === 'location',
    forbiddenAssertions: forbiddenFor(semanticType),
  }
}

export function buildFieldConfigsFromPrompt(prompt = {}, fields = []) {
  const saved = prompt?.extras?.fieldConfigs || {}
  const systemTemplate = String(prompt?.systemTemplate || '')
  const result = {}
  for (const rawField of fields) {
    const field = normalizeFieldName(rawField)
    if (!field) continue
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const requirement = systemTemplate.match(new RegExp(`- 【${escaped}】([^\\n]*)`))?.[1]?.replace(/^[:：]\s*/, '').trim() || ''
    const contract = buildFieldContract(field, { ...(saved[field] || {}), requirement: saved[field]?.requirement || requirement })
    result[field] = {
      mode: contract.fillMode === 'ai-expansion' ? 'ai' : contract.fillMode === 'manual' ? 'keep' : contract.fillMode === 'system-computed' || contract.fillMode === 'external-data' ? 'system' : contract.fillMode === 'project-data' ? 'project' : 'ai',
      source: contract.source,
      requirement: contract.requirement,
      required: contract.requiredForDelivery,
      minWords: contract.minWords,
      maxWords: contract.maxWords,
      antiFabrication: contract.antiFabrication,
      missingInfoPolicy: contract.missingPolicy === '待确认' ? '待确认' : '留空',
      semanticType: contract.semanticType,
      fillMode: contract.fillMode,
      expansionLevel: contract.expansionLevel,
      requiredForGeneration: contract.requiredForGeneration,
      requiredForDelivery: contract.requiredForDelivery,
      sourcePriority: contract.sourcePriority,
      dependencies: contract.dependencies,
      forbiddenAssertions: contract.forbiddenAssertions,
    }
  }
  return result
}

function sourcePriorityFor(type) {
  if (type === 'project') return ['manual-confirmed', 'project-data']
  if (type === 'weather') return ['user-input', 'attached-record', 'external-data']
  if (type === 'date') return ['user-input', 'attached-record', 'system-computed']
  if (type === 'approval') return ['manual-confirmed']
  return ['user-input', 'attached-record', 'project-ledger', 'ai-expansion']
}

function dependenciesFor(type) {
  if (type === 'weather') return ['businessDate', 'implementationArea']
  if (type === 'date') return ['businessDate']
  return []
}

function forbiddenFor(type) {
  const common = ['未提供的时间、地点、人员、单位、数量、金额、比例、责任归属或条款号']
  if (type === 'approval') return [...common, '任何审批、批准、签发、支付或流程决定']
  if (type === 'narrative') return [...common, '未经来源支持的检查结果、整改结果、协调结果或合格结论', '把建议或后续关注点写成已经发生的事实']
  if (type === 'weather') return ['根据季节、城市或常识猜测天气和气温', '把预报写成历史实况']
  return common
}

export function buildFactPool(input = '', { project = {}, autoValues = {}, provenance = {} } = {}) {
  const rawInput = String(input || '').trim()
  const structured = {}
  for (const match of rawInput.matchAll(/【([^】]{1,40})】\s*([^【]+)/g)) {
    const key = normalizeFieldName(match[1])
    const value = String(match[2] || '').trim()
    if (key && value) structured[key] = value
  }
  const quantities = []
  const quantityRe = new RegExp(`([\u4e00-\u9fa5A-Za-z0-9（）()、/-]{0,24}?)(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE.source}`, 'g')
  for (const match of rawInput.matchAll(quantityRe)) {
    quantities.push({ context: String(match[1] || '').trim(), value: Number(match[2]), unit: match[3], source: 'user-input', exact: match[0].trim() })
  }
  const weather = rawInput.match(/(?:天气|气象)[为：:]?\s*(晴|多云|阴|小雨|中雨|大雨|阵雨|雷阵雨|小雪|中雪|大雪|雾|霾)/)?.[1]
    || rawInput.match(/(?:^|[，。；、\s])(晴|多云|阴|小雨|中雨|大雨|阵雨|雷阵雨|小雪|中雪|大雪|雾|霾)(?:[，。；、\s]|$)/)?.[1]
  const temperature = rawInput.match(/(-?\d+(?:\.\d+)?)\s*(?:~|～|至|—|-)\s*(-?\d+(?:\.\d+)?)\s*℃/)?.[0]
    || rawInput.match(/-?\d+(?:\.\d+)?\s*℃/)?.[0]
  const explicitDate = rawInput.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/)?.[0]
  return {
    schemaVersion: 1,
    rawInput,
    structured,
    quantities,
    explicitDate: explicitDate || '',
    project: Object.fromEntries(Object.entries(project || {}).filter(([, value]) => value != null && String(value).trim())),
    automatic: { ...autoValues },
    provenance: { ...provenance },
    explicit: { ...(weather ? { 天气: weather } : {}), ...(temperature ? { 气温: temperature } : {}) },
  }
}

export function buildFieldResolutionPlan(fields = [], { fieldConfigs = {}, factPool = {} } = {}) {
  return fields.map(field => {
    const key = normalizeFieldName(field)
    const contract = buildFieldContract(key, fieldConfigs[key] || {})
    const value = resolveKnownValue(key, contract, factPool)
    return {
      field: key,
      contract,
      value: value?.value || '',
      source: value?.source || '',
      provenance: value?.provenance || null,
      // 叙述字段中的用户内容是扩写种子，不是最终成稿；确定值仍作为事实边界注入提示。
      status: contract.fillMode === 'ai-expansion' ? 'expand' : value?.value ? 'resolved' : contract.fillMode === 'manual' ? 'manual' : 'unresolved',
    }
  })
}

function resolveKnownValue(field, contract, pool) {
  if (pool.structured?.[field]) return { value: pool.structured[field], source: 'user-input' }
  if (pool.explicit?.[field]) return { value: pool.explicit[field], source: 'user-input' }
  if (pool.automatic?.[field]) return { value: pool.automatic[field], source: 'automatic', provenance: pool.provenance?.[field] }
  if (contract.semanticType === 'weather') {
    const isTemperature = /气温|温度/.test(field)
    const alias = isTemperature ? '气温' : '天气'
    if (pool.explicit?.[alias]) return { value: pool.explicit[alias], source: 'user-input' }
    if (pool.automatic?.[alias]) return { value: pool.automatic[alias], source: 'automatic', provenance: pool.provenance?.[alias] }
  }
  if (contract.semanticType === 'project') {
    const aliases = {
      项目名称: 'projectName', 工程名称: 'projectName', 项目类型: 'projectType', 工程类型: 'projectType',
      建设单位: 'ownerUnit', 甲方单位: 'ownerUnit', 施工单位: 'contractor', 乙方单位: 'contractor',
      监理单位: 'supervisorUnit', 总监姓名: 'chiefEngineer', 总监理工程师: 'chiefEngineer', 项目代码: 'projectCode', 项目编号: 'projectCode',
    }
    const value = pool.project?.[aliases[field] || field]
    if (value) return { value: String(value), source: 'project-data' }
  }
  return null
}

export function formatResolutionContext(factPool, plan) {
  const resolved = plan.filter(item => item.value).map(item => `- 【${item.field}】${item.value}（来源：${item.source}）`)
  const expand = plan.filter(item => item.status === 'expand').map(item => {
    const c = item.contract
    return `- 【${item.field}】允许${c.expansionLevel}扩写；要求：${c.requirement || '围绕已知事实作简洁、准确、可交付的书面化整理'}；禁止：${c.forbiddenAssertions.join('；')}`
  })
  const unresolved = plan.filter(item => item.status === 'unresolved').map(item => `【${item.field}】`)
  return `【字段解析计划——程序生成，优先于一般写作提示】
用户只需提供已知事实，不要求逐字段填写。不得因普通字段缺失而反问后停止或拒绝生成。

【本次原始事实】
${factPool.rawInput || '未提供'}

【已解析确定值】
${resolved.join('\n') || '无'}

【允许 AI 扩写字段】
${expand.join('\n') || '无'}

【未取得确定事实的字段】
${unresolved.join('、') || '无'}
这些字段按合同留空或软提醒；不得补造。项目类型仅约束术语、工序和控制重点，不得限制生成。`
}

export function mergeResolvedFields(content = '', plan = []) {
  let result = String(content || '').trim()
  const additions = []
  for (const item of plan) {
    if (!item.value || item.contract.fillMode === 'manual' || item.contract.fillMode === 'ai-expansion') continue
    const escaped = item.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fieldRe = new RegExp(`【${escaped}】[^\\r\\n]*`)
    const existing = result.match(fieldRe)
    if (existing) {
      // 确定来源值始终优先于模型文本，防止模型改写日期、天气、数量或项目主数据。
      result = result.replace(fieldRe, `【${item.field}】${item.value}`)
      continue
    }
    additions.push(`【${item.field}】${item.value}`)
  }
  return additions.length ? `${result}\n\n${additions.join('\n')}`.trim() : result
}

/** 私人/企业实体模板只消费已登记字段；丢弃模型额外生成且模板会忽略的段落。 */
export function retainTemplateFields(content = '', fields = []) {
  const allowed = new Set(fields.map(normalizeFieldName).filter(Boolean))
  if (!allowed.size) return String(content || '').trim()
  const source = String(content || '')
  const markers = [...source.matchAll(/【([^】]+)】/g)]
  const parts = []
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    const key = normalizeFieldName(marker[1])
    if (!allowed.has(key) || marker.index == null) continue
    const next = markers[index + 1]
    const end = next?.index ?? source.length
    parts.push(source.slice(marker.index, end).trim())
  }
  return parts.join('\n').trim()
}

export function setStructuredFieldValue(content = '', field = '', value = '') {
  const key = normalizeFieldName(field)
  if (!key) return String(content || '')
  const normalizedValue = String(value || '').trim()
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fieldRe = new RegExp(`【${escaped}】[\\s\\S]*?(?=\\n?【[^】]+】|$)`)
  const replacement = `【${key}】${normalizedValue}`
  const source = String(content || '').trim()
  if (fieldRe.test(source)) return source.replace(fieldRe, replacement).trim()
  return `${source}${source ? '\n\n' : ''}${replacement}`.trim()
}

export function updateFieldPlanValue(plan = [], field = '', value = '', source = 'manual-confirmed') {
  const key = normalizeFieldName(field)
  const normalizedValue = String(value || '').trim()
  return (plan || []).map(item => item.field !== key ? item : {
    ...item,
    value: normalizedValue,
    source: normalizedValue ? source : '',
    provenance: normalizedValue ? { source, updatedAt: new Date().toISOString() } : null,
    status: normalizedValue ? 'resolved' : item.contract?.fillMode === 'manual' ? 'manual' : item.contract?.fillMode === 'ai-expansion' ? 'expand' : 'unresolved',
  })
}

export function getPendingFieldPlan(plan = []) {
  return (plan || []).filter(item => !String(item.value || '').trim() && (item.status === 'unresolved' || item.status === 'manual'))
}

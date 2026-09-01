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
  // 用户通常会一次性输入“检查地点：…；段落名称：…；进场材料：…”，
  // 而不是逐个填写【字段】。把这类常见标签解析成模板真相源，并同步到
  // 复合资料包的表格字段，避免事实只出现在长段落、对应单元格却为空。
  const inlineFacts = {}
  for (const match of rawInput.matchAll(/(?:^|[。；;\n])\s*([^：:；;。\n]{1,24})[:：]\s*([^；;。\n]+)/g)) {
    const key = normalizeFieldName(match[1])
    const value = String(match[2] || '').trim()
    if (key && value) inlineFacts[key] = value
  }
  const firstFact = (...keys) => keys.map(key => inlineFacts[key] || structured[key]).find(Boolean) || ''
  const location = firstFact('检查地点', '施工地点', '工程地点')
  const section = firstFact('段落名称', '施工段落')
  const contractor = firstFact('施工单位', '承建单位')
  const material = firstFact('进场材料', '材料')
  const completedWork = firstFact('当日完成', '当日工作', '施工情况')
  if (location) Object.assign(structured, { 检查地点: location, 施工地点: location, 工程地点: location, 表格行检查地点: location })
  if (section) structured.段落名称 = section
  if (contractor) structured.施工单位 = contractor
  if (material) {
    const materialName = material.match(/([A-Za-z0-9.-]+\s*(?:型)?(?:光缆|电缆|设备|材料)?)/)?.[1]?.trim() || material.split(/[，,]/)[0].trim()
    const amount = material.match(new RegExp(`\\d+(?:\\.\\d+)?\\s*${UNIT_RE.source}`))?.[0] || ''
    const method = material.match(/(?:外观|抽样|见证|平行|开箱|实测)[^，,]{0,8}(?:检查|检验|检测|验收)/)?.[0] || ''
    const opinion = /不合格/.test(material) ? '不合格' : /合格/.test(material) ? '合格' : ''
    Object.assign(structured, {
      材料: material,
      材料进出场情况: material,
      '表格行设备/材料': materialName,
      '表格行规格、型号': materialName,
      ...(amount ? { 表格行数量: amount } : {}),
      ...(method ? { 表格行检查方式: method } : {}),
      ...(opinion ? { 表格行检查意见: opinion } : {}),
    })
  }
  if (completedWork) Object.assign(structured, { 施工情况: completedWork, 施工当日完成主要工作量: completedWork })
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
  // 自动日期/天气只能进入明确配置为系统计算或外部取数的字段。用户模板把
  // “日期/天气”设为事实提取时，缺失就必须留空，不能因为解析器能查到当天
  // 日期或当地天气就覆盖用户的“未提供”。
  const acceptsAutomatic = contract.fillMode === 'system-computed' || contract.fillMode === 'external-data'
  if (acceptsAutomatic && pool.automatic?.[field]) return { value: pool.automatic[field], source: 'automatic', provenance: pool.provenance?.[field] }
  if (contract.semanticType === 'weather') {
    const isTemperature = /气温|温度/.test(field)
    const alias = isTemperature ? '气温' : '天气'
    if (pool.explicit?.[alias]) return { value: pool.explicit[alias], source: 'user-input' }
    if (acceptsAutomatic && pool.automatic?.[alias]) return { value: pool.automatic[alias], source: 'automatic', provenance: pool.provenance?.[alias] }
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
    const escaped = item.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fieldRe = new RegExp(`【${escaped}】[\\s\\S]*?(?=\\n?【[^】]+】|$)`)
    if (item.contract.fillMode === 'manual' || item.status === 'unresolved') {
      // 模型经常会替未解析字段猜一个值。字段计划是最终真相源：人工字段和
      // 未取得事实的字段只保留字段名，等待用户后续补录。
      if (fieldRe.test(result)) result = result.replace(fieldRe, `【${item.field}】`)
      continue
    }
    if (!item.value || item.contract.fillMode === 'ai-expansion') continue
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

const NARRATIVE_SUPPORT_RULES = [
  { field: /问题|异常|缺陷|隐患|整改|汇报处理|跟踪处理/, source: /问题|异常|缺陷|隐患|整改|汇报|处理|跟踪|复查|销项/ },
  { field: /安全|文明施工|风险/, source: /安全|文明施工|风险|防护|临电|围挡|警示|劳保|交底|隐患/ },
  { field: /旁站/, source: /旁站/ },
  { field: /处理意见/, source: /处理|整改|要求|建议|退场|更换/ },
  { field: /检查记录$/, source: /检查|检验|核查|检测|试验/ },
  { field: /发现情况/, source: /发现|检查|检验|核查|检测|合格|不合格|异常|问题/ },
  { field: /^其他情况$/, source: /其他情况|其他事项|补充说明/ },
]

const UNSUPPORTED_CLAIM_RULES = [
  { claim: /包装完整|盘具|盘号|缆[身体](?:完好|无)|端头封堵|标签(?:一致|清晰|齐全)|标识(?:一致|清晰|齐全)|质量证明文件/, source: /包装|盘具|盘号|缆[身体]|损伤|端头|封堵|标签|标识|质量证明/ },
  { claim: /巡视|巡查/, source: /巡视|巡查/ },
  { claim: /旁站/, source: /旁站/ },
  { claim: /核查|核验/, source: /核查|核验/ },
  { claim: /自检|复核|送检|见证取样/, source: /自检|复核|送检|见证取样/ },
  { claim: /施工组织|有序|按计划|施工方案/, source: /施工组织|有序|计划|施工方案/ },
  { claim: /安全|风险|隐患|防护|临电|围挡|警示|劳保|交底/, source: /安全|风险|隐患|防护|临电|围挡|警示|劳保|交底/ },
  { claim: /未发现|暂无异常|无异常|未发生|无需专项|不存在/, source: /未发现|暂无异常|无异常|未发生|无需专项|不存在/ },
  { claim: /首日|初期施工阶段/, source: /首日|初期施工阶段/ },
  { claim: /存放|堆放|标识/, source: /存放|堆放|标识/ },
  { claim: /符合设计|符合规范|具备进场|同意入场|同意使用/, source: /符合设计|符合规范|具备进场|同意入场|同意使用/ },
  { claim: /报验|未见异常|异常|相符|一致|符合|达到|满足|受控|具备|就绪/, source: /报验|未见异常|异常|相符|一致|符合|达到|满足|受控|具备|就绪/ },
  { claim: /光缆开剥|纤芯预留|接头盒定位|熔接衰减|光纤测试|单盘测试/, source: /光缆开剥|纤芯预留|接头盒定位|熔接衰减|光纤测试|单盘测试/ },
  { claim: /按(?:设计|工艺|规范)要求|符合设计要求|满足设计指标|材料质量(?:合格|受控)/, source: /按(?:设计|工艺|规范)要求|符合设计要求|满足设计指标|材料质量(?:合格|受控)/ },
  { claim: /路由(?:位于|走向)|按路由/, source: /路由/ },
]

function explicitlyMissing(field, source) {
  const text = String(source || '')
  if (/(日期|时间)/.test(field) && /未提供[^。；\n]*(?:日期|时间)/.test(text)) return true
  if (/天气|气温|温度/.test(field) && /未提供[^。；\n]*(?:天气|气温|温度)/.test(text)) return true
  if (/人员|姓名|负责人|签字|签章/.test(field) && /未提供[^。；\n]*(?:人员|姓名)/.test(text)) return true
  if (/旁站|检查记录|检查结论|发现情况|处理意见|安全|问题|跟踪/.test(field)
    && /未提供[^。；\n]*(?:其他检查事实|检查事实|检查动作|检测结果|旁站)/.test(text)) return true
  return false
}

function filterUnsupportedSentences(value, source) {
  // 以分句而不是整句为单位清理，避免混合句把用户提供的型号、数量等
  // 可核验事实与模型擅自添加的材料细节一起丢掉。建议性语句不是既成事实。
  const clauses = String(value || '').split(/([，,。！？；;\n])/)
  const kept = []
  for (let index = 0; index < clauses.length; index += 2) {
    const clause = String(clauses[index] || '').trim()
    if (!clause) continue
    const delimiter = clauses[index + 1] || ''
    const recommendation = /^(后续|下一步|建议|应当|应|宜|需|须|继续|持续|监理(?:单位|人员)?将|施工单位应|相关单位应)/.test(clause)
    const unsupported = !recommendation && UNSUPPORTED_CLAIM_RULES.some(rule => rule.claim.test(clause) && !rule.source.test(source))
    if (!unsupported) kept.push(`${clause}${delimiter}`)
  }
  return kept.join('')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[，,]+([。！？；;])/g, '$1')
    .replace(/[，,；;]+$/, '。')
    .trim()
}

function keepRecommendationsOnly(value) {
  const clauses = String(value || '').split(/([。！？；;\n])/)
  const kept = []
  for (let index = 0; index < clauses.length; index += 2) {
    const clause = String(clauses[index] || '').trim()
    if (!clause) continue
    const delimiter = clauses[index + 1] || ''
    if (/^(后续|下一步|建议|应当|应|宜|需|须|继续|持续|监理(?:单位|人员)?将|施工单位应|相关单位应)/.test(clause)) kept.push(`${clause}${delimiter}`)
  }
  return kept.join('').trim()
}

/**
 * 实体模板生成后的字段级事实守门：字段计划比模型文本优先。没有来源支撑的
 * 高风险栏目直接留空；允许扩写的栏目也逐句剔除模型擅自增加的现场动作、
 * 安全结论、材料细节和“未发现问题”等事实性断言。
 */
export function sanitizeGeneratedFieldsByPlan(content = '', plan = [], sourceText = '') {
  let result = String(content || '').trim()
  const source = String(sourceText || '')

  // 无论字段合同是否成功加载，都先执行用户明确声明的事实边界。这样即使
  // 自定义文种的 code/label 映射异常，猜出的日期、天气和现场结论也进不了文档。
  const markers = [...result.matchAll(/【([^】]+)】/g)]
  for (const marker of markers) {
    const field = normalizeFieldName(marker[1])
    if (!field) continue
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fieldRe = new RegExp(`【${escaped}】([\\s\\S]*?)(?=\\n?【[^】]+】|$)`)
    const match = result.match(fieldRe)
    if (!match) continue
    if (explicitlyMissing(field, source)) {
      result = result.replace(fieldRe, `【${field}】`)
      continue
    }
    const noOtherInspectionFacts = /未提供[^。；\n]*(?:其他检查事实|检查事实|检查动作|检测结果)/.test(source)
    if (noOtherInspectionFacts && /综合评价|发现情况|处理意见|其他情况|问题|跟踪处理|安全文明|检查记录/.test(field)) {
      result = result.replace(fieldRe, `【${field}】${keepRecommendationsOnly(match[1].trim())}`)
      continue
    }
    const safeValue = filterUnsupportedSentences(match[1].trim(), source)
    result = result.replace(fieldRe, `【${field}】${safeValue}`)
  }

  for (const item of plan) {
    const field = normalizeFieldName(item.field)
    if (!field) continue
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fieldRe = new RegExp(`【${escaped}】([\\s\\S]*?)(?=\\n?【[^】]+】|$)`)
    const match = result.match(fieldRe)
    if (!match) continue
    if (item.contract?.fillMode === 'manual' || item.status === 'unresolved' || explicitlyMissing(field, source)) {
      result = result.replace(fieldRe, `【${field}】`)
      continue
    }
    if (item.contract?.fillMode !== 'ai-expansion') continue
    const supportRule = NARRATIVE_SUPPORT_RULES.find(rule => rule.field.test(field))
    if (supportRule && !supportRule.source.test(source)) {
      result = result.replace(fieldRe, `【${field}】`)
      continue
    }
    const safeValue = filterUnsupportedSentences(match[1].trim(), source)
    result = result.replace(fieldRe, `【${field}】${safeValue}`)
  }
  return result.trim()
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

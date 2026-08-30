const FIXED_TABLE_HEADER_NAMES = new Set([
  '项目', '序号', '规格型号', '型号规格', '单位', '数量', '设计数量', '实际数量', '备注',
])

const CONTEXTUAL_TIME_FIELD_RE = /(收到|送出|发生|发现|检查|会议|开工|竣工|完成|签收|验收|进场|退场).*(时间|日期)|(时间|日期).*(收到|送出|发生|发现|检查|会议|开工|竣工|完成|签收|验收|进场|退场)/
const AUTO_PROJECT_FIELDS = new Set([
  '项目名称', '工程名称', '项目编号', '文件编号', '编号', '文号',
  '致单位', '致送单位', '建设单位', '建设方', '甲方', '业主单位', '业主',
  '施工单位', '施工单位名称', '乙方', '承建单位',
  '监理单位', '监理公司', '项目监理机构', '监理机构',
  '总监理工程师', '总监姓名', '总监理', '项目类型', '工程类型',
])

/**
 * 模板识别只返回真正需要写值的位置。固定表头即使被模型误标为 ai，也不能变成占位符。
 */
export function normalizeTemplateFieldSuggestions(fields = []) {
  const seen = new Set()
  return fields.map(field => {
    const name = String(field?.name || '').trim()
    if (String(field?.mode || '') === 'project' && !AUTO_PROJECT_FIELDS.has(name)) {
      return {
        ...field,
        mode: 'ai',
        hint: `仅从用户输入或已归档项目资料提取“${name}”；系统没有该字段的确定主数据时不得推测。`,
        rule: {
          ...(field?.rule || {}),
          source: '用户输入或已归档项目资料中的明确记录',
          requirement: `仅提取已明确提供的“${name}”；系统项目主数据没有该字段时按缺失策略处理，不得从相似岗位或单位推测。`,
          required: field?.rule?.required === true,
          minWords: 0,
          maxWords: 80,
          antiFabrication: true,
          missingInfoPolicy: field?.rule?.missingInfoPolicy === '待确认' ? '待确认' : '留空',
        },
      }
    }
    if (String(field?.mode || '') === 'system' && CONTEXTUAL_TIME_FIELD_RE.test(name)) {
      return {
        ...field,
        mode: 'ai',
        hint: `仅从用户输入或项目资料提取“${name}”；未提供时不得用当前时间代替。`,
        rule: {
          ...(field?.rule || {}),
          source: '用户输入或项目资料中的明确记录',
          requirement: `仅提取已明确提供的“${name}”，保留原始日期时间；未提供时按缺失策略处理，不得使用当前系统时间代替。`,
          minWords: 0,
          maxWords: 40,
          antiFabrication: true,
          missingInfoPolicy: field?.rule?.missingInfoPolicy === '待确认' ? '待确认' : '留空',
        },
      }
    }
    return field
  }).filter(field => {
    const name = String(field?.name || '').trim()
    const mode = String(field?.mode || '')
    const reason = String(field?.reason || '')
    if (!name || mode === 'keep') return false
    const describedAsHeader = /固定|表头|栏目名|列标题|标题行/.test(reason)
    if (describedAsHeader && FIXED_TABLE_HEADER_NAMES.has(name)) return false
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
}

/**
 * AI 重新分析时，实体模板中已有的占位符是字段真相源，不能因为模型漏报而消失。
 * AI 结果优先提供新规则；漏报字段用当前规则构造回退项；AI 发现的新空白位追加在后。
 */
export function mergeTemplateAnalysisFields(existingFields = [], aiFields = [], fallbackForField = () => null) {
  const aiByName = new Map(aiFields.map(field => [String(field?.name || '').trim(), field]).filter(([name]) => name))
  const merged = []
  const seen = new Set()
  for (const rawField of existingFields) {
    const name = String(rawField || '').trim()
    if (!name || seen.has(name)) continue
    const candidate = aiByName.get(name) || fallbackForField(name)
    if (candidate) merged.push({ ...candidate, name, label: candidate.label || name, existing: true })
    seen.add(name)
  }
  for (const candidate of aiFields) {
    const name = String(candidate?.name || '').trim()
    if (!name || seen.has(name)) continue
    merged.push({ ...candidate, name, label: candidate.label || name, existing: false })
    seen.add(name)
  }
  return merged
}

/** 扫描成功时源文件字段是唯一真相源；只有扫描失败才使用登记快照。 */
export function resolveReloadedTemplateFields(scanSucceeded, scannedFields = [], registeredFields = []) {
  const source = scanSucceeded ? scannedFields : registeredFields
  return [...new Set(source.map(field => String(field || '').trim()).filter(Boolean))]
}

const CONTEXT_FIELD_SUGGESTIONS = [
  [/项目概况|本周综述|形象进度/, '形象进度总体说明'],
  [/进度部分|施工进度|工作进展/, '进度部分情况'],
  [/到货|安装统计/, '到货安装统计'],
  [/安全.*质量|质量.*安全/, '安全质量描述'],
  [/存在的问题|问题.*协调|协调解决/, '存在问题'],
  [/下周.*计划|工作计划/, '下周计划'],
  [/监理意见|意见.*建议/, '监理建议'],
  [/报告日期|编制日期/, '日期'],
]

/** 根据点击位置与 AI 分析结果给出可选字段名，避免让用户手工命名。 */
export function suggestPlaceholderNames(anchor = '', existingFields = [], analyzedFields = []) {
  const existing = new Set(existingFields.map(value => String(value || '').trim()))
  const result = []
  const add = value => {
    const name = String(value || '').trim()
    if (name && !existing.has(name) && !result.includes(name)) result.push(name)
  }
  const context = String(anchor || '').replace(/\s+/g, ' ').trim()
  for (const [pattern, field] of CONTEXT_FIELD_SUGGESTIONS) if (pattern.test(context)) add(field)
  for (const field of analyzedFields) add(field?.name)
  const cleaned = context
    .replace(/^[一二三四五六七八九十\d]+[、.．]\s*/, '')
    .replace(/^[（(][一二三四五六七八九十\d]+[）)]\s*/, '')
    .replace(/[：:。；;，,]+$/g, '')
    .trim()
  if (/^[\u4e00-\u9fa5A-Za-z0-9（）()]{2,16}$/.test(cleaned) && !/^(监理周报|附录)$/.test(cleaned)) add(cleaned)
  return result.slice(0, 12)
}

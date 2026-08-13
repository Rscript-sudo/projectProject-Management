/**
 * 模板服务 — 加载 .docx 模板文件，替换占位符，生成文档
 *
 * 模板目录：项目根目录下的 templates/
 * 每个文档类型一个子目录，包含 config.json 和 .docx 模板文件
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getKnownAliases, EXPECTED_PLACEHOLDER_RE } from './placeholderScan.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')

// 字段别名映射 — 唯一真相源：src/shared/field-aliases.json
// 在 fieldRegistry.ts 中新增字段时，必须同步更新此 JSON
const FIELD_ALIASES_PATH = path.resolve(__dirname, '..', 'src', 'shared', 'field-aliases.json')
const FIELD_ALIASES = JSON.parse(fs.readFileSync(FIELD_ALIASES_PATH, 'utf8'))

// 反向索引：alias → 标准 key
const ALIAS_TO_KEY = {}
for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_KEY[alias] = key
  }
}

/**
 * 把任意名字解析为标准 key（向后兼容老模板）
 */
function resolveKey(name) {
  const stripped = name.replace(/^\{\{|\}\}$/g, '').trim()
  if (FIELD_ALIASES[stripped]) return stripped
  if (ALIAS_TO_KEY[stripped]) return ALIAS_TO_KEY[stripped]
  return null
}

/**
 * 构建扁平化的占位符字典（key + 所有别名都映射到值）
 */
function expandAliases(canonical) {
  const out = {}
  for (const [key, value] of Object.entries(canonical)) {
    const aliases = FIELD_ALIASES[key] || [key]
    for (const alias of aliases) {
      out[alias] = value || ''
    }
  }
  return out
}

// 文档类型 → 模板目录名 映射
const DOC_TYPE_DIR_MAP = {
  '整改通知书': '05_监理整改通知书',
  '安全通知书': '07_节假日安全通知',
  '工程联系单': '06_监理联系单',
  '停工令': '15_停工令',
  '会议纪要': '04_会议纪要',
  '监理周报': '02_监理周报',
  '监理月报': '03_监理月报',
  '监理日志': '01_监理日志',
  '开工通知': '13_开工通知',
  '竣工通知': '14_竣工通知',
  '工程变更单': '12_工程变更单',
  '工程款支付证书': '16_工程款支付证书',
  '进度分析报告': '17_进度分析报告',
  '开工条件检查表': '08_开工条件检查表',
  '承建资格报审表': '09_承建资格报审表',
  '施工组织设计报审表': '10_施工组织设计报审表',
  '总监理工程师任命书': '11_总监理工程师任命书',
  '监理规划': '21_监理规划',
  '监理细则': '21_监理规划',
  // B3 新增 8 类 — 大部分走 fallback 生成（无独立模板）
  '方案审核意见': null,
  '索赔报告': null,
  '巡视记录': null,
  '安全检查记录': null,
  '质量评估报告': null,
  '付款审核意见': null,
  '通用文档': null,
}

/**
 * 查找文档类型的模板文件
 * @param {string} templatesDir - 模板根目录
 * @param {string} docType - 文档类型
 * @returns {null|{templatePath: string, config: object}}
 */
export function findTemplate(templatesDir, docType, options = {}) {
  const dirName = DOC_TYPE_DIR_MAP[docType]
  if (!dirName) return null

  const dirPath = path.join(templatesDir, dirName)
  if (!fs.existsSync(dirPath)) return null

  // 读取 config.json
  const configPath = path.join(dirPath, 'config.json')
  let config = {}
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      console.error('[templateService] Error reading config.json:', e.message)
    }
  }

  // 查找 .docx 模板文件（排除 macOS 临时文件和备份文件）
  const files = fs.readdirSync(dirPath)
  const tmplFile = files.find(f => f.endsWith('.docx') && !f.startsWith('~$') && !f.startsWith('.~'))
  if (!tmplFile) {
    console.error('[templateService] No .docx file found in', dirPath)
    return null
  }

  const defaultTemplatePath = path.join(dirPath, tmplFile)
  const overridePath = options.templateOverride?.path
  const templatePath = overridePath && fs.existsSync(overridePath) && path.extname(overridePath).toLowerCase() === '.docx'
    ? overridePath
    : defaultTemplatePath

  return {
    templatePath,
    config,
    source: templatePath === defaultTemplatePath ? 'global' : 'project',
  }
}

/** 读取 DOCX 主文档中的 {{字段}}；项目模板可自由替换，因此字段以文件实际内容为准。 */
export async function getTemplatePlaceholders(templatePath) {
  try {
    const PizZip = (await import('pizzip')).default
    const zip = new PizZip(fs.readFileSync(templatePath))
    const xml = zip.file('word/document.xml')?.asText() || ''
    return [...new Set([...xml.matchAll(/\{\{([^}]{1,80})\}\}/g)].map(m => m[1].trim()).filter(Boolean))]
  } catch (e) {
    console.warn('[templateService] Failed to read template placeholders:', e.message)
    return []
  }
}


/**
 * v1.2.2（2026-06-28）：正文段格式清洗（docx 渲染前的兜底）
 *
 * 修两个老板反馈的渲染问题：
 *  1. AI 输出"    一、安全防范要求" → 前面有 4 空格 + 模板首行缩进另设 → 视觉上"缩进不严谨"
 *     → 剥掉"一、""（一）""1."等序号前的所有前导空格
 *  2. AI 用单 \n 分段 → docxtemplater linebreaks:true 转软换行 <w:br/> → 视觉上"标题与正文没换行"
 *     → 把"段落标题行末尾的 \n"升级为 \n\n，让 docxtemplater 识别为新段落
 *
 * v1.2.4（2026-06-29 老板反馈）：AI 输出"事由：：国庆假期..."双冒号
 *   v1.2.3 regex 只剥一次前缀，剩"：国庆..."。修法：循环剥 + 兜底剥任何残留"：xxx"开头的列
 *
 * 不动 \n\n（已经是段落分隔）
 */
function sanitizeBodyContent(value, projectType) {
  if (!value || typeof value !== 'string') return value
  let v = value
  // 1. 剥掉序号前的空格（"    一、" → "一、"，"  （一）" → "（一）"，"   1." → "1."）
  v = v.replace(/^[ \t]+(?=[一二三四五六七八九十]+[、.]|[（(][一二三四五六七八九十][）)]|\d+[.)、])/gm, '')
  // 2. 段落标题行末尾的 \n 升级为 \n\n（让 docxtemplater 渲染成新段落而不是软换行）
  v = v.replace(/([一二三四五六七八九十]+[、.][^\n]*)\n(?![\n])/g, '$1\n\n')
  v = v.replace(/([（(][一二三四五六七八九十][）)][^\n]*)\n(?![\n])/g, '$1\n\n')
  v = v.replace(/(\d+[.)、][^\n]*)\n(?![\n])/g, '$1\n\n')
  // 3. v1.2.5 兜底：项目类型禁用术语替换
  v = sanitizeForbiddenTerms(v, projectType)
  // 4. v1.2.7 兜底：信件语体清理（"尊敬的..."/"此致敬礼"）
  //   与 src/services/aiService.ts 的 sanitizeLetterStyle 词表双向同步
  //   非前端入口（直接 IPC 调用 saveDoc/exportPDF）会绕过 aiService parse-time 防线
  v = sanitizeLetterStyle(v)
  return v
}

/**
 * v1.2.7（2026-06-29 老板反馈）：信件语体清理（独立函数，便于在 sanitizeBodyContent 内调用）
 * 监理文书【不是书信】，AI 不应输出信件式开场/结尾。
 * 词表与 src/services/aiService.ts 的 sanitizeLetterStyle 双向同步。
 */
const LETTER_OPENING_RE = /(^|\n)\s*(?:尊敬(?:的)?[^：:\n]{0,30}[：:])\s*(?=\S)/g
const LETTER_CLOSING_RE = /(此致敬礼|顺祝商祺|敬请审阅|以上请批复|特此函达|特此通知|此复|此令|为盼|为荷)[！!。.\s]*/g

export function sanitizeLetterStyle(value) {
  if (!value || typeof value !== 'string') return value
  let v = value

  // 1. 开头客套话
  const openingHits = []
  v = v.replace(LETTER_OPENING_RE, (m, lead) => {
    const matched = m.replace(/^\s*/, '').replace(/\s*$/, '')
    const label = matched.length > 30 ? matched.slice(0, 30) + '…' : matched
    openingHits.push(label)
    return lead || ''
  })

  // 2. 结尾客套话
  const closingHits = []
  v = v.replace(LETTER_CLOSING_RE, (m) => {
    const label = m.replace(/[！!。.\s]*$/, '')
    closingHits.push(label)
    return ''
  })

  const allHits = [...openingHits, ...closingHits]
  if (allHits.length > 0) {
    const placeholder = `\n\n{{待清理：信件语体 - ${allHits.join('、')}}}`
    v = `${v.trim()}${placeholder}`
  }
  return v
}

/**
 * v1.2.4（2026-06-29）：【事由】【主题】等字段值的前缀清洗
 * 循环剥（事由|主题|关于|标题|摘要）：前缀，直到不再匹配为止 —— 解决"事由：：xxx"双冒号
 * 同时剥纯冒号残留（"：xxx" → "xxx"），解决 AI 写的"：尊敬的建设单位..."无主语前缀
 */
export function sanitizeFieldValue(value) {
  if (!value || typeof value !== 'string') return value
  let v = value
  let prev
  do {
    prev = v
    v = v.replace(/^(事由|主题|关于|标题|摘要)\s*[：:]\s*/g, '')
    v = v.replace(/^[：:]\s*/g, '')
  } while (v !== prev)
  return v
}

/**
 * v1.2.5（2026-06-29）：项目类型禁用术语兜底替换
 * 老板反馈：信息化项目 AI 输出含"塔吊、升降机、电焊机、木工、扬尘"等土建术语
 *   prompt 已加设备术语硬约束，但 AI 偶尔还是照抄旧示例
 *   这里做兜底：按 projectType 把禁用术语替换为 {{待替换：...}} 占位提示
 *   让老板在预览里一眼看到需要改的位置
 */
const PROJECT_TYPE_FORBIDDEN_TERMS = {
  信息化: ['塔吊', '升降机', '电焊机', '木工', '扬尘', '木工棚', '木工加工', '混凝土', '钢筋', '砌体', '模板', '脚手架', '深基坑', '高支模', '桩号', '围挡围栏'],
  园林: ['塔吊', '升降机', '电焊机', '木工', '混凝土', '钢筋', '砌体', '脚手架', '深基坑', '高支模'],
  装饰: ['塔吊', '升降机', '混凝土', '钢筋', '砌体', '深基坑', '高支模', '苗木'],
  钢结构: ['木工', '砌体', '苗木', '机房', 'UPS', '精密空调'],
}

export function sanitizeForbiddenTerms(value, projectType) {
  if (!value || typeof value !== 'string' || !projectType) return value
  const forbidden = PROJECT_TYPE_FORBIDDEN_TERMS[projectType]
  if (!forbidden) return value
  let v = value
  for (const term of forbidden) {
    if (v.includes(term)) {
      v = v.replace(new RegExp(term, 'g'), `{{待替换：${term}（${projectType}项目禁用）}}`)
    }
  }
  return v
}

/**
 * 从内容中解析 【key】value 格式的结构化数据
 * AI 输出中可能包含如：【施工部位】机房、弱电间 等段落
 */
function parseSections(content) {
  const result = {}
  const regex = /【([^】]+)】([\s\S]*?)(?=【|$)/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const key = match[1].trim()
    let value = match[2].trim()
    if (key && value) {
      // v1.2.4（2026-06-29）：循环剥前缀（事由：：xxx → 事由：xxx → xxx）
      // 老板反馈 v1.2.3 的单次 regex 剥不干净，剩"：xxx"
      value = sanitizeFieldValue(value)
      result[key] = value
    }
  }
  return result
}

/**
 * 构建占位符数据（基于 FieldRegistry 统一别名）
 * 1. 从基础环境变量构建（项目名称、参建单位等）
 * 2. 从 config.json placeholders 补充默认值
 * 3. 从 content 中解析 【key】value 结构覆盖占位符
 * 4. 显式传入的参数优先级最高
 */
export function buildPlaceholderData({
  docType,
  projectName = '',
  ownerUnit = '',
  contractor = '',
  supervisorUnit = '',
  chiefEngineer = '',
  userInput = '',
  content = '',
  config = {},
  projectType = '',  // v1.2.5：用于正文禁用术语兜底替换
}) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`
  const dateNum = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  // 1. 标准 canonical（基于 FieldRegistry 的 key）
  const canonical = {
    projectName: projectName || '',
    // 未提供的项目事实不得伪造默认单位/人员；模板 config 可另行提供确定默认值。
    ownerUnit: ownerUnit || '',
    contractor: contractor || '',
    supervisorUnit: supervisorUnit || '',
    chiefEngineer: chiefEngineer || '',
    date: dateStr,
    fileNumber: `${dateNum}-001`,
    subject: userInput || '',
    content: content || '',
  }

  // 2. 展开为所有别名（docxtemplater 用）
  const data = expandAliases(canonical)

  // 3. 从 config.json placeholders 补充特定占位符
  const placeholders = config.placeholders || {}
  for (const [placeholder, def] of Object.entries(placeholders)) {
    const stripped = placeholder.replace(/^\{\{|\}\}$/g, '').trim()
    // 优先用 Registry 标准 key 解析
    const stdKey = resolveKey(stripped) || stripped

    if (data[stripped] !== undefined && data[stripped] !== null && String(data[stripped]).trim()) continue

    const source = def.source || 'param'
    const defaultValue = def.default || ''

    let value
    switch (source) {
      case 'env':
      case 'param':
      default:
        value = defaultValue
    }
    if (source === 'computed') value = defaultValue || `${dateNum}-001`

    // 写回到所有别名
    const aliases = FIELD_ALIASES[stdKey] || [stripped]
    for (const alias of aliases) {
      data[alias] = value
    }
    // 也写原 key（防御）
    data[stripped] = value
  }

  // 4. 从 content 中解析 【key】value 结构化数据并覆盖
  const sections = parseSections(content)
  for (const [key, value] of Object.entries(sections)) {
    const stdKey = resolveKey(key)
    const aliases = stdKey ? (FIELD_ALIASES[stdKey] || [key]) : [key]
    for (const alias of aliases) {
      // v1.2.2（2026-06-28）：正文段格式清洗（解决"一、安全防范要求"前空格 + 不换行 bug）
      //   docxtemplater linebreaks:true 把单 \n 转软换行，要段落分隔必须 \n\n
      //   但 AI 经常输出"    一、安全防范要求\n（一）..." → 软换行 + 空格，渲染成一段
      //   修法：1) 剥"标题"前导空格  2) 单 \n 升级为 \n\n（除非已在 \n\n 中）
      // v1.2.5：传 projectType 进去做禁用术语兜底替换
      data[alias] = sanitizeBodyContent(value, projectType)
    }
  }

  console.log('[templateService] Built placeholder data (registry):', Object.keys(data).length, 'keys')
  return data
}

/**
 * 渲染模板 — 用 docxtemplater 替换占位符并输出 buffer
 * v1.2.0 增强：替换后扫描 word/document.xml，发现未替换的 {{xxx}} 直接抛错（老板 2026-06-26 拍板）
 * 防止 AI 输出残留占位符 → 脏 DOCX 出厂
 *
 * v1.2.1 修复（P0）：扫描源必须从「渲染后 buffer」重新解 zip 读取，
 *   不能用源 zip 引用——v1.2.0 的扫描永远命中源模板（永远空），防线失效。
 */
export async function renderTemplate(templatePath, data) {
  const Docxtemplater = (await import('docxtemplater')).default
  const PizZip = (await import('pizzip')).default

  // 读取模板文件
  const tmplContent = fs.readFileSync(templatePath, 'binary')
  const zip = new PizZip(tmplContent)
  const templateXml = zip.file('word/document.xml')?.asText() || ''
  // 模板可由项目自行替换，字段集合不能再靠全局 config 假定。
  // 未提供的字段必须显式标记待核对，不能让 docxtemplater 输出 undefined。
  for (const key of new Set([...templateXml.matchAll(/\{\{([^}]{1,80})\}\}/g)].map(m => m[1].trim()))) {
    if (data[key] === undefined || data[key] === null) data[key] = '数据待核对'
  }

  // 创建模板引擎实例
  // 模板使用 {{ 和 }} 作为占位符定界符（如 {{项目名称}}）
  const doc = new Docxtemplater(zip, {
    linebreaks: true,        // \n 自动转为软回车
    paragraphLoop: true,
    delimiters: { start: '{{', end: '}}' },
  })

  // 替换占位符
  doc.render(data)

  // 生成输出 buffer
  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  // 兜底扫描：未替换的 {{xxx}} 残留
  // docxtemplater 在缺少字段时会保留原样（部分场景），脏数据不允许出厂
  // v1.2.1 关键修复：从 buffer 重新解 zip 扫描，不能用源 zip
  // 反编造铁律：白名单里的占位符（{{待补充：...}} / {{未指定时间}} / {{CURRENT_DATE}}）
  // 是 AI 主动注入的合法残留，doc.mjs 入口已经放过，这里也要同步白名单
  // v1.2.3（2026-06-29）：三段划分规则的🟡必须人工填字段名（监理部联系电话等）也同步放行
  const MANUAL_FILL_PLACEHOLDERS = new Set([
    '监理部联系电话', '项目编号', '合同编号', '签发人姓名', '签发日期',
    '责任人姓名', '联系电话', '具体时间', '具体责任人', '具体部位',
    '经济损失金额', '伤亡人数',
  ])
  try {
    const resultZip = new PizZip(buffer)
    const xml = resultZip.file('word/document.xml')?.asText() || ''
    const known = getKnownAliases()
    const leftover = [...xml.matchAll(/\{\{([^}]{1,40})\}\}/g)]
      .map(m => m[1].trim())
      .filter(s =>
        !s.startsWith('{') &&
        !s.endsWith('}') &&
        !EXPECTED_PLACEHOLDER_RE.test(s) &&
        !known.has(s) &&
        !MANUAL_FILL_PLACEHOLDERS.has(s)
      )
    if (leftover.length > 0) {
      const unique = [...new Set(leftover)]
      throw new Error(`模板占位符未全部替换：${unique.slice(0, 10).join(', ')}${unique.length > 10 ? ` 等 ${unique.length} 处` : ''}`)
    }
  } catch (scanErr) {
    // 扫描失败不能掩盖原始错误；只有扫描器自身的 bug 才吞
    if (scanErr.message.includes('占位符未全部替换')) throw scanErr
    console.warn('[renderTemplate] leftover scan failed:', scanErr.message)
  }

  return buffer
}

/**
 * 渲染 xlsx 模板 — 将占位符数据写入 xlsx 单元格
 * 使用 xlsx (SheetJS) 库，根据 config.json 中的单元格映射写入值
 * 目前主要供 监理日志 使用
 */
export async function renderXlsxTemplate(templatePath, data, cellMappings) {
  const xlsxModule = await import('xlsx')
  const XLSX = xlsxModule.default || xlsxModule

  // 读取模板
  const wb = XLSX.readFile(templatePath)
  const ws = wb.Sheets[wb.SheetNames[0]]

  // 按 placeholder 名称映射单元格（正确的方式）
  // config.json placeholder_cells 顺序与 placeholders 对象顺序一致
  const PH_CELL_ORDER = {
    'E3': '项目名称',
    'E4': '日期',
    'K4': '星期几',
    'R4': '天气',
    'W4': '气温',
    'A5': '施工部位',
    'P5': '参与人员',
    'A7': '今日内容',
    'A12': '核心工作落实',
    'A17': '协调解决情况',
    'A22': '其他事项',
  }

  if (!ws || wb.SheetNames.length === 0) return null
  for (const [cellRef, placeholderName] of Object.entries(PH_CELL_ORDER)) {
    if (!ws[cellRef]) continue
    const value = data[placeholderName]
    if (value && String(value).trim()) {
      const cell = ws[cellRef]
      cell.v = value
      cell.t = 's'
      cell.w = String(value)
    }
  }

  // 生成 buffer（不应用样式，保留模板原始样式）
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// =============================================================================
// GB/T 9704-2012 格式规范常量与辅助函数
// =============================================================================

const STYLE_MAP = {
  h1:      { font: '黑体',         sz: 30, bold: false, align: 'left',    firstLine: 0    },
  h2:      { font: '楷体_GB2312', sz: 32, bold: true,  align: 'left',    firstLine: 0    },
  h3:      { font: '仿宋_GB2312', sz: 32, bold: false, align: 'left',    firstLine: 0    },
  h4:      { font: '仿宋_GB2312', sz: 32, bold: false, align: 'left',    firstLine: 0    },
  body:    { font: '仿宋_GB2312', sz: 32, bold: false, align: 'justify', firstLine: 640  },
  closing: { font: '仿宋_GB2312', sz: 32, bold: false, align: 'right',   firstLine: 0    },
}

// GB/T 9704-2012 A4 页边距（单位：twips，1cm ≈ 567 twips）
// 上 3.7cm ≈ 2098twips，下 3.5cm ≈ 1984twips，左 2.8cm ≈ 1587twips，右 2.6cm ≈ 1474twips
const GB_PAGE_MARGINS = '<w:pgMar w:top="2098" w:bottom="1984" w:left="1587" w:right="1474" w:header="720" w:footer="720" w:gutter="0"/>'

const TYPE_PATTERNS = [
  { type: 'h1',      pattern: /^\s*[一二三四五六七八九十]+[、]/ },
  { type: 'h2',      pattern: /^\s*[（(][一二三四五六七八九十][）)]/ },
  { type: 'h3',      pattern: /^\s*\d+\.[\s　]/ },
  { type: 'h4',      pattern: /^\s*[（(]\d+[）)]/ },
  { type: 'closing', pattern: /^(?:编制人|审核人|审批人|批准人|总监理工程师|编制单位|编制日期|报告日期)/ },
  { type: 'body',    pattern: /^./ },
]

function detectType(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return 'body'
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(trimmed)) return type
  }
  return 'body'
}

/**
 * 构建指定风格的 rPr XML 片段
 */
function buildRPrXml(style) {
  const boldXml = style.bold ? '<w:b/><w:bCs/>' : ''
  return `<w:rPr><w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}" w:eastAsia="${style.font}"/><w:sz w:val="${style.sz}"/><w:szCs w:val="${style.sz}"/>${boldXml}</w:rPr>`
}

/**
 * 把 pPr 应用行距/对齐/缩进（不修改 rPr）
 */
function applyPPrFormatting(pPr, defaultAlign, firstLine) {
  const jcMap = { left: 'left', right: 'right', center: 'center', justify: 'both' }
  const jcVal = jcMap[defaultAlign] || 'both'
  let out = pPr
  // 设置行距
  if (/<w:spacing\b/.test(out)) {
    out = out.replace(/<w:spacing\s[^/]*\/>/, '<w:spacing w:line="560" w:lineRule="exact"/>')
  } else {
    out = out.replace('</w:pPr>', '<w:spacing w:line="560" w:lineRule="exact"/></w:pPr>')
  }
  // 设置对齐
  if (/<w:jc\b/.test(out)) {
    out = out.replace(/<w:jc\s[^/]*\/>/, `<w:jc w:val="${jcVal}"/>`)
  } else {
    out = out.replace('</w:pPr>', `<w:jc w:val="${jcVal}"/></w:pPr>`)
  }
  // 设置首行缩进
  if (firstLine) {
    if (/<w:ind\b/.test(out)) {
      out = out.replace(/<w:ind\s[^/]*\/>/, `<w:ind w:firstLine="${firstLine}"/>`)
    } else {
      out = out.replace('</w:pPr>', `<w:ind w:firstLine="${firstLine}"/></w:pPr>`)
    }
  }
  return out
}

/**
 * 格式化含 <w:br/> 的段落：只修正行距/对齐/缩进，不改变字体
 * 字体由模板本身的设计决定
 */
function formatBrParagraph(pBlock) {
  let result = pBlock

  // 段落级 pPr：行距 28pt + 两端对齐 + 首行缩进 2 字符
  result = result.replace(/<w:pPr[\s\S]*?<\/w:pPr>/, (pPr) => {
    return applyPPrFormatting(pPr, 'justify', 640)
  })
  if (!result.includes('<w:pPr')) {
    result = result.replace('<w:p>', '<w:p><w:pPr><w:spacing w:line="560" w:lineRule="exact"/><w:jc w:val="both"/><w:ind w:firstLine="640"/></w:pPr>')
  }

  return result
}

/**
 * 为普通段落（不含 <w:br/>）应用统一的 GB 样式
 */
function applyStyleToParagraph(pBlock) {
  const firstT = pBlock.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
  const firstText = firstT ? firstT[1] : ''
  const type = detectType(firstText)
  const style = STYLE_MAP[type] || STYLE_MAP.body

  let result = pBlock

  // 行距/对齐/缩进
  result = result.replace(/<w:pPr[\s\S]*?<\/w:pPr>/, (pPr) => {
    return applyPPrFormatting(pPr, style.align, style.firstLine)
  })
  if (!result.includes('<w:pPr')) {
    const jcMap = { left: 'left', right: 'right', center: 'center', justify: 'both' }
    const jcVal = jcMap[style.align] || 'both'
    const spacing = '<w:spacing w:line="560" w:lineRule="exact"/>'
    const jc = `<w:jc w:val="${jcVal}"/>`
    const indent = style.firstLine ? `<w:ind w:firstLine="${style.firstLine}"/>` : ''
    result = result.replace('<w:p>', `<w:p><w:pPr>${spacing}${indent}${jc}</w:pPr>`)
  }

  // rPr — 统一用一种字体
  const rPrXml = buildRPrXml(style)
  result = result.replace(/<w:rPr[\s\S]*?<\/w:rPr>/g, rPrXml)

  return result
}

/**
 * 格式刷 — 对已生成的 docx 文件应用 GB/T 9704-2012 格式规范
 * 纯 JS 实现（操作 docx ZIP 中 word/document.xml），无 Python 依赖
 * templateUsed: 是否使用了模板（true=轻量模式, false=全量模式）
 */
export async function formatDocx(docxPath, templateUsed = true) {
  const { default: PizZip } = await import('pizzip')
  if (!fs.existsSync(docxPath)) {
    console.warn('[formatDocx] docx not found at', docxPath)
    return false
  }

  try {
    const zip = new PizZip(fs.readFileSync(docxPath))
    const docFile = zip.file('word/document.xml')
    if (!docFile) {
      console.warn('[formatDocx] word/document.xml not found in', docxPath)
      return false
    }

    let xml = docFile.asText()

    // === 1. 模板路径：只格式化含 <w:br/> 的段落（即 {{正文内容}} 产物）===
    //     有 <w:br/> → 分段检测（按 <w:br/> 分组，每行独立识别标题/正文）
    //     无 <w:br/> → 统一检测（第一段文本决定整段字体）
    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (pBlock) => {
      if (templateUsed && !/<w:br\/>/.test(pBlock)) return pBlock
      if (!/<w:t[^>]*>/.test(pBlock)) return pBlock
      if (/<w:br\/>/.test(pBlock)) {
        return formatBrParagraph(pBlock)
      }
      return applyStyleToParagraph(pBlock)
    })

    // === 2. 行距兜底（28pt 固定）===
    xml = xml.replace(/(<w:pPr[\s\S]*?)(?:<\/w:pPr>)/g, (match, pPrContent) => {
      if (/<w:spacing\b/.test(pPrContent)) return match
      return pPrContent + '<w:spacing w:line="560" w:lineRule="exact"/></w:pPr>'
    })

    // === 3. 页边距（GB/T 9704-2012 A4标准）===
    if (/<w:pgMar\b/.test(xml)) {
      xml = xml.replace(/<w:pgMar\s[^/]*\/>/g, GB_PAGE_MARGINS)
    } else {
      xml = xml.replace(/<w:sectPr>/g, '<w:sectPr>' + GB_PAGE_MARGINS)
    }

    // === 4. 降级路径 run 字体兜底 ===
    if (!templateUsed) {
      xml = xml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (match, inner) => {
        if (/<w:rPr>/.test(inner)) return match
        return '<w:r><w:rPr><w:rFonts w:ascii="仿宋_GB2312" w:hAnsi="仿宋_GB2312" w:eastAsia="仿宋_GB2312"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>' + inner + '</w:r>'
      })
    }

    // === 5. 确保每段都有 <w:pPr>（兜底）===
    xml = xml.replace(/<w:p\b[^>]*>(?!\s*<w:pPr\b)/g, '$&<w:pPr/>')
    zip.file('word/document.xml', xml)
    fs.writeFileSync(docxPath, zip.generate({ type: 'nodebuffer' }))

    console.log('[formatDocx] OK:', docxPath, templateUsed ? '(template)' : '(fallback)')
    return true
  } catch (e) {
    console.error('[formatDocx] Error:', e.message)
    return false
  }
}

// 去掉目录/文件名的编号前缀（如 "18_通信工程" → "通信工程"）
function stripNumberPrefix(name) {
  return name.replace(/^\d+_/, '')
}

// 去掉文件名中的模板后缀标识
function cleanTemplateName(name) {
  return name
    .replace(/\.docx$/i, '')
    .replace(/[「」【】]/g, '')
    .replace(/[_＿]模版$/, '')
    .replace(/[_＿]模板$/, '')
    .replace(/[_＿]TEMP$/i, '')
    .trim()
}

// 递归扫描模板目录，返回子节点列表
function buildTemplateTree(dirPath) {
  if (!fs.existsSync(dirPath)) return []

  const EXCLUDED = new Set(['format-spec', 'logo.png', '.DS_Store'])
  const items = []

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !EXCLUDED.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => {
      const numA = parseInt(a.name.match(/^(\d+)/)?.[1] || '99')
      const numB = parseInt(b.name.match(/^(\d+)/)?.[1] || '99')
      if (numA !== numB) return numA - numB
      return a.name.localeCompare(b.name)
    })

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      const children = buildTemplateTree(entryPath)
      if (children.length === 0) continue
      items.push({
        name: entry.name,
        path: entryPath,
        type: 'category',
        displayName: stripNumberPrefix(entry.name),
        children,
        docxCount: countDocx(children),
      })
    } else if (entry.name.toLowerCase().endsWith('.docx')) {
      items.push({
        name: entry.name,
        path: entryPath,
        type: 'item',
        displayName: cleanTemplateName(entry.name),
        ext: '.docx',
      })
    }
  }

  return items
}

/**
 * 构建模板资源目录 — 扫描 templates/ 返回结构化树
 * 01-17 号通用模板归入"通用类型模板"父目录
 * 18-22 号专业模板作为独立分类
 * 排除 format-spec/ 目录和非模板文件
 */
export function buildTemplateCatalog(templatesDir) {
  if (!fs.existsSync(templatesDir)) return []

  const SPECIALTY = new Set(['18_通信工程', '19_信息化工程', '20_电力工程', '21_监理规划'])
  const items = []
  const generalItems = []

  const entries = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.') && e.isDirectory() && e.name !== 'format-spec')
    .sort((a, b) => {
      const numA = parseInt(a.name.match(/^(\d+)/)?.[1] || '99')
      const numB = parseInt(b.name.match(/^(\d+)/)?.[1] || '99')
      if (numA !== numB) return numA - numB
      return a.name.localeCompare(b.name)
    })

  for (const entry of entries) {
    const entryPath = path.join(templatesDir, entry.name)
    const children = buildTemplateTree(entryPath)
    if (children.length === 0) continue

    const node = {
      name: entry.name,
      path: entryPath,
      type: 'category',
      displayName: stripNumberPrefix(entry.name),
      children,
      docxCount: countDocx(children),
    }

    if (SPECIALTY.has(entry.name)) {
      // 专业模板 — 独立展示
      items.push(node)
    } else {
      // 通用模板 — 归入父目录
      generalItems.push(node)
    }
  }

  // 通用类型模板作为根分类
  if (generalItems.length > 0) {
    items.unshift({
      name: '00_通用类型模板',
      path: templatesDir,
      type: 'category',
      displayName: '通用类型模板',
      children: generalItems,
      docxCount: countDocx(generalItems),
    })
  }

  return items
}

function countDocx(items) {
  let count = 0
  for (const item of items) {
    if (item.type === 'item') count++
    if (item.children) count += countDocx(item.children)
  }
  return count
}

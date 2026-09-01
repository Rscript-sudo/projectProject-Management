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
import { PAGE, FONTS, getFormatProfile, detectParagraphRole, formatAuditFromXml } from './documentFormatEngine.mjs'
import { applyTemplateLayoutContract } from './templateLayoutContract.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')

// 字段别名映射 — 唯一真相源：src/shared/field-aliases.json
// 在 fieldRegistry.ts 中新增字段时，必须同步更新此 JSON
const FIELD_ALIASES_PATH = path.resolve(__dirname, '..', 'src', 'shared', 'field-aliases.json')
const FIELD_ALIASES = JSON.parse(fs.readFileSync(FIELD_ALIASES_PATH, 'utf8'))
const BUILTIN_DOC_TYPES_PATH = path.resolve(__dirname, '..', 'src', 'shared', 'builtin-doc-types.json')
const BUILTIN_DOC_TYPES = new Set(JSON.parse(fs.readFileSync(BUILTIN_DOC_TYPES_PATH, 'utf8')))

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
// v1.x：内置模板物理重组为 templates/通用/{dir}，值为「通用/目录名」；
// findTemplate 找不到新路径时回退扁平旧路径（兼容迁移前的目录布局）。
const DOC_TYPE_DIR_MAP = {
  '整改通知书': '通用/05_整改通知书',
  '安全通知书': '通用/07_安全通知书',
  '工程联系单': '通用/06_工程联系单',
  '停工令': '通用/15_停工令',
  '会议纪要': '通用/04_会议纪要',
  '监理周报': '通用/02_监理周报',
  '监理月报': '通用/03_监理月报',
  '监理日志': '通用/01_监理日志',
  '开工通知': '通用/13_开工通知',
  '竣工通知': '通用/14_竣工通知',
  '工程变更单': '通用/12_工程变更单',
  '工程款支付证书': '通用/16_工程款支付证书',
  '进度分析报告': '通用/17_进度分析报告',
  '开工条件检查表': '通用/08_开工条件检查表',
  '承建资格报审表': '通用/09_承建资格报审表',
  '施工组织设计报审表': '通用/10_施工组织设计报审表',
  '总监理工程师任命书': '通用/11_总监理工程师任命书',
  '监理规划': '通用/21_监理规划',
}

/**
 * 解析 docType 的模板目录绝对路径。
 * 优先新路径（含子目录，如 通用/01_监理日志）；若不存在则回退扁平旧路径
 * （如 templates/通用/01_监理日志），兼容物理重组前的目录布局，防止迁移中途打挂整机。
 */
function resolveTemplateDir(templatesDir, dirName) {
  if (!dirName) return null
  const newPath = path.join(templatesDir, dirName)
  if (fs.existsSync(newPath)) return newPath
  // 回退：取最后一段目录名，尝试根目录下的扁平路径
  if (dirName.includes('/')) {
    const legacy = path.join(templatesDir, dirName.split('/').pop())
    if (fs.existsSync(legacy)) return legacy
  }
  return newPath
}

// 同一目录内曾存在多个相近底稿，不能依赖文件系统遍历顺序。
// 当前仅保留已完成占位符配置的“监理规划”底稿。
const DOC_TYPE_TEMPLATE_HINTS = {
  '监理规划': ['监理规划模板.docx'],
}

function selectTemplateFile(files, docType, expectedExtension) {
  const candidates = files.filter(name => name.toLowerCase().endsWith(expectedExtension) && !name.startsWith('~$') && !name.startsWith('.~'))
  const hints = DOC_TYPE_TEMPLATE_HINTS[docType] || []
  return hints.find(name => candidates.includes(name)) || candidates[0]
}

/**
 * 列出随应用交付的只读企业基础模板。
 * 它们是企业模板体系的底座；用户导入的企业共享模板会在生成时覆盖它们。
 */
export async function listSystemTemplates(templatesDir) {
  const entries = []
  for (const [docType, dirName] of Object.entries(DOC_TYPE_DIR_MAP)) {
    // builtin-doc-types.json 是已完成“模板 + 占位符 + AI 规则”验收的唯一清单。
    if (!BUILTIN_DOC_TYPES.has(docType)) continue
    if (!dirName) continue
    const dirPath = resolveTemplateDir(templatesDir, dirName)
    if (!dirPath || !fs.existsSync(dirPath)) continue
    let config = {}
    const configPath = path.join(dirPath, 'config.json')
    if (fs.existsSync(configPath)) {
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
    }
    const expectedExtension = config.engine === 'xlsx' ? '.xlsx' : '.docx'
    const file = selectTemplateFile(fs.readdirSync(dirPath), docType, expectedExtension)
    if (!file) continue
    const templatePath = path.join(dirPath, file)
    const fields = await getTemplatePlaceholders(templatePath)
    // 没有占位符的底稿不能作为通用模板出现在客户端，也不能参与生成。
    if (fields.length === 0) continue
    entries.push({
      id: `system:${docType}`,
      name: `${docType}（系统预置）`,
      docType,
      scope: 'system',
      projectType: '通用',
      sourceName: file,
      path: templatePath,
      fields,
      readOnly: true,
      configurationStatus: 'ready',
      resourceKind: 'document',
    })
  }
  return entries
}

/**
 * 查找文档类型的模板文件
 * @param {string} templatesDir - 模板根目录
 * @param {string} docType - 文档类型
 * @returns {null|{templatePath: string, config: object}}
 */
export function findTemplate(templatesDir, docType, options = {}) {
  const dirName = DOC_TYPE_DIR_MAP[docType]
  const dirPath = resolveTemplateDir(templatesDir, dirName)

  // 读取 config.json
  const configPath = dirPath ? path.join(dirPath, 'config.json') : null
  let config = {}
  if (configPath && fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      console.error('[templateService] Error reading config.json:', e.message)
    }
  }

  const expectedExtension = config.engine === 'xlsx' ? '.xlsx' : '.docx'
  const overridePath = options.templateOverride?.path
  const hasOverride = overridePath && fs.existsSync(overridePath) && path.extname(overridePath).toLowerCase() === expectedExtension
  // 自定义模板优先于系统映射；这样没有内置模板的新文种也可由企业模板库直接支持。
  if (!dirName && !hasOverride) return null

  // 查找与该文种渲染引擎一致的模板文件（排除 macOS 临时文件和备份文件）
  const files = dirPath && fs.existsSync(dirPath) ? fs.readdirSync(dirPath) : []
  const tmplFile = selectTemplateFile(files, docType, expectedExtension)
  if (!tmplFile && !hasOverride) {
    console.error(`[templateService] No ${expectedExtension} file found in`, dirPath)
    return null
  }

  const defaultTemplatePath = tmplFile ? path.join(dirPath, tmplFile) : null
  const templatePath = hasOverride ? overridePath : defaultTemplatePath

  return {
    templatePath,
    config,
    source: templatePath === defaultTemplatePath ? 'global' : 'project',
  }
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** Word frequently splits {{field}} across several w:t runs. Reconstruct each
 * paragraph before scanning so the physical DOCX remains the field truth source. */
export function extractDocxPlaceholdersFromXml(xml) {
  const fields = []
  for (const paragraph of String(xml || '').match(/<w:p\b[\s\S]*?<\/w:p>/g) || []) {
    const text = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(match => decodeXmlText(match[1])).join('')
    for (const match of text.matchAll(/\{\{([^}]{1,80})\}\}/g)) fields.push(match[1].trim())
  }
  return [...new Set(fields.filter(Boolean))]
}

/**
 * 折叠同一段落内紧邻的重复占位符。
 *
 * 自动分析可能为同一个锚点返回多条候选位置；重复保存时也可能再次命中原位置。
 * 这里按 Word 段落的逻辑文本处理，因此占位符即使跨多个 w:t run，也能保持幂等。
 */
export function collapseAdjacentDuplicatePlaceholders(xml) {
  return String(xml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const nodes = [...paragraph.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g)]
    if (!nodes.length) return paragraph
    const decoded = nodes.map(node => decodeXmlText(node[2]))
    const logical = decoded.join('')
    const removals = []
    for (const match of logical.matchAll(/(\{\{([^{}]{1,80})\}\})(?:\1)+/g)) {
      removals.push([match.index + match[1].length, match.index + match[0].length])
    }
    if (!removals.length) return paragraph

    let logicalOffset = 0
    let rebuilt = ''
    let sourceOffset = 0
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      const start = node.index
      const end = start + node[0].length
      const text = decoded[index]
      const kept = text.split('').filter((_, charIndex) => {
        const position = logicalOffset + charIndex
        return !removals.some(([from, to]) => position >= from && position < to)
      }).join('')
      rebuilt += paragraph.slice(sourceOffset, start)
        + node[1]
        + kept.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        + node[3]
      sourceOffset = end
      logicalOffset += text.length
    }
    return rebuilt + paragraph.slice(sourceOffset)
  })
}

function logicalXmlText(value = '') {
  return String(value)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function sourceChoiceDecision(blockText, sourceText) {
  const source = String(sourceText || '').replace(/\s+/g, '')
  if (/不得.{0,8}勾选|不要.{0,8}勾选|勾选项.{0,8}(?:留空|不填)/.test(source)) return 'blank'
  if (/(?:全部|所有).{0,8}(?:检查项|项目)?.{0,8}(?:不合格|不符合)/.test(source)) return 'negative'
  if (/(?:全部|所有).{0,8}(?:检查项|项目)?.{0,8}不涉及/.test(source)) return 'blank'

  const row = String(blockText || '').replace(/\s+/g, '')
  const statements = [...source.matchAll(/([^，,。；;\n]{2,36}?)(不合格|不符合|异常|不涉及)/g)]
  for (const statement of statements) {
    const phrase = statement[1].replace(/^(?:其中|另外|但是|但|并且)/, '')
    const candidates = []
    for (let length = Math.min(16, phrase.length); length >= 2; length -= 1) candidates.push(phrase.slice(-length))
    if (!candidates.some(candidate => row.includes(candidate))) continue
    return statement[2] === '不涉及' ? 'blank' : 'negative'
  }

  return 'positive'
}

function applyChoiceMarks(block, decision) {
  const decideMark = label => {
    const negative = /^(?:不合格|不符合)$/.test(label)
    const checked = decision === 'negative' ? negative : decision === 'positive' ? !negative : false
    return checked ? '☑' : '□'
  }
  const source = String(block)
  const nodes = [...source.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g)]
  if (!nodes.length) return source.replace(/([□☐☑☒])(\s*)(不合格|不符合|合格|符合)/g,
    (_match, _mark, spacing, label) => `${decideMark(label)}${spacing}${label}`)

  // Word 经常把“□”和“合格”拆到不同 run。先在合并后的可见文本上判断，
  // 再只改方框所在文本节点，避免依赖 OOXML 的 run 切分方式。
  const texts = nodes.map(node => node[2]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  const logical = texts.join('')
  const replacements = new Map()
  for (const match of logical.matchAll(/([□☐☑☒])(\s*)(不合格|不符合|合格|符合)/g)) {
    replacements.set(match.index, decideMark(match[3]))
  }
  if (!replacements.size) return source

  let rebuilt = ''
  let sourceOffset = 0
  let logicalOffset = 0
  nodes.forEach((node, index) => {
    const start = node.index
    const end = start + node[0].length
    const chars = [...texts[index]]
    const replaced = chars.map((char, offset) => replacements.get(logicalOffset + offset) || char).join('')
    rebuilt += source.slice(sourceOffset, start)
      + node[1]
      + replaced.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      + node[3]
    sourceOffset = end
    logicalOffset += chars.length
  })
  return rebuilt + source.slice(sourceOffset)
}

/** 模板中的字符方框是确定性表单控件：默认合格，明确例外才反选或留空。 */
export function applyTemplateChoiceDefaults(documentXml, { sourceText = '' } = {}) {
  const apply = block => {
    const plain = logicalXmlText(block)
    if (!/[□☐☑☒]\s*(?:不合格|不符合|合格|符合)/.test(plain)) return block
    return applyChoiceMarks(block, sourceChoiceDecision(plain, sourceText))
  }
  const xml = String(documentXml || '').replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, apply)
  // 表格外的独立勾选项也使用相同规则；表格块已经按整行处理，不能再按段落
  // 二次处理，否则“某项不合格”的行级判断会被无标签段落的默认值覆盖。
  return xml.split(/(<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>)/g).map(part =>
    /^<w:tbl\b/.test(part) ? part : part.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, apply),
  ).join('')
}

/** 读取 DOCX 主文档中的 {{字段}}；项目模板可自由替换，因此字段以文件实际内容为准。 */
export async function getTemplatePlaceholders(templatePath) {
  try {
    if (path.extname(templatePath).toLowerCase() === '.xlsx') {
      const configPath = path.join(path.dirname(templatePath), 'config.json')
      if (!fs.existsSync(configPath)) return []
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      return [...new Set(Object.keys(config.placeholders || {})
        .map(key => key.replace(/^\{\{|\}\}$/g, '').trim())
        .filter(Boolean))]
    }
    const PizZip = (await import('pizzip')).default
    const zip = new PizZip(fs.readFileSync(templatePath))
    const xml = zip.file('word/document.xml')?.asText() || ''
    return extractDocxPlaceholdersFromXml(xml)
  } catch (e) {
    console.warn('[templateService] Failed to read template placeholders:', e.message)
    return []
  }
}


/**
 * v1.3.4（2026-08-27）：把占位符变更写回原 .docx 模板文件
 *
 * 用户在「AI扩写规则编辑器」里增删占位符后，用差异补丁方式应用到原 docx：
 *  - removeFields：从 word/document.xml 里删除 {{字段}} 文本
 *  - addFields：在文档末尾段落追加 {{字段}}（保留原模板格式，不重建整个 XML）
 *
 * 不做"纯文本→docx XML 全量重建"，避免破坏原模板的样式/表格/页眉页脚。
 * 新增占位符以独立段落追加，用户可在 Word 里自行调整位置。
 */
export async function saveDocxTemplatePlaceholders(templatePath, { addFields = [], removeFields = [], placements = [] } = {}) {
  const PizZip = (await import('pizzip')).default
  const raw = fs.readFileSync(templatePath)
  const zip = new PizZip(raw)
  const docXmlPath = 'word/document.xml'
  let xml = zip.file(docXmlPath)?.asText()
  if (!xml) throw new Error('模板文件格式异常：未找到 word/document.xml')

  // 修复历史版本可能已经写入的相邻重复占位符，并保证再次分析/保存仍然幂等。
  xml = collapseAdjacentDuplicatePlaceholders(xml)

  // Idempotency guard: a split-run placeholder is still an existing field.
  // Do not insert it again merely because its raw token is not contiguous XML.
  const existingFields = new Set(extractDocxPlaceholdersFromXml(xml))

  // 1. 删除占位符：把 {{字段}} 文本从 XML 里移除（连同可能包裹的 run 边界清理）
  for (const field of removeFields) {
    const name = String(field).trim()
    if (!name) continue
    // 转义 XML 特殊字符（字段名一般不含，但兜底）
    const escaped = name.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
    // {{字段}} 在 docx XML 里可能被拆成多个 <w:t>（docxtemplater 渲染时能识别跨 run 占位符）
    // 但用户手动加的占位符通常是连续文本。先尝试整串删除，再尝试跨 run 拼接删除。
    const token = `{{${escaped}}}`
    // 简单情况：token 作为完整 <w:t> 文本存在
    xml = xml.replace(new RegExp(escapeRegExp(token), 'g'), '')
    // 跨 run 情况：{{ 在一个 w:t，字段名在下一个 w:t，}} 在第三个——用宽松匹配合并相邻 w:t
    // 这种情况罕见且复杂，这里用"移除残留的孤立 {{ 或 }}"兜底
    xml = xml.replace(/\{\{(?=<\/w:t>)/g, '')
    xml = xml.replace(/(?<=<w:t[^>]*>)\}\}/g, '')
  }

  // 2. 用户在映射区点选位置时，优先把占位符写到对应锚点后。
  const placed = new Set()
  const replaceIndexedBlock = (source, pattern, targetIndex, transform) => {
    const matches = [...source.matchAll(pattern)]
    const match = matches[targetIndex]
    if (!match || match.index == null) return { value: source, changed: false }
    const replacement = transform(match[0])
    return {
      value: source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length),
      changed: replacement !== match[0],
    }
  }
  const insertAtTableCell = (source, placement, token) => {
    if (![placement.tableIndex, placement.rowIndex, placement.cellIndex].every(Number.isInteger)) return { value: source, changed: false }
    return replaceIndexedBlock(source, /<w:tbl\b[\s\S]*?<\/w:tbl>/g, placement.tableIndex, tableXml => {
      return replaceIndexedBlock(tableXml, /<w:tr\b[\s\S]*?<\/w:tr>/g, placement.rowIndex, rowXml => {
        return replaceIndexedBlock(rowXml, /<w:tc\b[\s\S]*?<\/w:tc>/g, placement.cellIndex, cellXml => {
          if (cellXml.includes(token)) return cellXml
          const run = `<w:r><w:t xml:space="preserve">${token}</w:t></w:r>`
          if (placement.position === 'replace') {
            return cellXml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/, (_paragraph, attrs, inner) => {
              const paragraphProps = inner.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || ''
              const prefix = String(placement.prefix || '').replace(/[&<>\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[ch])
              const prefixRun = prefix ? `<w:r><w:t xml:space="preserve">${prefix}</w:t></w:r>` : ''
              return `<w:p${attrs}>${paragraphProps}${prefixRun}${run}</w:p>`
            })
          }
          // 长文本区必须使用独立段落，不能把多段正文塞进标签文字所在的 run。
          // docxtemplater(linebreaks=true) 会在该段内保留换行，表格行高由 Word 自动扩展。
          if (placement.block === true) return cellXml.replace('</w:tc>', `<w:p>${run}</w:p></w:tc>`)
          if (cellXml.includes('</w:p>')) return cellXml.replace('</w:p>', `${run}</w:p>`)
          return cellXml.replace('</w:tc>', `<w:p>${run}</w:p></w:tc>`)
        }).value
      }).value
    })
  }
  const insertAtParagraph = (source, placement, token) => {
    if (!Number.isInteger(placement.paragraphIndex)) return { value: source, changed: false }
    return replaceIndexedBlock(source, /<w:p\b[\s\S]*?<\/w:p>/g, placement.paragraphIndex, paragraphXml => {
      const run = `<w:r><w:t xml:space="preserve">${token}</w:t></w:r>`
      return paragraphXml.replace('</w:p>', `${run}</w:p>`)
    })
  }
  const decodeXmlText = value => String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  const insertAtAnchorParagraph = (source, placement, token, anchor) => {
    if (!anchor) return { value: source, changed: false }
    const matches = [...source.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    const normalizedAnchor = anchor.replace(/：/g, ':').replace(/\s+/g, '')
    const match = matches.find(candidate => {
      if (candidate[0].includes(token)) return false
      const logical = [...candidate[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => decodeXmlText(item[1])).join('').replace(/：/g, ':').replace(/\s+/g, '')
      return logical.includes(normalizedAnchor)
    })
    if (!match || match.index == null) return { value: source, changed: false }
    let replacement
    if (placement.replaceTail === true) {
      const attrs = match[0].match(/^<w:p\b([^>]*)>/)?.[1] || ''
      const props = match[0].match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || ''
      const prefix = anchor.replace(/[&<>\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[ch])
      replacement = `<w:p${attrs}>${props}<w:r><w:t xml:space="preserve">${prefix}</w:t></w:r><w:r><w:t xml:space="preserve">${token}</w:t></w:r></w:p>`
    } else {
      replacement = match[0].replace('</w:p>', `<w:r><w:t xml:space="preserve">${token}</w:t></w:r></w:p>`)
    }
    return { value: source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length), changed: true }
  }
  for (const placement of placements) {
    const name = String(placement?.field || '').trim()
    const anchor = String(placement?.anchor || '').trim()
    if (!name || (existingFields.has(name) && placement.repeat !== true)) continue
    const escapedName = name.replace(/[&<>\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[ch])
    const insertion = `{{${escapedName}}}`
    const cellResult = insertAtTableCell(xml, placement, insertion)
    if (cellResult.changed) {
      xml = cellResult.value
      placed.add(name)
      existingFields.add(name)
      continue
    }
    const paragraphResult = insertAtParagraph(xml, placement, insertion)
    if (paragraphResult.changed) {
      xml = paragraphResult.value
      placed.add(name)
      existingFields.add(name)
      continue
    }
    if (anchor) {
      const escapedAnchor = anchor.replace(/[&<>\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[ch])
      const exactIndex = placement.replaceTail !== true && placement.repeat !== true ? xml.indexOf(escapedAnchor) : -1
      if (exactIndex >= 0) {
        if (placement.position === 'replace') {
          xml = xml.slice(0, exactIndex) + insertion + xml.slice(exactIndex + escapedAnchor.length)
        } else {
          const at = placement.position === 'before' ? exactIndex : exactIndex + escapedAnchor.length
          xml = xml.slice(0, at) + insertion + xml.slice(at)
        }
        placed.add(name)
        existingFields.add(name)
        continue
      }
      const logicalParagraphResult = insertAtAnchorParagraph(xml, placement, insertion, anchor)
      if (logicalParagraphResult.changed) {
        xml = logicalParagraphResult.value
        placed.add(name)
        existingFields.add(name)
        continue
      }
      const index = xml.indexOf(escapedAnchor)
      if (index < 0) continue
      if (placement.position === 'replace') {
        xml = xml.slice(0, index) + insertion + xml.slice(index + escapedAnchor.length)
      } else {
        const at = placement.position === 'before' ? index : index + escapedAnchor.length
        xml = xml.slice(0, at) + insertion + xml.slice(at)
      }
      placed.add(name)
      existingFields.add(name)
    }
  }

  // 3. 没有可靠锚点的新增字段才追加到文档末尾，保证字段不会丢失。
  const addFieldsClean = [...new Set(addFields.map(f => String(f).trim()).filter(Boolean))]
    .filter(name => !placed.has(name) && !existingFields.has(name))
  if (addFieldsClean.length) {
    const paragraphs = addFieldsClean.map(name => {
      const escaped = name.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
      // 一个简单段落：{{字段}}，用默认样式
      return `<w:p><w:r><w:t>{{${escaped}}}</w:t></w:r></w:p>`
    }).join('')
    // 插在最后一个 </w:p> 之后、</w:body> 之前（若没有 </w:p> 则直接插 </w:body> 前）
    if (xml.includes('</w:body>')) {
      xml = xml.replace(/<\/w:body>/, `${paragraphs}</w:body>`)
    } else {
      xml += paragraphs
    }
  }

  xml = collapseAdjacentDuplicatePlaceholders(xml)

  // 4. 写回 zip
  zip.file(docXmlPath, xml)
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  fs.writeFileSync(templatePath, buffer)

  // 5. 重扫字段返回
  return await getTemplatePlaceholders(templatePath)
}

/**
 * v1.3.4（2026-08-27）：把占位符变更写回原 .xlsx 模板文件 + 同步 config.json
 *
 * xlsx 模板的占位符是直接写在单元格里的文本（如 F4 = "{{项目名称}}"）。
 * 基于 config.json 的 placeholder_cells + placeholders 定位单元格：
 *  - removeFields：清空对应单元格的占位符文本 + 从 config 删除条目
 *  - addFields：在 config 声明的 placeholder_cells 末尾追加新单元格坐标，
 *               在 xlsx 新行写入 {{字段}}（找不到空行时追加到末尾）
 *  - renameMap：{ 旧名: 新名 } 重命名占位符（改单元格文本 + config key）
 */
export async function saveXlsxTemplatePlaceholders(templatePath, configPath, { addFields = [], removeFields = [], renameMap = {} } = {}) {
  const { loadXlsx } = await import('./xlsxRuntime.mjs')
  const XLSX = await loadXlsx()
  const wb = XLSX.readFile(templatePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('xlsx 模板格式异常：未找到工作表')

  // 读 config.json
  let config = {}
  if (configPath && fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
  }
  const placeholders = config.placeholders || {}
  const placeholderCells = Array.isArray(config.placeholder_cells) ? [...config.placeholder_cells] : []
  // 建立 占位符名 → 单元格坐标 的映射（按 placeholders key 顺序与 placeholder_cells 顺序对应）
  const fieldNames = Object.keys(placeholders).map(k => k.replace(/^\{\{|\}\}$/g, '').trim())
  const fieldToCell = {}
  fieldNames.forEach((name, i) => {
    if (placeholderCells[i]) fieldToCell[name] = placeholderCells[i]
  })

  // 1. 删除占位符
  for (const field of removeFields) {
    const name = String(field).trim()
    if (!name) continue
    const cellRef = fieldToCell[name]
    if (cellRef && ws[cellRef]) {
      // 清空单元格占位符文本（保留单元格本身）
      delete ws[cellRef].v
      delete ws[cellRef].w
      ws[cellRef].t = 's'
    }
    delete placeholders[`{{${name}}}`]
  }

  // 2. 重命名占位符
  for (const [oldName, newName] of Object.entries(renameMap)) {
    const oldKey = `{{${String(oldName).trim()}}}`
    const newKey = `{{${String(newName).trim()}}}`
    if (!placeholders[oldKey]) continue
    const cellRef = fieldToCell[String(oldName).trim()]
    if (cellRef && ws[cellRef]) {
      ws[cellRef].v = newKey
      ws[cellRef].w = newKey
      ws[cellRef].t = 's'
    }
    placeholders[newKey] = placeholders[oldKey]
    delete placeholders[oldKey]
  }

  // 3. 新增占位符：找一个空单元格写入 {{字段}}
  //    策略：在已有 placeholder_cells 最大行 +2 的 A 列起依次排开
  const addFieldsClean = [...new Set(addFields.map(f => String(f).trim()).filter(Boolean))]
  if (addFieldsClean.length) {
    const maxRow = placeholderCells.reduce((max, ref) => {
      const m = String(ref).match(/^([A-Z]+)(\d+)$/)
      return m ? Math.max(max, Number(m[2])) : max
    }, 0)
    let nextRow = maxRow + 2
    let colIdx = 0
    for (const name of addFieldsClean) {
      const colLetter = columnIndexToLetter(colIdx)
      const cellRef = `${colLetter}${nextRow}`
      ws[cellRef] = { t: 's', v: `{{${name}}}`, w: `{{${name}}}` }
      placeholderCells.push(cellRef)
      placeholders[`{{${name}}}`] = { source: 'param', default: '' }
      colIdx++
      if (colIdx > 25) { colIdx = 0; nextRow++ }
    }
  }

  // 4. 写回 xlsx
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  fs.writeFileSync(templatePath, xlsxBuffer)

  // 5. 同步写回 config.json
  if (configPath) {
    config.placeholders = placeholders
    config.placeholder_cells = placeholderCells
    const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
    fs.renameSync(tmp, configPath)
  }

  // 6. 返回最新字段列表
  return Object.keys(placeholders).map(k => k.replace(/^\{\{|\}\}$/g, '').trim())
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function columnIndexToLetter(idx) {
  // 0 -> A, 25 -> Z, 26 -> AA
  let s = ''
  let n = idx
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}


/**
 * v1.2.2（2026-06-28）：正文段格式清洗（docx 渲染前的兜底）
 *
 * 修两个老板反馈的渲染问题：
 *  1. AI 输出"    一、安全防范要求" → 前面有 4 空格 + 模板首行缩进另设 → 视觉上"缩进不严谨"
 *     → 剥掉"一、""（一）""1."等序号前的所有前导空格
 *  2. docxtemplater 的 linebreaks:true 会把每个 \n 都转成 <w:br/>；\n\n 并不会
 *     生成 Word 新段落，而会生成两个软回车，中间形成肉眼可见的空白行。
 *     → 渲染前把连续换行统一为一个换行，并清理每行首尾空白。
 *
 * v1.2.4（2026-06-29 老板反馈）：AI 输出"事由：：国庆假期..."双冒号
 *   v1.2.3 regex 只剥一次前缀，剩"：国庆..."。修法：循环剥 + 兜底剥任何残留"：xxx"开头的列
 *
 * 实体模板内的多段正文统一使用单软回车；系统结构化文档另行生成真实段落。
 */
export function sanitizeBodyContent(value, projectType, { collapseBlankLines = true } = {}) {
  if (!value || typeof value !== 'string') return value
  let v = value.replace(/\r\n?/g, '\n')
  // 1. 剥掉序号前的空格（"    一、" → "一、"，"  （一）" → "（一）"，"   1." → "1."）
  v = v.replace(/^[ \t]+(?=[一二三四五六七八九十]+[、.]|[（(][一二三四五六七八九十][）)]|\d+[.)、])/gm, '')
  // 2. 一次性消除 AI 输出、字段解析和用户粘贴叠加产生的空白行。
  //    行内普通空格不动，只清理换行两侧的空格，避免模板中出现“空格行”。
  v = v
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()
  if (collapseBlankLines) v = v.replace(/\n{2,}/g, '\n')
  // 3. v1.2.7 兜底：信件语体清理（"尊敬的..."/"此致敬礼"）
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
  let v = value.replace(/\{\{待清理：信件语体(?:\s*-\s*[^}]*)?\}\}/g, '')

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

  return v.replace(/\n{3,}/g, '\n\n').trim()
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
export function validateDeliverableContent(value) {
  const text = String(value || '')
  const invalidMarkers = ['undefined', 'null', '{{待替换', '{{待补充', '{{待清理', '数据待核对', '签发前请核对', '项目类型校准声明', '📋', '━━━━━━━━']
  const markers = invalidMarkers.filter(marker => text.includes(marker))
  return { valid: markers.length === 0, markers }
}

/**
 * 从内容中解析 【key】value 格式的结构化数据
 * AI 输出中可能包含如：【施工部位】机房、弱电间 等段落
 */
function parseSections(content, knownKeys = new Set()) {
  const result = {}
  const markers = [...String(content || '').matchAll(/【([^】]+)】/g)]
  for (let index = 0; index < markers.length; index += 1) {
    const match = markers[index]
    const key = match[1].trim()
    // AI 正文经常使用“【依据：…】”“【提示】”等行内小标题。它们不是模板字段，
    // 不应把“正文内容”在这里截断；仅已登记的字段才可作为下一个字段边界。
    if (!key || !knownKeys.has(key)) continue
    const nextField = markers.slice(index + 1).find(item => knownKeys.has(item[1].trim()))
    const valueEnd = nextField ? nextField.index : String(content).length
    let value = String(content).slice(match.index + match[0].length, valueEnd).trim()
    if (key) {
      // v1.2.4（2026-06-29）：循环剥前缀（事由：：xxx → 事由：xxx → xxx）
      // 老板反馈 v1.2.3 的单次 regex 剥不干净，剩"：xxx"
      value = value ? sanitizeFieldValue(value) : ''
      result[key] = value
    }
  }
  return result
}

const OPTIONAL_BLANK_TEMPLATE_FIELDS = new Set([
  '局点名称', '表格行规格型号', '表格行备注', '表格行其它情况',
  '施工单位签名', '监理单位签名', '建设单位签名', '签名日期',
])

function normalizeOptionalTemplateValue(key, value) {
  const text = String(value || '').trim()
  if (OPTIONAL_BLANK_TEMPLATE_FIELDS.has(key) && /^(待确认|未提供|未明确|无|暂无)$/.test(text)) return ''
  return value
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
  templateFields = [],
  projectType = '',  // v1.2.5：用于正文禁用术语兜底替换
  layoutContract = null,
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
    if (source === 'computed') {
      if (/星期/.test(stripped)) value = `星期${'日一二三四五六'[now.getDay()]}`
      else if (/(日期|时间)/.test(stripped)) value = dateStr
      else value = defaultValue || `${dateNum}-001`
    }
    if (docType === '监理日志' && stripped === '天气' && !value) value = '未记录'
    if (docType === '监理日志' && stripped === '气温' && !value) value = '未记录'

    // 写回到所有别名
    const aliases = FIELD_ALIASES[stdKey] || [stripped]
    for (const alias of aliases) {
      data[alias] = value
    }
    // 也写原 key（防御）
    data[stripped] = value
  }

  // 实体模板字段可能没有 config 定义（企业/私人 DOCX 的常态），先建立空值槽位。
  for (const field of templateFields) {
    const key = String(field || '').trim()
    if (key && data[key] === undefined) data[key] = ''
  }

  // 4. 从 content 中解析 【key】value 结构化数据并覆盖
  const knownSectionKeys = new Set([
    ...Object.keys(data),
    ...Object.keys(placeholders).map(key => key.replace(/^\{\{|\}\}$/g, '').trim()),
    ...templateFields.map(key => String(key || '').trim()).filter(Boolean),
    ...getKnownAliases(),
    // 兼容旧模板和模型常用的正文写法。
    '正文内容', '正文', '内容',
  ])
  const sections = parseSections(content, knownSectionKeys)
  for (const [key, value] of Object.entries(sections)) {
    const stdKey = resolveKey(key)
    // 项目元数据由系统真相源回填，不能被模型输出的“待确认”等占位话术覆盖。
    // 日期例外：结构化输出中的显式空【日期】表示用户要求留空，必须覆盖系统当天默认值。
    // 仅项目名称和编号始终由系统真相源保护。
    if (stdKey && new Set(['projectName', 'fileNumber']).has(stdKey)) continue
    const aliases = stdKey ? (FIELD_ALIASES[stdKey] || [key]) : [key]
    const fieldContract = layoutContract?.fields?.[key]
      || aliases.map(alias => layoutContract?.fields?.[alias]).find(Boolean)
    const collapseBlankLines = fieldContract?.collapseBlankLines !== false
    for (const alias of aliases) {
      // v1.2.2（2026-06-28）：正文段格式清洗（解决"一、安全防范要求"前空格 + 不换行 bug）
      //   docxtemplater linebreaks:true 把单 \n 转软换行，要段落分隔必须 \n\n
      //   但 AI 经常输出"    一、安全防范要求\n（一）..." → 软换行 + 空格，渲染成一段
      //   修法：1) 剥"标题"前导空格  2) 单 \n 升级为 \n\n（除非已在 \n\n 中）
      // v1.2.5：传 projectType 进去做禁用术语兜底替换
      data[alias] = fieldContract?.mode === 'manual'
        ? ''
        : sanitizeBodyContent(normalizeOptionalTemplateValue(key, value), projectType, { collapseBlankLines })
    }
  }

  // “手工填写”是明确的出厂策略：无论该字段来自项目资料、config 默认值还是 AI 分段，
  // 均不自动写入。同步清空 Registry 别名，避免同一字段换一个别名后绕过合同。
  for (const [field, fieldContract] of Object.entries(layoutContract?.fields || {})) {
    if (fieldContract?.mode !== 'manual') continue
    const stdKey = resolveKey(field)
    const aliases = stdKey ? (FIELD_ALIASES[stdKey] || [field]) : [field]
    for (const alias of new Set([field, ...aliases])) data[alias] = ''
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
export async function renderTemplate(templatePath, data, options = {}) {
  const Docxtemplater = (await import('docxtemplater')).default
  const PizZip = (await import('pizzip')).default

  // 读取模板文件
  const tmplContent = fs.readFileSync(templatePath, 'binary')
  const zip = new PizZip(tmplContent)
  let templateXml = zip.file('word/document.xml')?.asText() || ''
  if (options.layoutContract) {
    templateXml = applyTemplateLayoutContract(templateXml, options.layoutContract)
    zip.file('word/document.xml', templateXml)
    for (const [field, fieldContract] of Object.entries(options.layoutContract.fields || {})) {
      if (fieldContract?.mode === 'manual') data[field] = ''
    }
  }
  // 周报未提供现场照片时，不得保留“影像资料”空白整页和蓝色表格。
  // 这是模板级可交付规则：有真实照片字段才保留附录；没有就完全移除。
  const photoKeys = ['图1路径', '图2路径', '图3路径', '图4路径']
  const hasPhoto = photoKeys.some(key => {
    const value = String(data[key] || '').trim()
    return value && value !== '数据待核对' && value !== '签发前请核对'
  })
  if (!hasPhoto && templateXml.includes('附录：本周现场影像资料记录')) {
    const appendixIndex = templateXml.indexOf('附录：本周现场影像资料记录')
    const prefix = templateXml.slice(0, appendixIndex)
    const paragraphStarts = [...prefix.matchAll(/<w:p(?:\s[^>]*)?>/g)]
    const paragraphStart = paragraphStarts.at(-1)?.index ?? -1
    const tableStart = templateXml.indexOf('<w:tbl', appendixIndex)
    const tableEnd = templateXml.indexOf('</w:tbl>', tableStart)
    if (paragraphStart >= 0 && tableStart >= 0 && tableEnd >= 0) {
      templateXml = templateXml.slice(0, paragraphStart) + templateXml.slice(tableEnd + '</w:tbl>'.length)
    }
    zip.file('word/document.xml', templateXml)
  }
  if (!hasPhoto) {
    // buildPlaceholderData 的 config 默认值会先写入“数据待核对”，这里必须覆盖为空。
    for (const key of ['图1路径', '图1说明', '图2路径', '图2说明', '图3路径', '图3说明', '图4路径', '图4说明']) {
      data[key] = ''
    }
  }
  // 模板可由项目自行替换，字段集合不能再靠全局 config 假定。
  // 未提供的系统字段留空而不是写入内部“数据待核对”标记；后者会污染
  // 交付件并使用户在没有可编辑字段的情况下无法保存。
  for (const key of new Set([...templateXml.matchAll(/\{\{([^}]{1,80})\}\}/g)].map(m => m[1].trim()))) {
    if (data[key] === undefined || data[key] === null) data[key] = ''
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

  const renderedZip = doc.getZip()
  const renderedXml = renderedZip.file('word/document.xml')?.asText() || ''
  renderedZip.file('word/document.xml', applyTemplateChoiceDefaults(renderedXml, { sourceText: data.subject || '' }))

  // 生成输出 buffer
  const buffer = renderedZip.generate({
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

// =============================================================================
// 系统正式件版式
// =============================================================================
// 旧版 Word 模板大多用固定高度表格承载长正文；正文虽已替换，实际打开时会
// 产生空白页、截断或字体缺失。系统预置模板改由这里的结构化版式输出：
// 占位符数据仍是唯一内容来源，但长内容只落在可自然分页的段落中。
// 项目模板/企业模板不会走此分支，仍由 renderTemplate 保持原样渲染。
const STRUCTURED_SYSTEM_DOC_TYPES = new Set([
  '监理日志', '监理周报', '监理月报', '整改通知书', '安全通知书', '工程联系单', '进度分析报告',
])

// v1.x：自定义文种 inStructuredWhitelist=true 的项注入白名单
const customStructuredDocTypes = new Set()

export function setCustomStructuredDocTypes(list) {
  customStructuredDocTypes.clear()
  if (!Array.isArray(list)) return
  for (const item of list) {
    if (item && item.inStructuredWhitelist && (item.label || item.code)) {
      customStructuredDocTypes.add(item.label)
      if (item.code) customStructuredDocTypes.add(item.code)
    }
  }
}

export function supportsStructuredSystemLayout(docType) {
  return STRUCTURED_SYSTEM_DOC_TYPES.has(docType) || customStructuredDocTypes.has(docType)
}

// 系统正式件不允许把关键段落默认为“—”后继续出厂。
// 自定义项目/企业模板仍可按自身字段配置；本规则只约束系统交付版。
const STRUCTURED_REQUIRED_FIELDS = {
  '监理日志': ['施工部位', '参与人员', '今日内容', '核心工作落实', '协调解决情况', '其他事项'],
  '监理周报': ['日期范围', '周数', '形象进度说明', '周进度详情', '安全质量描述', '存在问题', '下周计划', '监理建议'],
  '监理月报': ['日期范围', '月份', '形象进度说明', '本月进度详情', '本月质量描述', '本月安全描述', '存在问题', '监理履职情况', '下月计划'],
  '进度分析报告': ['报告期', '总体进度', '进度偏差', '偏差原因', '风险提示', '建议措施', '下月计划'],
  '整改通知书': ['致单位', '事由', '正文内容'],
  '安全通知书': ['致单位', '事由', '正文内容'],
  '工程联系单': ['致单位', '主题', '正文内容'],
}

export function validateStructuredSystemData(docType, data) {
  const required = STRUCTURED_REQUIRED_FIELDS[docType] || []
  const missing = required.filter(key => !String(data[key] ?? '').trim())
  return { valid: missing.length === 0, missing }
}

function splitDocumentParagraphs(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
}

/** 生成系统预置模板的可签发 DOCX；仅使用结构化占位字段，不混入任何 AI 校准信息。 */
export async function renderStructuredSystemDocument(docType, data) {
  const docx = await import('docx')
  const { Document, Packer, Paragraph, TextRun, AlignmentType, PageNumber } = docx
  const profile = getFormatProfile(docType)
  const styles = profile.styles
  const font = FONTS.body
  const titleFont = FONTS.title
  const alignment = (value) => ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT, left: AlignmentType.LEFT, justify: AlignmentType.JUSTIFIED }[value] || AlignmentType.LEFT)
  const value = (key) => String(data[key] ?? '').trim()
  const body = (text) => splitDocumentParagraphs(text).map(item => {
    const role = detectParagraphRole(item)
    const style = styles[role] || styles.body
    return new Paragraph({
      children: [new TextRun({ text: item, font: style.font, size: style.size, bold: style.bold })],
      alignment: alignment(style.align),
      indent: { firstLine: Math.max(0, style.firstLine || 0), left: Math.max(0, style.left || 0), hanging: Math.max(0, style.hanging || 0) },
      spacing: { line: style.line || styles.body.line, lineRule: 'exact', before: style.before || 0, after: style.after || 0 },
      keepNext: Boolean(style.keepNext),
      widowControl: true,
    })
  })
  const heading = (text, level = 1) => new Paragraph({
    children: [new TextRun({ text, font: styles.h1.font, size: styles.h1.size, bold: styles.h1.bold })],
    spacing: { before: styles.h1.before, after: styles.h1.after, line: styles.body.line, lineRule: 'exact' },
    keepNext: true,
  })
  const title = (text) => new Paragraph({
    children: [new TextRun({ text, font: titleFont, size: styles.title.size, bold: styles.title.bold })],
    alignment: AlignmentType.CENTER,
    spacing: { before: styles.title.before, after: styles.title.after },
    keepNext: true,
  })
  // 正式件头部采用字段行而非固定高度表格。旧模板的窄列在 Word/Quick Look/WPS
  // 间解释不一致，长项目名会竖排并挤压正文；字段行可自然换行，跨办公软件稳定。
  const meta = (pairs) => pairs.map(row => new Paragraph({
    children: [
      new TextRun({ text: `${row[0]}：`, font: styles.meta.font, size: styles.meta.size, bold: true }),
      new TextRun({ text: row[1] || '—', font: styles.meta.font, size: styles.meta.size }),
      new TextRun({ text: `    ${row[2]}：`, font: styles.meta.font, size: styles.meta.size, bold: true }),
      new TextRun({ text: row[3] || '—', font: styles.meta.font, size: styles.meta.size }),
    ],
    spacing: { after: styles.meta.after, line: styles.meta.line, lineRule: 'exact' },
    widowControl: true,
  }))
  const children = []
  const appendSections = (sections) => {
    for (const [label, content] of sections) {
      if (!String(content || '').trim()) continue
      children.push(heading(label))
      children.push(...body(content))
    }
  }

  if (docType === '监理日志') {
    children.push(title('监 理 日 志'))
    children.push(...meta([['项目名称', value('项目名称'), '日期', value('日期')], ['施工部位', value('施工部位'), '天气/气温', [value('天气'), value('气温')].filter(Boolean).join(' / ')]]))
    appendSections([['一、参与人员', value('参与人员')], ['二、当日监理工作', value('今日内容')], ['三、核心工作落实', value('核心工作落实')], ['四、问题及协调处理', value('协调解决情况')], ['五、其他事项及次日计划', value('其他事项')]])
  } else if (docType === '监理周报') {
    children.push(title('监 理 周 报'))
    children.push(...meta([['项目名称', value('项目名称'), '报告期', value('日期范围')], ['周次', value('周数'), '报告日期', value('日期')], ['建设单位', value('甲方单位'), '施工单位', value('乙方单位')], ['监理单位', value('监理单位'), '总监理工程师', value('总监姓名')]]))
    appendSections([['一、本周形象进度', value('形象进度说明')], ['二、本周工作开展情况', value('周进度详情')], ['（一）集采材料与设备', value('集采部分内容')], ['（二）非集采材料与设备', value('非集采部分内容')], ['（三）到货与安装统计', value('到货安装统计')], ['三、质量安全管控', value('安全质量描述')], ['四、存在问题及处理情况', value('存在问题')], ['五、下周工作计划', value('下周计划')], ['六、监理建议', value('监理建议')]])
  } else if (docType === '监理月报') {
    children.push(title('监 理 月 报'))
    children.push(...meta([['项目名称', value('项目名称'), '报告期', value('日期范围')], ['月份', value('月份'), '报告日期', value('日期')], ['建设单位', value('甲方单位'), '施工单位', value('乙方单位')], ['监理单位', value('监理单位'), '总监理工程师', value('总监姓名')]]))
    appendSections([['一、项目概况及本月综述', value('形象进度说明')], ['二、本月进度管理', value('本月进度详情')], ['三、工程量及累计完成情况', [value('本月完成工程量'), value('累计完成情况'), value('到货安装统计')].filter(Boolean).join('\n\n')], ['四、投资完成情况', value('本月投资情况')], ['五、质量管理情况', value('本月质量描述')], ['六、安全管理情况', value('本月安全描述')], ['七、问题及监理履职情况', [value('存在问题'), value('监理履职情况')].filter(Boolean).join('\n\n')], ['八、监理建议及下月计划', [value('监理建议'), value('下月计划')].filter(Boolean).join('\n\n')]])
  } else if (docType === '进度分析报告') {
    children.push(title('项目进度分析报告'))
    children.push(...meta([['项目名称', value('项目名称'), '项目代码', value('项目代码')], ['报告期', value('报告期'), '报告日期', value('报告日期')], ['监理单位', value('监理单位'), '编制人', value('编制人')]]))
    appendSections([['一、总体进度概况', value('总体进度')], ['二、进度偏差分析', [value('进度偏差'), value('偏差原因')].filter(Boolean).join('\n\n')], ['三、风险提示', value('风险提示')], ['四、建议措施', value('建议措施')], ['五、下月工作计划', value('下月计划')]])
  } else {
    const documentTitle = docType === '整改通知书' ? '监理整改通知书' : docType === '安全通知书' ? '监理安全通知书' : '工程联系单'
    children.push(title(documentTitle))
    children.push(...meta([['项目名称', value('项目名称'), '文件编号', value('文件编号')], ['致单位', value('致单位'), '日期', value('日期')], ['事由', value('事由') || value('主题'), '监理单位', value('监理单位')]]))
    children.push(...body(value('正文内容') || value('内容') || value('正文')))
    children.push(new Paragraph({ children: [new TextRun({ text: value('监理单位') || '监理机构', font: styles.closing.font, size: styles.closing.size })], alignment: alignment(styles.closing.align), spacing: { before: styles.closing.before, line: styles.closing.line, lineRule: 'exact' } }))
    children.push(new Paragraph({ children: [new TextRun({ text: value('日期'), font: styles.closing.font, size: styles.closing.size })], alignment: alignment(styles.closing.align), spacing: { line: styles.closing.line, lineRule: 'exact' } }))
  }

  const document = new Document({
    styles: { default: { document: { run: { font, size: styles.body.size }, paragraph: { spacing: { line: styles.body.line, lineRule: 'exact' } } } } },
    sections: [{
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } },
      footers: { default: new docx.Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '— ', font: FONTS.pageNumber, size: 28 }), new TextRun({ children: [PageNumber.CURRENT], font: FONTS.pageNumber, size: 28 }), new TextRun({ text: ' —', font: FONTS.pageNumber, size: 28 })] })] }) },
      children,
    }],
  })
  return Packer.toBuffer(document)
}

/**
 * 渲染 xlsx 模板 — 将占位符数据写入 xlsx 单元格
 * 使用 xlsx (SheetJS) 库，根据 config.json 中的单元格映射写入值
 * 目前主要供 监理日志 使用
 */
export async function renderXlsxTemplate(templatePath, data, cellMappings) {
  const { loadXlsx } = await import('./xlsxRuntime.mjs')
  const XLSX = await loadXlsx()

  // 读取模板
  const wb = XLSX.readFile(templatePath)
  const ws = wb.Sheets[wb.SheetNames[0]]

  // 兼容历史监理日志映射；正式模板统一使用 config.placeholder_cells 与
  // config.placeholders 的同序映射，不再按文种写死单元格。
  const LEGACY_CELL_FIELDS = {
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
  const mappings = Array.isArray(cellMappings) && cellMappings.length
    ? cellMappings.map(item => typeof item === 'string'
      ? { cell: item, field: LEGACY_CELL_FIELDS[item] }
      : item)
    : Object.entries(LEGACY_CELL_FIELDS).map(([cell, field]) => ({ cell, field }))
  for (const { cell: cellRef, field: placeholderName } of mappings) {
    if (!cellRef || !placeholderName) continue
    if (!ws[cellRef]) continue
    const value = data[placeholderName]
    // 即使字段没有事实，也必须把模板占位符清空。旧逻辑只在非空值时写入，
    // 会把 {{变更原因}} 等原样留在正式 XLSX 中。
    const cell = ws[cellRef]
    cell.v = value == null ? '' : value
    cell.t = 's'
    cell.w = String(cell.v)
  }

  // 生成 buffer（不应用样式，保留模板原始样式）
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** 扫描 XLSX 所有工作表中的残留模板占位符。 */
export async function getXlsxPlaceholderResidues(buffer) {
  const { loadXlsx } = await import('./xlsxRuntime.mjs')
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const residues = new Set()
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName]
    for (const [cellRef, cell] of Object.entries(sheet || {})) {
      if (cellRef.startsWith('!') || typeof cell?.v !== 'string') continue
      for (const match of cell.v.matchAll(/\{\{[^{}]{1,80}\}\}/g)) residues.add(`${sheetName}!${cellRef}:${match[0]}`)
    }
  }
  return [...residues]
}

// =============================================================================
// GB/T 9704-2012 格式规范常量与辅助函数
// =============================================================================

const STYLE_MAP = {
  // 使用 macOS 自带中文字体。此前模板中的“仿宋_GB2312/黑体/楷体_GB2312”
  // 在未安装 Office 字体的 Mac 上会被 LibreOffice/预览器渲染为方框，无法交付。
  h1:      { font: 'Heiti SC', sz: 30, bold: false, align: 'left',    firstLine: 0    },
  h2:      { font: 'Kaiti SC',  sz: 32, bold: true,  align: 'left',    firstLine: 0    },
  h3:      { font: 'Songti SC', sz: 32, bold: false, align: 'left',    firstLine: 0    },
  h4:      { font: 'Songti SC', sz: 32, bold: false, align: 'left',    firstLine: 0    },
  body:    { font: 'Songti SC', sz: 32, bold: false, align: 'justify', firstLine: 640  },
  closing: { font: 'Songti SC', sz: 32, bold: false, align: 'right',   firstLine: 0    },
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
  const size = style.sz ?? style.size ?? 28
  return `<w:rPr><w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}" w:eastAsia="${style.font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${boldXml}</w:rPr>`
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
function formatBrParagraph(pBlock, docType = '') {
  const profile = getFormatProfile(docType)
  let result = pBlock

  // 单个模板占位段内含多行内容：段落级保持两端对齐，具体字体和字重按每行角色处理。
  result = result.replace(/<w:pPr[\s\S]*?<\/w:pPr>/, (pPr) => {
    return applyPPrFormatting(pPr, 'justify', 0)
  })
  if (!result.includes('<w:pPr')) {
    result = result.replace('<w:p>', `<w:p><w:pPr><w:spacing w:line="${profile.styles.body.line}" w:lineRule="exact"/><w:jc w:val="both"/></w:pPr>`)
  }

  // 清除占位符从模板继承的整段加粗；只让一级标题使用黑体/加粗，正文使用仿宋常规字重。
  result = result.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (runXml) => {
    const text = runXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/)?.[1]?.replace(/&quot;|&amp;|&lt;|&gt;/g, '') || ''
    if (!text.trim()) return runXml
    const role = detectParagraphRole(text)
    const style = profile.styles[role] || profile.styles.body
    const rPr = buildRPrXml(style)
    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(runXml)) return runXml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, rPr)
    return runXml.replace(/(<w:r\b[^>]*>)/, `$1${rPr}`)
  })

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
export async function formatDocx(docxPath, templateUsed = true, docType = '', preserveTemplateLayout = templateUsed) {
  const { default: PizZip } = await import('pizzip')
  if (!fs.existsSync(docxPath)) {
    console.warn('[formatDocx] docx not found at', docxPath)
    return false
  }

  try {
    const zip = new PizZip(fs.readFileSync(docxPath))
    // 字体定义既可能写在正文 run 中，也可能留在 styles/theme/header/footer。
    // 仅改 document.xml 会让 LibreOffice/WPS 仍按模板中的 Windows 专有字体渲染，
    // 出现中文缺字（方框）。对所有 Word XML 部件做同一兼容替换。
    const normalizeFonts = (partXml) => partXml
      .replaceAll('仿宋_GB2312', 'Songti SC')
      .replaceAll('方正小标宋简体', 'Songti SC')
      .replaceAll('楷体_GB2312', 'Kaiti SC')
      .replaceAll('Microsoft YaHei', 'Songti SC')
      .replaceAll('微软雅黑', 'Songti SC')
      .replaceAll('SimSun', 'Songti SC')
      .replaceAll('w:eastAsia="宋体"', 'w:eastAsia="Songti SC"')
      .replaceAll('黑体', 'Heiti SC')
      .replace(/<w:rFonts\b([^>]*?)\/>/g, (tag, attrs) => {
        const cleaned = attrs.replace(/\s+w:eastAsia="[^"]*"/g, '')
        return `<w:rFonts${cleaned} w:eastAsia="${FONTS.body}"/>`
      })

    for (const fileName of Object.keys(zip.files)) {
      if (!/^word\/(?:document|styles|header\d+|footer\d+|theme\/theme\d+)\.xml$/.test(fileName)) continue
      // 页眉页脚属于模板受保护资产，正式渲染必须逐字节保持不变；字体兼容
      // 仅处理正文、样式和主题，不能为了跨平台显示破坏签章/页码/企业抬头。
      if (preserveTemplateLayout && /^word\/(?:header|footer)\d+\.xml$/.test(fileName)) continue
      const part = zip.file(fileName)
      if (part) {
        let partXml = normalizeFonts(part.asText())
        if (preserveTemplateLayout) {
          zip.file(fileName, partXml)
          continue
        }
        if (fileName === 'word/styles.xml') {
          const defaults = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONTS.body}" w:hAnsi="${FONTS.body}" w:eastAsia="${FONTS.body}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="560" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>`
          if (/<w:docDefaults\b/.test(partXml)) partXml = partXml.replace(/<w:docDefaults\b[^>]*>[\s\S]*?<\/w:docDefaults>/, defaults)
          else partXml = partXml.replace(/(<w:styles\b[^>]*>)/, `$1${defaults}`)
        }
        zip.file(fileName, partXml)
      }
    }

    const docFile = zip.file('word/document.xml')
    if (!docFile) {
      console.warn('[formatDocx] word/document.xml not found in', docxPath)
      return false
    }

    let xml = docFile.asText()

    // 将系统模板中只在 Windows Office 上可用的旧字体，统一替换为本机可用字体。
    // 保留字号、加粗、对齐和版式，仅做字体兼容性处理。
    xml = normalizeFonts(xml)

    // === 1. 模板路径：只格式化含 <w:br/> 的段落（即 {{正文内容}} 产物）===
    //     有 <w:br/> → 分段检测（按 <w:br/> 分组，每行独立识别标题/正文）
    //     无 <w:br/> → 统一检测（第一段文本决定整段字体）
    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (pBlock) => {
      if (templateUsed && !/<w:br\/>/.test(pBlock)) return pBlock
      if (!/<w:t[^>]*>/.test(pBlock)) return pBlock
      if (/<w:br\/>/.test(pBlock)) {
        return formatBrParagraph(pBlock, docType)
      }
      return applyStyleToParagraph(pBlock)
    })

    // 企业通知模板常用“项目名称 + 大段空格 + 编号”的单行表头。
    // 项目编码加入正式编号后长度增加，统一将该元数据行收紧到五号字，避免编号折到下一行破坏表头。
    if (preserveTemplateLayout) {
      xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (pBlock) => {
        const plainText = [...pBlock.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('')
        if (!plainText.includes('项目名称') || !plainText.includes('编号')) return pBlock
        return pBlock
          .replace(/<w:sz\b[^>]*\/>/g, '<w:sz w:val="21"/>')
          .replace(/<w:szCs\b[^>]*\/>/g, '<w:szCs w:val="21"/>')
      })
    }

    // === 2. 行距兜底（28pt 固定）===
    if (!preserveTemplateLayout) {
      xml = xml.replace(/(<w:pPr[\s\S]*?)(?:<\/w:pPr>)/g, (match, pPrContent) => {
        if (/<w:spacing\b/.test(pPrContent)) return match
        return pPrContent + '<w:spacing w:line="560" w:lineRule="exact"/></w:pPr>'
      })
    }

    // === 3. A4 纸张与页边距（统一排版引擎）===
    if (!preserveTemplateLayout) {
      const pageSize = `<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>`
      if (/<w:pgSz\b/.test(xml)) xml = xml.replace(/<w:pgSz\s[^/]*\/>/g, pageSize)
      else xml = xml.replace(/<w:sectPr>/g, '<w:sectPr>' + pageSize)
      if (/<w:pgMar\b/.test(xml)) xml = xml.replace(/<w:pgMar\s[^/]*\/>/g, GB_PAGE_MARGINS)
      else xml = xml.replace(/<w:sectPr>/g, '<w:sectPr>' + GB_PAGE_MARGINS)
    }

    // === 4. 降级路径 run 字体兜底 ===
    if (!templateUsed) {
      xml = xml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (match, inner) => {
        if (/<w:rPr>/.test(inner)) return match
        return '<w:r><w:rPr><w:rFonts w:ascii="Songti SC" w:hAnsi="Songti SC" w:eastAsia="Songti SC"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>' + inner + '</w:r>'
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

/** 保存前的格式质量门禁。 */
export async function validateDocxFormatting(docxPath, docType = '', preserveTemplateLayout = false) {
  const { default: PizZip } = await import('pizzip')
  try {
    const zip = new PizZip(fs.readFileSync(docxPath))
    const documentXml = zip.file('word/document.xml')?.asText() || ''
    const stylesXml = zip.file('word/styles.xml')?.asText() || ''
    return formatAuditFromXml(documentXml, stylesXml, docType, { preserveTemplateLayout })
  } catch (error) {
    return { valid: false, issues: [`DOCX 结构损坏：${error.message}`], layer: getFormatProfile(docType).layer }
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
// keepEmpty=true 时，空目录也返回 category（children:[]），用于专业空态展示
function buildTemplateTree(dirPath, options = {}) {
  const keepEmpty = !!options.keepEmpty
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
      const children = buildTemplateTree(entryPath, { keepEmpty })
      if (children.length === 0 && !keepEmpty) continue
      // 读取 config.json 以便上层判断 is_professional 标记（旧布局回退用）
      let config = {}
      const configPath = path.join(entryPath, 'config.json')
      if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
      }
      items.push({
        name: entry.name,
        path: entryPath,
        type: 'category',
        displayName: stripNumberPrefix(entry.name),
        children,
        config,
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
 * 构建模板资源目录 — 扫描 templates/通用/ 返回结构化树
 *
 * v1.3.2 模板做减法后：只扫描 templates/通用/，专业模板由用户上传到企业模板库
 * （templates/专业/ 已在首次启动时由 migrateBuiltinProfessionalTemplates 迁移到企业库）。
 * 排除 format-spec/ 目录和非模板文件。
 */
export function buildTemplateCatalog(templatesDir) {
  if (!fs.existsSync(templatesDir)) return []

  const generalDir = path.join(templatesDir, '通用')
  if (!fs.existsSync(generalDir)) return []

  const generalItems = buildTemplateTree(generalDir, { keepEmpty: false })
  if (generalItems.length === 0) return []

  return [{
    name: '00_通用类型模板',
    path: generalDir,
    type: 'category',
    displayName: '通用类型模板',
    children: generalItems,
    docxCount: countDocx(generalItems),
  }]
}

function countDocx(items) {
  let count = 0
  for (const item of items) {
    if (item.type === 'item') count++
    if (item.children) count += countDocx(item.children)
  }
  return count
}

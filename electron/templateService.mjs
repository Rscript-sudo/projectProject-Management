/**
 * 模板服务 — 加载 .docx 模板文件，替换占位符，生成文档
 *
 * 模板目录：项目根目录下的 templates/
 * 每个文档类型一个子目录，包含 config.json 和 .docx 模板文件
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')

// 字段别名映射（与 src/shared/fieldRegistry.ts 保持一致，服务端独立维护副本）
// 模板里出现 {{XXX}} 时，这里给出所有可能的标准 key 别名
const FIELD_ALIASES = {
  projectName: ['项目名称', '工程名称'],
  ownerUnit: ['建设单位', '甲方', '建设方', '业主单位', '业主'],
  contractor: ['施工单位', '乙方', '承建单位', '致单位', '致送单位'],
  supervisorUnit: ['监理单位', '监理公司', '监理机构'],
  chiefEngineer: ['总监理工程师', '总监姓名', '总监理'],
  date: ['日期', '签章日期', '报告日期', '检查日期'],
  fileNumber: ['文件编号', '编号', '文号'],
  weekNumber: ['周数'],
  monthNumber: ['月份'],
  subject: ['事由', '主题', '摘要'],
  content: ['正文内容', '内容', '正文', '主要内容'],
}

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
export function findTemplate(templatesDir, docType) {
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

  return {
    templatePath: path.join(dirPath, tmplFile),
    config,
  }
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
    const value = match[2].trim()
    if (key && value) {
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
  ownerUnit = '建设单位',
  contractor = '施工单位',
  supervisorUnit = '监理单位',
  chiefEngineer = '总监理工程师',
  userInput = '',
  content = '',
  config = {},
}) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`
  const dateNum = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  // 1. 标准 canonical（基于 FieldRegistry 的 key）
  const canonical = {
    projectName: projectName || '',
    ownerUnit: ownerUnit || '建设单位',
    contractor: contractor || '施工单位',
    supervisorUnit: supervisorUnit || '监理单位',
    chiefEngineer: chiefEngineer || '总监理工程师',
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
      data[alias] = value
    }
  }

  console.log('[templateService] Built placeholder data (registry):', Object.keys(data).length, 'keys')
  return data
}

/**
 * 渲染模板 — 用 docxtemplater 替换占位符并输出 buffer
 */
export async function renderTemplate(templatePath, data) {
  const Docxtemplater = (await import('docxtemplater')).default
  const PizZip = (await import('pizzip')).default

  // 读取模板文件
  const tmplContent = fs.readFileSync(templatePath, 'binary')
  const zip = new PizZip(tmplContent)

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
  return doc.getZip().generate({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

/**
 * 渲染 xlsx 模板 — 将占位符数据写入 xlsx 单元格
 * 使用 xlsx (SheetJS) 库，根据 config.json 中的单元格映射写入值
 * 目前主要供 监理日志 使用
 */
export async function renderXlsxTemplate(templatePath, data, cellMappings) {
  const XLSX = await import('xlsx')

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

/**
 * 格式刷 — 对已生成的 docx 文件应用格式规范（字体/字号/行距/页边距）
 * 纯 JS 实现，无 Python 依赖
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

    // === 1. 确保每段落都有 <w:pPr> ===
    xml = xml.replace(/<w:p\b[^>]*>(?!\s*<w:pPr\b)/g, '$&<w:pPr/>')

    // === 2. 行距：固定28pt（560 twips）===
    // 对每个段落的 <w:pPr> 添加 spacing（已有则跳过）
    xml = xml.replace(
      /(<w:pPr[\s\S]*?)(?:<\/w:pPr>)/g,
      (match, pPrContent) => {
        if (/<w:spacing\b/.test(pPrContent)) return match
        return pPrContent + '<w:spacing w:line="560" w:lineRule="exact"/></w:pPr>'
      }
    )

    // === 3. 全量模式：页边距（GB/T 9704-2012 A4标准） ===
    // 上3.7cm(1332000emu) 下3.5cm(1260000emu) 左2.8cm(1008000emu) 右2.6cm(936000emu)
    if (!templateUsed) {
      const pgMar = '<w:pgMar w:top="1332000" w:bottom="1260000" w:left="1008000" w:right="936000" w:header="720" w:footer="720" w:gutter="0"/>'
      // 检查 section 属性中是否已有 pgMar
      if (/<w:pgMar\b/.test(xml)) {
        xml = xml.replace(/<w:pgMar\s[^/]*\/>/g, pgMar)
      } else {
        xml = xml.replace(/<w:sectPr>/g, '<w:sectPr>' + pgMar)
      }
    }

    // === 4. 全量模式：为无字体设置的 run 添加默认字体 ===
    if (!templateUsed) {
      xml = xml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (match, inner) => {
        if (/<w:rPr>/.test(inner)) return match
        return '<w:r><w:rPr><w:rFonts w:ascii="仿宋" w:hAnsi="仿宋" w:eastAsia="仿宋"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>' + inner + '</w:r>'
      })
    }

    // === 5. 写入修改后的 XML ===
    zip.file('word/document.xml', xml)
    fs.writeFileSync(docxPath, zip.generate({ type: 'nodebuffer' }))

    console.log('[formatDocx] OK:', docxPath, templateUsed ? '(light)' : '(full)')
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

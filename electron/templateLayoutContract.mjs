import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LAYOUT_CONTRACT_SCHEMA_VERSION = 1

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function getTemplateLayoutContractPath(templatePath) {
  const extension = path.extname(templatePath)
  return `${templatePath.slice(0, -extension.length)}.layout.json`
}

function xmlText(value = '') {
  return String(value)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

export function extractTemplateChoiceGroups(documentXml = '') {
  const rows = String(documentXml || '').match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || []
  const withoutRows = String(documentXml || '').replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, '')
  const blocks = [...rows, ...(withoutRows.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [])]
  const groups = []
  for (const [index, block] of blocks.entries()) {
    const plain = xmlText(block).replace(/\s+/g, ' ').trim()
    const options = [...plain.matchAll(/[□☐☑☒]\s*(不合格|不符合|合格|符合)/g)].map(match => match[1])
    if (!options.length || !options.some(option => /^(?:合格|符合)$/.test(option))) continue
    const firstMark = plain.search(/[□☐☑☒]\s*(?:不合格|不符合|合格|符合)/)
    groups.push({
      id: `choice-${index}`,
      kind: 'single-choice',
      label: plain.slice(Math.max(0, firstMark - 40), firstMark).trim(),
      options: [...new Set(options)],
      defaultValue: '合格',
      source: 'template',
    })
  }
  return groups
}

function attr(xml, name) {
  return xml.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]
}

function halfPoints(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number / 2 : undefined
}

function twipsToPoints(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number / 20 : undefined
}

function extractParagraphFormat(paragraphXml = '', runXml = '') {
  const pPr = paragraphXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] || ''
  const rPr = runXml.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/)?.[0] || ''
  const fonts = rPr.match(/<w:rFonts\b[^>]*\/>/)?.[0] || ''
  const size = rPr.match(/<w:sz\b[^>]*\/>/)?.[0] || ''
  const spacing = pPr.match(/<w:spacing\b[^>]*\/>/)?.[0] || ''
  const indent = pPr.match(/<w:ind\b[^>]*\/>/)?.[0] || ''
  return {
    font: attr(fonts, 'w:eastAsia') || attr(fonts, 'w:ascii') || attr(fonts, 'w:hAnsi') || 'inherit',
    fontSize: halfPoints(attr(size, 'w:val')),
    bold: /<w:b(?:\s|\/|>)/.test(rPr),
    alignment: attr(pPr.match(/<w:jc\b[^>]*\/>/)?.[0] || '', 'w:val') || 'inherit',
    lineSpacing: twipsToPoints(attr(spacing, 'w:line')),
    lineRule: attr(spacing, 'w:lineRule') || 'inherit',
    spaceBefore: twipsToPoints(attr(spacing, 'w:before')),
    spaceAfter: twipsToPoints(attr(spacing, 'w:after')),
    firstLineIndent: twipsToPoints(attr(indent, 'w:firstLine')),
    leftIndent: twipsToPoints(attr(indent, 'w:left')),
  }
}

function protectedAssetNames(zip) {
  return Object.keys(zip.files).filter(name =>
    /^word\/(?:header\d+\.xml|footer\d+\.xml|media\/|theme\/|settings\.xml$)/.test(name),
  )
}

function assetManifest(zip) {
  const manifest = {}
  for (const name of protectedAssetNames(zip)) {
    const file = zip.file(name)
    if (file) manifest[name] = sha256(Buffer.from(file.asUint8Array()))
  }
  return manifest
}

export async function extractTemplateLayoutContract(templatePath, { docType = '', write = true } = {}) {
  const extension = path.extname(templatePath).toLowerCase()
  const templateBuffer = fs.readFileSync(templatePath)
  const templateHash = sha256(templateBuffer)
  const contract = {
    schemaVersion: LAYOUT_CONTRACT_SCHEMA_VERSION,
    docType,
    templatePath: path.basename(templatePath),
    templateHash,
    extractedAt: new Date().toISOString(),
    mode: extension === '.docx' ? 'docx' : extension === '.xlsx' ? 'xlsx' : 'unknown',
    preserve: { headers: true, footers: true, media: true, tables: true, borders: true, sectionProperties: true },
    defaults: { fieldMode: 'inherit', collapseBlankLines: true },
    fields: {},
    choiceGroups: [],
    protectedAssets: {},
    warnings: [],
  }

  if (extension === '.docx') {
    const { default: PizZip } = await import('pizzip')
    const zip = new PizZip(templateBuffer)
    const documentXml = zip.file('word/document.xml')?.asText() || ''
    contract.protectedAssets = assetManifest(zip)
    contract.choiceGroups = extractTemplateChoiceGroups(documentXml)
    for (const paragraph of documentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []) {
      const plain = xmlText(paragraph)
      const fields = [...plain.matchAll(/\{\{([^{}]{1,80})\}\}/g)].map(match => match[1].trim()).filter(Boolean)
      if (!fields.length) continue
      const runs = paragraph.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) || []
      const placeholderRun = runs.find(run => xmlText(run).includes('{{')) || runs[0] || ''
      const format = extractParagraphFormat(paragraph, placeholderRun)
      for (const field of fields) {
        contract.fields[field] = {
          mode: 'inherit',
          source: 'template',
          location: paragraph.includes('<w:tc>') ? 'table-cell' : 'paragraph',
          format,
          collapseBlankLines: true,
        }
      }
    }
    if (!Object.keys(contract.fields).length) contract.warnings.push('未识别到连续占位符，需检查占位符是否被拆分到多个文本节点')
  }

  if (write) {
    const target = getTemplateLayoutContractPath(templatePath)
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(contract, null, 2), 'utf8')
    fs.renameSync(temporary, target)
  }
  return contract
}

export async function loadOrCreateTemplateLayoutContract(templatePath, options = {}) {
  const contractPath = getTemplateLayoutContractPath(templatePath)
  const currentHash = sha256(fs.readFileSync(templatePath))
  if (fs.existsSync(contractPath)) {
    try {
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
      if (contract.schemaVersion === LAYOUT_CONTRACT_SCHEMA_VERSION && contract.templateHash === currentHash) {
        return { contract, contractPath, status: 'ready' }
      }
    } catch {}
  }
  const contract = await extractTemplateLayoutContract(templatePath, options)
  return { contract, contractPath, status: fs.existsSync(contractPath) ? 'regenerated' : 'in_memory' }
}

export async function validateRenderedTemplateAssets(renderedBuffer, contract) {
  if (!contract || contract.mode !== 'docx') return { valid: true, missing: [], changed: [] }
  const { default: PizZip } = await import('pizzip')
  const zip = new PizZip(renderedBuffer)
  const current = assetManifest(zip)
  const expected = contract.protectedAssets || {}
  const missing = Object.keys(expected).filter(name => !current[name])
  const changed = Object.keys(expected).filter(name => current[name] && current[name] !== expected[name])
  return { valid: missing.length === 0 && changed.length === 0, missing, changed }
}

const ALLOWED_ALIGNMENTS = new Set(['inherit', 'left', 'center', 'right', 'both', 'justify'])
const ALLOWED_FIELD_MODES = new Set(['inherit', 'contract', 'manual'])

function finiteInRange(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}

function normalizeOverride(value = {}) {
  const override = {}
  const font = String(value.font || '').trim().slice(0, 80)
  if (font) override.font = font
  const fontSize = finiteInRange(value.fontSize, 5, 72)
  if (fontSize != null) override.fontSize = fontSize
  if (typeof value.bold === 'boolean') override.bold = value.bold
  const alignment = String(value.alignment || 'inherit')
  if (ALLOWED_ALIGNMENTS.has(alignment) && alignment !== 'inherit') override.alignment = alignment === 'justify' ? 'both' : alignment
  for (const key of ['lineSpacing', 'spaceBefore', 'spaceAfter', 'firstLineIndent', 'leftIndent']) {
    const number = finiteInRange(value[key], 0, key === 'lineSpacing' ? 120 : 240)
    if (number != null) override[key] = number
  }
  const lineRule = String(value.lineRule || '')
  if (['auto', 'exact', 'atLeast'].includes(lineRule)) override.lineRule = lineRule
  return override
}

export async function saveTemplateLayoutContract(templatePath, changes = {}) {
  const loaded = await loadOrCreateTemplateLayoutContract(templatePath, { docType: changes.docType || '', write: true })
  const contract = loaded.contract
  const incoming = changes.fields && typeof changes.fields === 'object' ? changes.fields : {}
  for (const [field, update] of Object.entries(incoming)) {
    if (!contract.fields[field] || !update || typeof update !== 'object') continue
    const mode = ALLOWED_FIELD_MODES.has(update.mode) ? update.mode : 'inherit'
    contract.fields[field].mode = mode
    contract.fields[field].collapseBlankLines = update.collapseBlankLines !== false
    contract.fields[field].override = mode === 'contract' ? normalizeOverride(update.override) : {}
  }
  contract.updatedAt = new Date().toISOString()
  const target = getTemplateLayoutContractPath(templatePath)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(contract, null, 2), 'utf8')
  fs.renameSync(temporary, target)
  return contract
}

export async function resetTemplateLayoutContract(templatePath, { docType = '' } = {}) {
  return extractTemplateLayoutContract(templatePath, { docType, write: true })
}

function upsertEmptyTag(xml, tagName, attrs) {
  const tag = `<w:${tagName} ${Object.entries(attrs).map(([key, value]) => `w:${key}="${value}"`).join(' ')}/>`
  const pattern = new RegExp(`<w:${tagName}\\b[^>]*/>`)
  if (pattern.test(xml)) return xml.replace(pattern, tag)
  return `${xml}${tag}`
}

function applyRunOverride(runXml, override) {
  let rPr = runXml.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/)?.[0] || '<w:rPr></w:rPr>'
  let inner = rPr.replace(/^<w:rPr\b[^>]*>|<\/w:rPr>$/g, '')
  if (override.font) inner = upsertEmptyTag(inner, 'rFonts', { ascii: override.font, hAnsi: override.font, eastAsia: override.font })
  if (override.fontSize != null) {
    const half = Math.round(override.fontSize * 2)
    inner = upsertEmptyTag(inner, 'sz', { val: half })
    inner = upsertEmptyTag(inner, 'szCs', { val: half })
  }
  if (typeof override.bold === 'boolean') {
    inner = inner.replace(/<w:b(?:\b[^>]*)?\/>/g, '').replace(/<w:bCs(?:\b[^>]*)?\/>/g, '')
    if (override.bold) inner += '<w:b/><w:bCs/>'
  }
  const next = `<w:rPr>${inner}</w:rPr>`
  return /<w:rPr\b/.test(runXml)
    ? runXml.replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/, next)
    : runXml.replace(/(<w:r\b[^>]*>)/, `$1${next}`)
}

function applyParagraphOverride(paragraphXml, override) {
  if (!Object.keys(override).some(key => ['alignment', 'lineSpacing', 'lineRule', 'spaceBefore', 'spaceAfter', 'firstLineIndent', 'leftIndent'].includes(key))) return paragraphXml
  let pPr = paragraphXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] || '<w:pPr></w:pPr>'
  let inner = pPr.replace(/^<w:pPr\b[^>]*>|<\/w:pPr>$/g, '')
  if (override.alignment) inner = upsertEmptyTag(inner, 'jc', { val: override.alignment })
  const spacing = {}
  if (override.lineSpacing != null) spacing.line = Math.round(override.lineSpacing * 20)
  if (override.lineRule) spacing.lineRule = override.lineRule
  if (override.spaceBefore != null) spacing.before = Math.round(override.spaceBefore * 20)
  if (override.spaceAfter != null) spacing.after = Math.round(override.spaceAfter * 20)
  if (Object.keys(spacing).length) inner = upsertEmptyTag(inner, 'spacing', spacing)
  const indent = {}
  if (override.firstLineIndent != null) indent.firstLine = Math.round(override.firstLineIndent * 20)
  if (override.leftIndent != null) indent.left = Math.round(override.leftIndent * 20)
  if (Object.keys(indent).length) inner = upsertEmptyTag(inner, 'ind', indent)
  const next = `<w:pPr>${inner}</w:pPr>`
  return /<w:pPr\b/.test(paragraphXml)
    ? paragraphXml.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, next)
    : paragraphXml.replace(/(<w:p\b[^>]*>)/, `$1${next}`)
}

export function applyTemplateLayoutContract(documentXml, contract) {
  if (!contract?.fields) return documentXml
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    const plain = xmlText(paragraph)
    const matchedField = Object.keys(contract.fields).find(field => plain.includes(`{{${field}}}`) && contract.fields[field]?.mode === 'contract')
    if (!matchedField) return paragraph
    const override = normalizeOverride(contract.fields[matchedField].override)
    let next = applyParagraphOverride(paragraph, override)
    let applied = false
    next = next.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => {
      const text = xmlText(run)
      if (!text.includes(`{{${matchedField}}}`)) return run
      applied = true
      return applyRunOverride(run, override)
    })
    // 常见 Word 编辑会把 {{字段}} 拆成多个 run；这种情况下只修改包含定界符的
    // run，避免把同段标签文字一起改掉。
    if (!applied) {
      next = next.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => /\{\{|\}\}/.test(xmlText(run)) ? applyRunOverride(run, override) : run)
    }
    return next
  })
}

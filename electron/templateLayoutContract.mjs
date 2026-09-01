import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LAYOUT_CONTRACT_SCHEMA_VERSION = 2

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function getTemplateLayoutContractPath(templatePath) {
  const extension = path.extname(templatePath)
  return `${templatePath.slice(0, -extension.length)}.layout.json`
}

function hasCurrentPlacementShape(contract = {}) {
  if (contract.mode !== 'docx') return true
  const placements = Object.values(contract.fields || {}).flatMap(field => field?.placements || [])
  return placements.length > 0 && placements.every(placement =>
    placement?.exact === true
    && Number.isInteger(placement.textOffset)
    && placement.textOffset >= 0
    && Number.isInteger(placement.occurrenceIndex)
    && placement.occurrenceIndex >= 0)
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
      activationPolicy: 'record-required',
      uncheckedWhen: ['blank', 'pending', 'not-applicable'],
      source: 'template',
    })
  }
  return groups
}

function placeholderOccurrences(xml = '') {
  const plain = xmlText(xml)
  return [...plain.matchAll(/\{\{([^{}]{1,80})\}\}/g)]
    .map((match, occurrenceIndex) => ({ field: match[1].trim(), textOffset: match.index || 0, occurrenceIndex }))
    .filter(item => item.field)
}

function placementLabel(plain = '', fields = []) {
  let label = String(plain || '')
  for (const field of fields) label = label.replaceAll(`{{${field}}}`, '')
  return label.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function pushFieldPlacement(fields, field, placement, format) {
  const current = fields[field] || {
    mode: 'inherit',
    source: 'template',
    location: placement.kind,
    format,
    collapseBlankLines: true,
    placements: [],
    mappingConfidence: 1,
  }
  current.placements.push(placement)
  if (current.location !== placement.kind) current.location = 'multiple'
  fields[field] = current
}

/**
 * 从 OOXML 本身建立字段坐标。模型只解释字段含义，写入位置始终以这里的坐标为准。
 * paragraphIndex 在表格内表示当前单元格内的段落序号，在表格外表示正文段落序号。
 */
export function extractDocxFieldMap(documentXml = '') {
  const fields = {}
  const tableRanges = []
  const tables = [...String(documentXml).matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)]
  for (const [tableIndex, tableMatch] of tables.entries()) {
    const tableXml = tableMatch[0]
    tableRanges.push([tableMatch.index, (tableMatch.index || 0) + tableXml.length])
    const rows = [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    for (const [rowIndex, rowMatch] of rows.entries()) {
      const cells = [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
      for (const [cellIndex, cellMatch] of cells.entries()) {
        const paragraphs = [...cellMatch[0].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
        for (const [paragraphIndex, paragraphMatch] of paragraphs.entries()) {
          const occurrences = placeholderOccurrences(paragraphMatch[0])
          const names = occurrences.map(item => item.field)
          if (!occurrences.length) continue
          const runs = paragraphMatch[0].match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) || []
          const placeholderRun = runs.find(run => xmlText(run).includes('{{')) || runs[0] || ''
          const format = extractParagraphFormat(paragraphMatch[0], placeholderRun)
          const label = placementLabel(xmlText(paragraphMatch[0]), names)
          for (const occurrence of occurrences) pushFieldPlacement(fields, occurrence.field, {
            kind: 'table-cell', tableIndex, rowIndex, cellIndex, paragraphIndex,
            textOffset: occurrence.textOffset, occurrenceIndex: occurrence.occurrenceIndex,
            anchorText: label, exact: true,
          }, format)
        }
      }
    }
  }

  let bodyParagraphIndex = 0
  for (const paragraphMatch of String(documentXml).matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const start = paragraphMatch.index || 0
    if (tableRanges.some(([from, to]) => start >= from && start < to)) continue
    const paragraph = paragraphMatch[0]
    const occurrences = placeholderOccurrences(paragraph)
    const names = occurrences.map(item => item.field)
    if (occurrences.length) {
      const runs = paragraph.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) || []
      const placeholderRun = runs.find(run => xmlText(run).includes('{{')) || runs[0] || ''
      const format = extractParagraphFormat(paragraph, placeholderRun)
      const label = placementLabel(xmlText(paragraph), names)
      for (const occurrence of occurrences) pushFieldPlacement(fields, occurrence.field, {
        kind: 'paragraph', paragraphIndex: bodyParagraphIndex,
        textOffset: occurrence.textOffset, occurrenceIndex: occurrence.occurrenceIndex,
        anchorText: label, exact: true,
      }, format)
    }
    bodyParagraphIndex += 1
  }
  return fields
}

export function assessTemplateFieldMap(contract = {}) {
  const entries = Object.entries(contract.fields || {})
  const placementCount = entries.reduce((sum, [, field]) => sum + (field.placements?.length || 0), 0)
  const exactPlacementCount = entries.reduce((sum, [, field]) => sum + (field.placements || []).filter(item => item.exact === true).length, 0)
  const unmappedFields = entries.filter(([, field]) => !field.placements?.length).map(([name]) => name)
  const warnings = unmappedFields.map(field => `${field}：未建立确定性写入坐标`)
  return {
    fieldCount: entries.length,
    placementCount,
    exactPlacementCount,
    unmappedFields,
    mappingStatus: entries.length > 0 && unmappedFields.length === 0 ? 'ready' : entries.length ? 'needs-review' : 'empty',
    warnings,
  }
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
    contract.fields = extractDocxFieldMap(documentXml)
    if (!Object.keys(contract.fields).length) contract.warnings.push('未识别到占位符，需先完成模板字段分析')
  }

  if (extension === '.xlsx') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(templateBuffer, { type: 'buffer', cellFormula: true })
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      for (const [cell, cellData] of Object.entries(worksheet || {})) {
        if (cell.startsWith('!')) continue
        const names = [...String(cellData?.v ?? '').matchAll(/\{\{([^{}]{1,80})\}\}/g)].map(match => match[1].trim()).filter(Boolean)
        for (const field of names) pushFieldPlacement(contract.fields, field, {
          kind: 'worksheet-cell', sheet: sheetName, cell, anchorText: '', exact: true,
        }, { numberFormat: cellData?.z || 'inherit', styleId: cellData?.s })
      }
    }
    const configPath = path.join(path.dirname(templatePath), 'config.json')
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const names = Object.keys(config.placeholders || {}).map(value => value.replace(/^\{\{|\}\}$/g, '').trim())
        for (const [index, field] of names.entries()) {
          if (contract.fields[field]?.placements?.length || !config.placeholder_cells?.[index]) continue
          pushFieldPlacement(contract.fields, field, {
            kind: 'worksheet-cell', sheet: workbook.SheetNames[0] || 'Sheet1', cell: config.placeholder_cells[index], anchorText: '', exact: true,
          }, {})
        }
      } catch {
        contract.warnings.push('XLSX 映射配置读取失败')
      }
    }
  }

  const assessment = assessTemplateFieldMap(contract)
  contract.mapping = assessment
  contract.warnings.push(...assessment.warnings)

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
  let previous = null
  if (fs.existsSync(contractPath)) {
    try {
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
      previous = contract
      if (contract.schemaVersion === LAYOUT_CONTRACT_SCHEMA_VERSION
        && contract.templateHash === currentHash
        && hasCurrentPlacementShape(contract)) {
        return { contract, contractPath, status: 'ready' }
      }
    } catch {}
  }
  const contract = await extractTemplateLayoutContract(templatePath, options)
  // 模板内容或 schema 升级后重新提取坐标，但保留仍存在字段的人工版式和语义策略。
  for (const [field, oldValue] of Object.entries(previous?.fields || {})) {
    if (!contract.fields[field]) continue
    contract.fields[field].mode = ALLOWED_FIELD_MODES.has(oldValue.mode) ? oldValue.mode : contract.fields[field].mode
    contract.fields[field].collapseBlankLines = oldValue.collapseBlankLines !== false
    contract.fields[field].override = oldValue.override || {}
    if (oldValue.semanticPolicy) contract.fields[field].semanticPolicy = oldValue.semanticPolicy
  }
  if (previous) {
    const target = getTemplateLayoutContractPath(templatePath)
    fs.writeFileSync(target, JSON.stringify(contract, null, 2), 'utf8')
  }
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

function normalizeSemanticPolicy(value = {}) {
  if (!value || typeof value !== 'object') return undefined
  const text = input => String(input || '').trim().slice(0, 2000)
  const list = input => Array.isArray(input) ? input.map(text).filter(Boolean).slice(0, 20) : []
  return {
    semanticType: text(value.semanticType),
    fillMode: text(value.fillMode),
    expansionLevel: text(value.expansionLevel),
    source: text(value.source),
    requirement: text(value.requirement),
    missingInfoPolicy: text(value.missingInfoPolicy),
    sourcePriority: list(value.sourcePriority),
    dependencies: list(value.dependencies),
    forbiddenAssertions: list(value.forbiddenAssertions),
    requiredForGeneration: value.requiredForGeneration === true,
    requiredForDelivery: value.requiredForDelivery === true,
    antiFabrication: value.antiFabrication !== false,
  }
}

export async function saveTemplateLayoutContract(templatePath, changes = {}) {
  const loaded = await loadOrCreateTemplateLayoutContract(templatePath, { docType: changes.docType || '', write: true })
  const contract = loaded.contract
  const incoming = changes.fields && typeof changes.fields === 'object' ? changes.fields : {}
  for (const [field, update] of Object.entries(incoming)) {
    if (!contract.fields[field] || !update || typeof update !== 'object') continue
    const mode = ALLOWED_FIELD_MODES.has(update.mode) ? update.mode : contract.fields[field].mode || 'inherit'
    contract.fields[field].mode = mode
    if (typeof update.collapseBlankLines === 'boolean') contract.fields[field].collapseBlankLines = update.collapseBlankLines
    if (update.override) contract.fields[field].override = mode === 'contract' ? normalizeOverride(update.override) : {}
    const semanticPolicy = normalizeSemanticPolicy(update.semanticPolicy)
    if (semanticPolicy) contract.fields[field].semanticPolicy = semanticPolicy
  }
  contract.mapping = assessTemplateFieldMap(contract)
  contract.warnings = [
    ...(contract.warnings || []).filter(item => !/未建立确定性写入坐标/.test(item)),
    ...contract.mapping.warnings,
  ]
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

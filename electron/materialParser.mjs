import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const date = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const match = String(value || '').trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : ''
}
function column(headers, patterns) {
  for (let index = 0; index < headers.length; index += 1) {
    const normalized = String(headers[index] || '').replace(/\s/g, '')
    if (patterns.some(pattern => pattern.test(normalized))) return index
  }
  return -1
}
const cell = (row, index) => index >= 0 && row[index] != null ? row[index] : ''

function progressCandidates(workbook, XLSX, fileName) {
  const output = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    const headerAt = rows.findIndex(row => row.some(value => /任务|工作内容|节点|计划|进度|完成/.test(String(value))))
    if (headerAt < 0) continue
    const headers = rows[headerAt].map(String)
    const name = column(headers, [/任务名称/, /工作内容/, /节点名称/, /工程名称/, /分项工程/, /^名称$/])
    const planStart = column(headers, [/计划.*开始/, /计划开工/, /计划起始/]); const planEnd = column(headers, [/计划.*结束/, /计划完工/, /计划完成/, /计划截止/])
    const actualStart = column(headers, [/实际.*开始/, /实际开工/, /实际起始/]); const actualEnd = column(headers, [/实际.*结束/, /实际完工/, /实际完成/])
    const percent = column(headers, [/完成.*率/, /进度.*%/, /^进度$/, /^完成率$/]); const weight = column(headers, [/权重/, /权重%/])
    if (name < 0 || (planStart < 0 && planEnd < 0 && percent < 0)) continue
    rows.slice(headerAt + 1).forEach((row, offset) => {
      const task = String(cell(row, name)).trim(); if (!task || /^合计|^总计|^备注/.test(task)) return
      const raw = Number(String(cell(row, percent)).replace('%', '').trim())
      output.push({ name: task, plan_start: date(cell(row, planStart)), plan_end: date(cell(row, planEnd)), actual_start: date(cell(row, actualStart)), actual_end: date(cell(row, actualEnd)), progress_percent: Number.isFinite(raw) ? Math.min(100, Math.max(0, raw > 0 && raw <= 1 ? raw * 100 : raw)) : 0, weight: Number(cell(row, weight)) || 1, source: `${fileName}｜${sheetName}!${headerAt + offset + 2}`, sourceSheet: sheetName, sourceRow: headerAt + offset + 2 })
    })
  }
  return output
}

export async function parseMaterial(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在')
  const ext = path.extname(filePath).toLowerCase(); const fileName = path.basename(filePath)
  if (ext === '.xlsx' || ext === '.xls') {
    const module = await import('xlsx'); const XLSX = module.default || module; const workbook = XLSX.readFile(filePath, { cellDates: true })
    const text = workbook.SheetNames.map(name => `【工作表：${name}】\n${XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }).map(row => row.join('\t')).join('\n')}`).join('\n\n')
    return { success: true, fileName, ext, type: 'excel', text: text.slice(0, 50000), truncated: text.length > 50000, progressCandidates: progressCandidates(workbook, XLSX, fileName) }
  }
  if (ext === '.docx') { const { extractRawText } = await import('mammoth'); const result = await extractRawText({ buffer: fs.readFileSync(filePath) }); return { success: true, fileName, ext, type: 'word', text: (result.value || '').slice(0, 50000), truncated: (result.value || '').length > 50000, progressCandidates: [] } }
  if (ext === '.pdf') { try { const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-']); const text = String(stdout || ''); return { success: true, fileName, ext, type: 'pdf', text: text.slice(0, 50000), truncated: text.length > 50000, progressCandidates: [], note: text.trim() ? undefined : '该 PDF 未发现可提取文字，属于扫描件时需 OCR。' } } catch { return { success: false, fileName, ext, error: 'PDF 文字提取失败；扫描件需 OCR 后再导入。' } } }
  throw new Error(`暂不支持解析 ${ext || '该类型'} 文件`)
}

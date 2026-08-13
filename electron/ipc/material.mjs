/**
 * 项目资料解析与进度导入。
 * 本模块只做本地提取和确定性字段识别；AI 只能使用用户确认后入账的数据。
 */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'
import { parseMaterial as parseLocalMaterial } from '../materialParser.mjs'

const execFileAsync = promisify(execFile)
const DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/

function normalizeDate(value) {
  if (!value) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value).trim()
  const match = text.match(DATE_RE)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function findColumn(headers, patterns) {
  return headers.findIndex(value => patterns.some(pattern => pattern.test(String(value || '').replace(/\s/g, ''))))
}

function readCell(row, index) {
  return index >= 0 && row[index] != null ? row[index] : ''
}

function detectExcelProgress(workbook, XLSX) {
  const candidates = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    const headerRowIndex = rows.findIndex(row => Array.isArray(row) && row.some(cell => /任务|工作内容|节点|分项|计划|进度|完成/.test(String(cell))))
    if (headerRowIndex < 0) continue
    const headers = rows[headerRowIndex].map(cell => String(cell).trim())
    const nameIndex = findColumn(headers, [/任务名称/, /工作内容/, /节点名称/, /工程名称/, /分项工程/, /^名称$/])
    const planStartIndex = findColumn(headers, [/计划.*开始/, /计划开工/, /计划起始/])
    const planEndIndex = findColumn(headers, [/计划.*结束/, /计划完工/, /计划完成/, /计划截止/])
    const actualStartIndex = findColumn(headers, [/实际.*开始/, /实际开工/, /实际起始/])
    const actualEndIndex = findColumn(headers, [/实际.*结束/, /实际完工/, /实际完成/])
    const progressIndex = findColumn(headers, [/完成.*率/, /进度.*%/, /^进度$/, /^完成率$/])
    const weightIndex = findColumn(headers, [/权重/, /权重%/])
    if (nameIndex < 0 || (planStartIndex < 0 && planEndIndex < 0 && progressIndex < 0)) continue
    rows.slice(headerRowIndex + 1).forEach((row, offset) => {
      if (!Array.isArray(row)) return
      const name = String(readCell(row, nameIndex)).trim()
      if (!name || /^合计|^总计|^备注/.test(name)) return
      const rawPercent = readCell(row, progressIndex)
      const numeric = Number(String(rawPercent).replace('%', '').trim())
      candidates.push({
        name,
        plan_start: normalizeDate(readCell(row, planStartIndex)),
        plan_end: normalizeDate(readCell(row, planEndIndex)),
        actual_start: normalizeDate(readCell(row, actualStartIndex)),
        actual_end: normalizeDate(readCell(row, actualEndIndex)),
        progress_percent: Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric <= 1 && numeric > 0 ? numeric * 100 : numeric)) : 0,
        weight: Number(readCell(row, weightIndex)) || 1,
        source: `${path.basename(sheetName)}!${headerRowIndex + offset + 2}`,
      })
    })
  }
  return candidates
}

// 保留旧实现仅用于兼容历史调试；正式 IPC 与测试统一使用 materialParser.mjs。
async function legacyParseMaterial(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在')
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  if (ext === '.xlsx' || ext === '.xls') {
    const xlsxModule = await import('xlsx')
    const XLSX = xlsxModule.default || xlsxModule
    const workbook = XLSX.readFile(filePath, { cellDates: true })
    const text = workbook.SheetNames.map(sheetName => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
      return `【工作表：${sheetName}】\n${rows.map(row => row.join('\t')).join('\n')}`
    }).join('\n\n')
    return { success: true, fileName, ext, type: 'excel', text: text.slice(0, 50000), truncated: text.length > 50000, progressCandidates: detectExcelProgress(workbook, XLSX) }
  }
  if (ext === '.docx') {
    const { extractRawText } = await import('mammoth')
    const result = await extractRawText({ buffer: fs.readFileSync(filePath) })
    return { success: true, fileName, ext, type: 'word', text: (result.value || '').slice(0, 50000), truncated: (result.value || '').length > 50000, progressCandidates: [] }
  }
  if (ext === '.pdf') {
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'])
      const text = String(stdout || '')
      return { success: true, fileName, ext, type: 'pdf', text: text.slice(0, 50000), truncated: text.length > 50000, progressCandidates: [], note: text.trim() ? undefined : '该 PDF 未发现可提取文字，属于扫描件时需 OCR。' }
    } catch {
      return { success: false, fileName, ext, error: 'PDF 文字提取失败；扫描件需 OCR 后再导入。' }
    }
  }
  throw new Error(`暂不支持解析 ${ext || '该类型'} 文件`)
}

export { parseLocalMaterial as parseMaterial }

export function register(ipcMain) {
  ipcMain.handle('material:parse', safeCall(async (_, { filePath }) => parseLocalMaterial(filePath)))
  ipcMain.handle('material:importProgress', safeCall(async (_, { projectPath, nodes, sourceFile }) => {
    if (!projectPath) throw new Error('未选择项目')
    const projectName = path.basename(projectPath)
    const validNodes = Array.isArray(nodes) ? nodes.filter(node => String(node?.name || '').trim()) : []
    if (!validNodes.length) throw new Error('没有可导入的进度节点')
    const ids = validNodes.map(node => repo.insertProgressNode({ project_name: projectName, ...node }))
    repo.logAudit(projectName, 'progress.import', 'progress_node', ids[0], { count: ids.length, sourceFile: sourceFile || '' })
    return { success: true, count: ids.length, ids }
  }))
}

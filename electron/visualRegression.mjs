import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
function findSoffice() {
  const candidates = [process.env.SOFFICE_PATH, '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/Users/micfree/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice'].filter(Boolean)
  return candidates.find(candidate => fs.existsSync(candidate)) || 'soffice'
}
function parsePgm(buffer) {
  const marker = Buffer.from('\n255\n'); const headerEnd = buffer.indexOf(marker)
  if (headerEnd < 0) throw new Error('无法解析渲染图像')
  const header = buffer.subarray(0, headerEnd).toString('ascii').replace(/#[^\n]*/g, '').trim().split(/\s+/)
  const width = Number(header[1]); const height = Number(header[2]); const pixels = buffer.subarray(headerEnd + marker.length)
  let ink = 0; for (const value of pixels) if (value < 245) ink++
  return { width, height, inkRatio: Number((ink / Math.max(1, pixels.length)).toFixed(4)) }
}
export async function renderDocxVisualAudit(docxPath) {
  if (!fs.existsSync(docxPath) || path.extname(docxPath).toLowerCase() !== '.docx') throw new Error('待验收文件不是 DOCX')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-visual-'))
  try {
    await execFileAsync(findSoffice(), ['--headless', '--convert-to', 'pdf', '--outdir', temporary, docxPath], { timeout: 60000 })
    const pdfPath = path.join(temporary, `${path.basename(docxPath, '.docx')}.pdf`)
    if (!fs.existsSync(pdfPath)) throw new Error('LibreOffice 未生成 PDF')
    const imageBase = path.join(temporary, 'page')
    await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '256', '-gray', pdfPath, imageBase], { timeout: 30000 })
    const pgmPath = `${imageBase}.pgm`; const metrics = parsePgm(fs.readFileSync(pgmPath))
    const issues = []
    if (metrics.width <= 0 || metrics.height <= 0) issues.push('页面尺寸无效')
    if (metrics.inkRatio < 0.005) issues.push('首页近乎空白')
    if (metrics.inkRatio > 0.85) issues.push('首页内容覆盖异常，疑似版式溢出')
    return { valid: issues.length === 0, issues, page: 1, ...metrics, renderer: 'LibreOffice+Poppler', checkedAt: new Date().toISOString() }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}

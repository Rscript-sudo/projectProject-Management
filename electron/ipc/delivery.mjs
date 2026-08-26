import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { safeCall } from './safe.mjs'
import { getDb } from '../db/database.mjs'
import { scanProjectCompleteness } from './completeness.mjs'

function writeGenerated(projectPath, title, lines) {
  const outputDir = path.join(projectPath, '项目数据', '批量生成')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${title}_${Date.now()}.md`)
  fs.writeFileSync(outputPath, [`# ${title}`, '', ...lines].join('\n'), 'utf8')
  return outputPath
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function listFiles(root, current = root) {
  if (!fs.existsSync(current)) return []
  return fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === '交付包') return []
    const full = path.join(current, entry.name)
    return entry.isDirectory() ? listFiles(root, full) : [{ full, relative: path.relative(root, full) }]
  })
}

export function register(ipcMain) {
  ipcMain.handle('delivery:batchGenerate', safeCall((_, { projectPath, mode, dates = [], period = {} }) => {
    const projectName = path.basename(projectPath)
    const db = getDb()
    if (mode === 'daily') {
      const paths = dates.map(date => writeGenerated(projectPath, `监理日志_${date}`, [`- 日期：${date}`, '- 状态：待根据当日已确认证据补充', '- 不自动生成未发生的巡视事实。']))
      return { success: true, paths, count: paths.length }
    }
    const start = period.start || '0000-01-01'; const end = period.end || '9999-12-31'
    if (mode === 'weekly') {
      const logs = db.prepare("SELECT * FROM ledger_simple WHERE project_name = ? AND doc_type = '监理日志' AND created_at BETWEEN ? AND ? ORDER BY created_at").all(projectName, start, `${end}T23:59:59`)
      return { success: true, paths: [writeGenerated(projectPath, `监理周报_${start}_${end}`, [`- 报告期：${start} 至 ${end}`, `- 来源日志：${logs.length} 份`, ...logs.map(item => `- [来源:D${item.id}] ${item.file_name}`)])], count: 1, sourceCount: logs.length }
    }
    if (mode === 'monthly') {
      const reports = db.prepare("SELECT * FROM ledger_simple WHERE project_name = ? AND doc_type IN ('监理日志','监理周报') AND created_at BETWEEN ? AND ? ORDER BY created_at").all(projectName, start, `${end}T23:59:59`)
      const nodes = db.prepare('SELECT * FROM progress_node WHERE project_name = ?').all(projectName)
      const hazards = db.prepare('SELECT * FROM hazard WHERE project_name = ?').all(projectName)
      const payments = db.prepare('SELECT * FROM payment_request WHERE project_name = ? AND period BETWEEN ? AND ?').all(projectName, start.slice(0, 7), end.slice(0, 7))
      const lines = [`- 报告期：${start} 至 ${end}`, `- 来源日/周报：${reports.length} 份`, `- 进度节点：${nodes.length} 个`, `- 隐患：${hazards.length} 条`, `- 付款记录：${payments.length} 条`, ...reports.map(item => `- [来源:D${item.id}] ${item.file_name}`)]
      return { success: true, paths: [writeGenerated(projectPath, `监理月报_${start}_${end}`, lines)], count: 1, sourceCount: reports.length }
    }
    if (mode === 'payment_certificate') {
      const payments = db.prepare("SELECT * FROM payment_request WHERE project_name = ? AND status IN ('已批准','已支付') ORDER BY created_at").all(projectName)
      const paths = payments.map(item => writeGenerated(projectPath, `支付证书_${item.id}`, [`- 付款期次：${item.period}`, `- 批准金额：${item.amount}`, `- 审批状态：${item.status}`, `- 来源：付款申请 #${item.id}`]))
      return { success: true, paths, count: paths.length }
    }
    throw new Error(`不支持的批量生成模式：${mode}`)
  }))

  ipcMain.handle('delivery:createPackage', safeCall(async (_, { projectPath, allowIncomplete = false }) => {
    const check = scanProjectCompleteness(projectPath)
    if (!allowIncomplete && check.issues.some(item => item.severity === 'error')) return { success: false, blocked: true, issues: check.issues, error: '存在错误级完整性问题，不能生成正式交付包' }
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const packageDir = path.join(projectPath, '交付包', `${path.basename(projectPath)}_${stamp}`)
    const docsDir = path.join(packageDir, '项目文件')
    fs.mkdirSync(docsDir, { recursive: true })
    const sourceFiles = listFiles(projectPath).filter(item => !item.relative.startsWith(`项目数据${path.sep}导入源文件`))
    for (const file of sourceFiles) {
      const target = path.join(docsDir, file.relative)
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file.full, target)
    }
    const dbPath = getDb().name
    if (dbPath && fs.existsSync(dbPath)) await getDb().backup(path.join(packageDir, '数据库快照.db'))
    const packagedFiles = listFiles(packageDir)
    const manifest = packagedFiles.map(file => ({ path: file.relative, size: fs.statSync(file.full).size, sha256: sha256(file.full) }))
    fs.writeFileSync(path.join(packageDir, '文件清单_SHA256.json'), JSON.stringify(manifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(packageDir, '缺件清单.json'), JSON.stringify(check.issues, null, 2), 'utf8')
    fs.writeFileSync(path.join(packageDir, '移交说明.md'), `# 项目移交说明\n\n- 项目：${check.projectName}\n- 生成时间：${new Date().toISOString()}\n- 文件数：${manifest.length}\n- 完整性问题：${check.issues.length}\n- 校验方式：SHA-256\n`, 'utf8')
    return { success: true, packageDir, fileCount: manifest.length, issueCount: check.issues.length }
  }))
}

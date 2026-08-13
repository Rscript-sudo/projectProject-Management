import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-reporting-integrity-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)
  const created = await call('fs:createProject', path.join(runtimeDir, 'projects'), '报告期完整性项目', '土建工程')
  const projectPath = created.path
  const sourceFile = path.join(runtimeDir, '八月施工进度.xlsx')
  fs.writeFileSync(sourceFile, 'fixture-progress-source')
  const nodes = [
    { name: '八月节点', plan_start: '2026-08-02', plan_end: '2026-08-20', actual_start: '2026-08-03', progress_percent: 60, sourceSheet: '进度表', sourceRow: 2 },
    { name: '九月节点', plan_start: '2026-09-01', plan_end: '2026-09-25', progress_percent: 0, sourceSheet: '进度表', sourceRow: 3 },
  ]
  const first = await call('material:importProgress', { projectPath, nodes, sourceFile })
  assert.equal(first.success, true)
  assert.equal(first.count, 2)
  const repeated = await call('material:importProgress', { projectPath, nodes, sourceFile })
  assert.equal(repeated.success, false)
  assert.equal(repeated.duplicate, true)
  const listResult = await call('progress:list', projectPath)
  const list = Array.isArray(listResult) ? listResult : listResult.data
  assert.equal(list.length, 2, '重复导入不得制造重复节点')
  assert.equal(list[0].source_file, sourceFile)
  assert.equal(list[0].source_sheet, '进度表')
  assert.equal(list[0].source_row, 2)
  const august = await call('data:query', { projectName: '报告期完整性项目', toolIds: ['progress_summary'], reportPeriod: { start: '2026-08-01', end: '2026-08-31' } })
  assert.equal(august.progress_summary.总节点数, 1)
  assert.equal(august.progress_summary.节点详情[0].名称, '八月节点')
  assert.match(august.progress_summary.数据口径, /报告期内/)

  const draft = await call('fs:saveDoc', {
    projectPath, projectName: '报告期完整性项目', docType: '监理日志', preview: true,
    userInput: '预览件', customSummary: '预览件',
    content: '【施工部位】1号楼\n【参与人员】总监\n【今日内容】现场复核。\n【核心工作落实】核验资料。\n【协调解决情况】无。\n【其他事项】继续复核。',
  })
  assert.equal(draft.success, true)
  assert.equal(draft.preview, true)
  assert.equal(fs.existsSync(draft.path), true)
  assert.equal(draft.path.startsWith(path.join(os.tmpdir(), '项目文档管理系统预览')), true)
  const beforePreviewNumber = await call('numbering:preview', '监理日志', '报告期完整性项目')
  const secondDraft = await call('fs:saveDoc', {
    projectPath, projectName: '报告期完整性项目', docType: '监理日志', preview: true,
    userInput: '第二次预览件', customSummary: '第二次预览件',
    content: '【施工部位】1号楼\n【参与人员】总监\n【今日内容】现场复核。\n【核心工作落实】核验资料。\n【协调解决情况】无。\n【其他事项】继续复核。',
  })
  assert.equal(secondDraft.success, true)
  const afterPreviewNumber = await call('numbering:preview', '监理日志', '报告期完整性项目')
  assert.equal(afterPreviewNumber.number, beforePreviewNumber.number, '预览不得占用正式文号')
  const rejected = await call('fs:saveDoc', {
    projectPath, projectName: '报告期完整性项目', docType: '监理日志',
    userInput: '待核对件', customSummary: '待核对件',
    content: '【施工部位】数据待核对\n【参与人员】总监\n【今日内容】现场复核。\n【核心工作落实】核验资料。\n【协调解决情况】无。\n【其他事项】继续复核。',
  })
  assert.equal(rejected.success, false)
  assert.match(rejected.error, /数据待核对/)
  const afterRejectedNumber = await call('numbering:preview', '监理日志', '报告期完整性项目')
  assert.equal(afterRejectedNumber.number, beforePreviewNumber.number, '拒绝保存不得占用正式文号')
  const ledgers = await call('fs:getProjectLedgers', projectPath)
  assert.equal(ledgers.log.items.length, 0, '预览和被拒绝的文档不得进入正式台账')
  const afterPreview = await call('progress:list', projectPath)
  assert.equal((Array.isArray(afterPreview) ? afterPreview : afterPreview.data).length, 2)
  closeDb()
  console.log('REPORTING INTEGRITY E2E PASS: 报告期过滤 / 导入来源 / 防重复 / 文号与台账隔离')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-import-delivery-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map(); const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs'); const { closeDb, getDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)
  const projectName = '导入交付验收项目'
  const created = await call('fs:createProject', path.join(runtimeDir, 'projects'), projectName, '土建工程')
  const records = [{ node: '基础完成', start: '2026-08-01', end: '2026-08-10' }]
  const options = { projectPath: created.path, entityType: 'progress', records, fieldMapping: { name: 'node', plan_start: 'start', plan_end: 'end' } }
  const preview = await call('material:previewUnifiedImport', options); assert.equal(preview.errors.length, 0)
  const imported = await call('material:commitUnifiedImport', options); assert.equal(imported.success, true); assert.ok(fs.existsSync(imported.reportPath))
  const duplicate = await call('material:commitUnifiedImport', options); assert.equal(duplicate.duplicate, true)
  assert.equal(getDb().prepare('SELECT COUNT(*) count FROM progress_node WHERE project_name = ?').get(projectName).count, 1)
  const undone = await call('material:undoUnifiedImport', { projectName, batchId: imported.batchId }); assert.equal(undone.removedCount, 1)
  assert.equal(getDb().prepare('SELECT COUNT(*) count FROM progress_node WHERE project_name = ?').get(projectName).count, 0)

  const daily = await call('delivery:batchGenerate', { projectPath: created.path, mode: 'daily', dates: ['2026-08-20', '2026-08-21'] })
  assert.equal(daily.count, 2); daily.paths.forEach(file => assert.ok(fs.existsSync(file)))
  const monthly = await call('delivery:batchGenerate', { projectPath: created.path, mode: 'monthly', period: { start: '2026-08-01', end: '2026-08-31' } })
  assert.equal(monthly.count, 1)
  const packaged = await call('delivery:createPackage', { projectPath: created.path, allowIncomplete: true })
  assert.equal(packaged.success, true, packaged.error); assert.ok(fs.existsSync(path.join(packaged.packageDir, '文件清单_SHA256.json'))); assert.ok(fs.existsSync(path.join(packaged.packageDir, '数据库快照.db')))
  closeDb(); console.log('IMPORT DELIVERY E2E PASS: preview / hash / undo / batch / package')
}
main().catch(error => { console.error('IMPORT DELIVERY E2E FAIL:', error.stack || error); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-dashboard-release-')); app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map(); const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }; const call = (channel, ...args) => handlers.get(channel)({}, ...args)
async function main() {
  await app.whenReady(); const { registerAll } = await import('../electron/ipc/register.mjs'); const { closeDb, getDb } = await import('../electron/db/database.mjs'); registerAll(ipcMain, null)
  const root = path.join(runtimeDir, 'projects'); await call('fs:createProject', root, '风险项目', '土建工程'); await call('fs:createProject', root, '健康项目', '市政工程')
  await call('db:insertHazard', { project_name: '风险项目', description: '逾期隐患', deadline: '2020-01-01', status: '待整改' })
  const dashboard = await call('dashboard:portfolio'); assert.equal(dashboard.projects.length, 2); assert.equal(dashboard.rankings[0].name, '风险项目'); assert.ok(dashboard.todos.some(item => item.projectName === '风险项目'))
  const preflight = await call('release:preflight'); assert.equal(preflight.databaseIntegrity, 'ok')
  const pkg = path.join(runtimeDir, 'update.pkg'); fs.writeFileSync(pkg, 'signed-release-fixture'); const hash = crypto.createHash('sha256').update(fs.readFileSync(pkg)).digest('hex')
  const rejected = await call('release:prepareUpdate', { packagePath: pkg, expectedSha256: 'bad' }); assert.equal(rejected.success, false)
  const prepared = await call('release:prepareUpdate', { packagePath: pkg, expectedSha256: hash, changelog: '# vNext\n\n验收更新。' }); assert.equal(prepared.success, true); assert.ok(fs.existsSync(path.join(prepared.recoveryDir, 'pre-update.db'))); assert.ok(fs.existsSync(prepared.changelogPath))
  assert.ok(getDb().prepare('SELECT * FROM schema_migration WHERE version = 3').get()); closeDb(); console.log('DASHBOARD RELEASE E2E PASS: portfolio / integrity / hash / backup / recovery')
}
main().catch(error => { console.error('DASHBOARD RELEASE E2E FAIL:', error.stack || error); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))

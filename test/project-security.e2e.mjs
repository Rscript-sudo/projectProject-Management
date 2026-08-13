import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-project-security-'))
const userDataDir = path.join(runtimeDir, 'user-data')
const projectRoot = path.join(runtimeDir, 'projects')
app.setPath('userData', userDataDir)

const handlers = new Map()
const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ projectRoot }), 'utf8')

  const { register } = await import('../electron/ipc/project.mjs')
  register(ipcMain)

  const created = await call('fs:createProject', projectRoot, '安全测试项目')
  assert.equal(created.success, true)

  const missingProject = await call('fs:createProject', projectRoot, '删除失败测试项目')
  assert.equal(missingProject.success, true)
  fs.rmSync(missingProject.path, { recursive: true })
  const failedDelete = await call('fs:deleteProject', missingProject.path)
  assert.equal(failedDelete.success, false)
  const indexAfterFailedDelete = JSON.parse(fs.readFileSync(path.join(userDataDir, 'project-index.json'), 'utf8'))
  assert.equal(indexAfterFailedDelete.projects.some(project => project.path === missingProject.path), true)

  const outsideDir = path.join(runtimeDir, 'outside')
  fs.mkdirSync(outsideDir)
  fs.writeFileSync(path.join(outsideDir, 'keep.txt'), '必须保留')
  const rejectedDelete = await call('fs:deleteProject', outsideDir)
  assert.equal(rejectedDelete.success, false)
  assert.equal(fs.readFileSync(path.join(outsideDir, 'keep.txt'), 'utf8'), '必须保留')

  for (const unsafeName of ['../逃逸', '..', 'a/b', '.hidden']) {
    const rejectedRename = await call('fs:renameProject', created.path, unsafeName)
    assert.equal(rejectedRename.success, false, `应拒绝项目名：${unsafeName}`)
    assert.equal(fs.existsSync(created.path), true)
  }

  const rejectedLedger = await call('fs:writeLedger', created.path, '../../escaped.json', { items: [] })
  assert.equal(rejectedLedger.success, false)
  assert.equal(fs.existsSync(path.join(userDataDir, 'escaped.json')), false)

  const validLedger = await call('fs:writeLedger', created.path, '合同台账.json', { items: [{ id: 1 }] })
  assert.equal(validLedger.success, true)

  const renamed = await call('fs:renameProject', created.path, '已重命名项目')
  assert.equal(renamed.success, true)
  assert.equal(fs.existsSync(renamed.path), true)

  const deleted = await call('fs:deleteProject', renamed.path)
  assert.equal(deleted.success, true, deleted.error)
  const index = JSON.parse(fs.readFileSync(path.join(userDataDir, 'project-index.json'), 'utf8'))
  assert.deepEqual(index.projects.map(project => project.path), [missingProject.path])

  console.log('PROJECT SECURITY E2E PASS: delete/rename/ledger boundaries')
}

main().catch(error => {
  console.error('PROJECT SECURITY E2E FAIL:', error.stack || error)
  process.exitCode = 1
}).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

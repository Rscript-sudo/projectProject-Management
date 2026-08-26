import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-evidence-chain-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const projectName = 'AI证据链验收项目'
  const created = await call('fs:createProject', path.join(runtimeDir, 'projects'), projectName, '土建工程')
  assert.equal(created.success, true)
  const polluted = await call('fs:saveDoc', {
    projectPath: created.path, projectName, docType: '通用文档', userInput: '跨专业反例', customSummary: '跨专业反例',
    content: '本日对苗木成活率进行了检查。',
  })
  assert.equal(polluted.success, false)
  assert.match(polluted.error, /跨专业术语/)
  const evidenceResult = await call('db:createEvidenceItem', {
    project_name: projectName, title: '1号楼钢筋验收记录', evidence_type: 'inspection',
    source_ref: '钢筋验收.xlsx', source_location: '第2行', excerpt: '钢筋规格和间距符合设计',
    status: 'pending', critical: true,
  })
  const evidence = evidenceResult.item
  const content = `根据现场验收记录，1号楼钢筋规格和间距符合设计要求。[来源:E${evidence.id}]`
  const blocked = await call('fs:saveDoc', {
    projectPath: created.path, projectName, docType: '通用文档', userInput: '证据门禁', customSummary: '证据门禁',
    content, evidenceIds: [evidence.id],
  })
  assert.equal(blocked.success, false)
  assert.match(blocked.error, /关键证据状态为 pending/)

  const confirmed = await call('db:updateEvidenceStatus', projectName, evidence.id, 'confirmed', '验收人')
  assert.equal(confirmed.updated, true)
  const saved = await call('fs:saveDoc', {
    projectPath: created.path, projectName, docType: '通用文档', userInput: '证据门禁', customSummary: '证据门禁',
    content, evidenceIds: [evidence.id],
  })
  assert.equal(saved.success, true, saved.error)
  assert.ok(fs.existsSync(saved.path))

  const { getDb } = await import('../electron/db/database.mjs')
  const document = getDb().prepare("SELECT * FROM ledger_simple WHERE project_name = ? AND file_name = ?").get(projectName, saved.fileName)
  const relationResult = await call('db:listBusinessRelations', projectName, 'document', document.id)
  const relations = relationResult.data
  assert.equal(relations.length, 1)
  assert.equal(relations[0].target_type, 'evidence')
  assert.equal(relations[0].target_id, String(evidence.id))
  assert.equal(relations[0].relation_type, 'document_evidence')

  closeDb()
  console.log('EVIDENCE CHAIN E2E PASS: pending block / confirm / issue / trace')
}

main().catch(error => { console.error('EVIDENCE CHAIN E2E FAIL:', error.stack || error); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))

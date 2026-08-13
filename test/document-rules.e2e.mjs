import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-document-rules-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  registerAll(ipcMain, null)
  const created = await call('fs:createProject', path.join(runtimeDir, 'projects'), '规则中心验收项目', '土建工程', {})
  assert.equal(created.success, true)
  const catalog = await call('fs:getRuleCatalog')
  assert.ok(catalog.packs.length >= 8)
  assert.ok(catalog.defaults.includes('source_only'))
  const rules = { rulePackIds: ['source_only', 'weekly_evidence', 'weekly_structure', 'formal_tone'], additionalInstruction: '本项目周报不设置投资控制章节。' }
  const saved = await call('fs:saveProjectDocumentRules', created.path, rules)
  assert.equal(saved.success, true)
  const config = await call('fs:readProjectConfig', created.path)
  assert.deepEqual(config.documentRules.rulePackIds, rules.rulePackIds)
  assert.equal(config.documentRules.additionalInstruction, rules.additionalInstruction)
  const { getDocumentRuleMinWords, buildDocumentRulesInjection } = await import('../src/shared/documentRules.mjs')
  assert.equal(getDocumentRuleMinWords('监理周报', config.documentRules), 1000)
  assert.match(buildDocumentRulesInjection('监理周报', config.documentRules), /进度数据可追溯/)
  assert.match(buildDocumentRulesInjection('监理周报', config.documentRules), /不得少于 1000 字/)
  console.log('DOCUMENT RULES E2E PASS')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-priority-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)
  const root = path.join(runtimeDir, 'projects')
  const docType = '监理周报'
  const sourcePath = path.resolve('templates/02_监理周报/监理周报模版.docx')

  const global = await call('fs:importTemplateToLibrary', { sourcePath, docType, scope: 'global', projectType: '通用', name: '全局周报' })
  const professional = await call('fs:importTemplateToLibrary', { sourcePath, docType, scope: 'professional', projectType: '通信工程', name: '通信周报' })
  assert.equal(global.success, true)
  assert.equal(professional.success, true)
  assert.ok(professional.template.fields.includes('集采部分内容'), '导入时应识别 Word 模板中的占位符')

  const telecom = await call('fs:createProject', root, '通信项目', '通信工程')
  const generic = await call('fs:createProject', root, '通用项目', '通用')
  assert.equal(telecom.success, true)
  assert.equal(generic.success, true)

  const telecomAuto = await call('fs:getProjectTemplateContract', telecom.path, docType)
  const genericAuto = await call('fs:getProjectTemplateContract', generic.path, docType)
  assert.equal(telecomAuto.templateId, professional.template.id)
  assert.equal(genericAuto.templateId, global.template.id)

  const selected = await call('fs:selectProjectTemplate', telecom.path, docType, global.template.id)
  assert.equal(selected.success, true)
  const telecomSelected = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomSelected.templateId, global.template.id)

  const overrideSource = path.join(runtimeDir, '专用周报.docx')
  fs.copyFileSync(sourcePath, overrideSource)
  const override = await call('fs:assignProjectTemplate', telecom.path, docType, overrideSource)
  assert.equal(override.success, true)
  const telecomOverride = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomOverride.source, 'project')
  assert.equal(telecomOverride.path, override.path)

  closeDb()
  console.log('TEMPLATE PRIORITY E2E PASS: project > selected > professional > global')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

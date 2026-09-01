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
  assert.equal((await call('settings:set', { projectRoot: root })).success, true)
  const docType = '监理周报'
  const sourcePath = path.resolve('templates/通用/02_监理周报/监理周报模板.docx')

  const systemTemplates = await call('fs:listSystemTemplates')
  const systemWeekly = systemTemplates.find(template => template.docType === docType)
  assert.ok(systemWeekly, '系统模板库应展示内置监理周报模板')
  assert.ok(systemWeekly.fields.includes('集采部分内容'))

  const beforeImport = await call('fs:createProject', root, '预置模板项目', '通用')
  const beforeImportContract = await call('fs:getProjectTemplateContract', beforeImport.path, docType)
  assert.equal(beforeImportContract.found, true, '未导入企业共享模板时仍应使用系统预置模板')
  assert.equal(beforeImportContract.source, 'global')

  const cloned = await call('fs:cloneSystemTemplateToLibrary', { docType, scope: 'global', name: '系统周报企业副本' })
  assert.equal(cloned.success, true)
  assert.ok(fs.existsSync(cloned.template.path), '企业副本应独立保存，不修改系统预置文件')
  const cloneXml = fs.readFileSync(cloned.template.path, 'utf8')
  assert.ok(cloneXml.length > 0)
  const cloneRefresh = await call('fs:refreshTemplateLibraryEntry', cloned.template.id)
  assert.equal(cloneRefresh.success, true)
  assert.ok(cloneRefresh.template.fields.includes('集采部分内容'))
  assert.equal((await call('template:markRuleConfigured', { id: cloned.template.id })).ok, true)
  const clonedContract = await call('fs:getProjectTemplateContract', beforeImport.path, docType)
  assert.equal(clonedContract.templateId, cloned.template.id, '企业副本应覆盖系统预置模板')

  const global = await call('fs:importTemplateToLibrary', { sourcePath, docType, scope: 'global', projectType: '通用', name: '全局周报' })
  const professional = await call('fs:importTemplateToLibrary', { sourcePath, docType, scope: 'professional', projectType: '通信工程', name: '通信周报' })
  const sitePackage = await call('fs:importTemplateToLibrary', { sourcePath, docType, scope: 'professional', projectType: '通信工程', name: '通信站点周报', resourceKind: 'site-package' })
  assert.equal(global.success, true)
  assert.equal(professional.success, true)
  assert.equal(sitePackage.success, true)
  assert.equal(sitePackage.template.resourceKind, 'site-package')
  assert.match(sitePackage.template.path, /站点资料包[/\\]通信工程[/\\]监理周报/)
  assert.ok(professional.template.fields.includes('集采部分内容'), '导入时应识别 Word 模板中的占位符')
  assert.equal((await call('template:markRuleConfigured', { id: global.template.id })).ok, true)
  assert.equal((await call('template:markRuleConfigured', { id: professional.template.id })).ok, true)

  const telecom = await call('fs:createProject', root, '通信项目', '通信工程')
  const information = await call('fs:createProject', root, '信息化项目', '信息化工程')
  const generic = await call('fs:createProject', root, '通用项目', '通用')
  assert.equal(telecom.success, true)
  assert.equal(information.success, true)
  assert.equal(generic.success, true)

  const telecomAuto = await call('fs:getProjectTemplateContract', telecom.path, docType)
  const genericAuto = await call('fs:getProjectTemplateContract', generic.path, docType)
  assert.equal(telecomAuto.templateId, professional.template.id)
  assert.equal(genericAuto.templateId, global.template.id)
  const informationAuto = await call('fs:getProjectTemplateContract', information.path, docType)
  assert.equal(informationAuto.templateId, global.template.id, '未配置专业模板的信息化项目应回退到通用模板')

  const selectSitePackage = await call('fs:selectProjectTemplate', telecom.path, docType, sitePackage.template.id)
  assert.equal(selectSitePackage.success, true)
  const telecomSitePackage = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomSitePackage.templateId, sitePackage.template.id, '站点资料包应在用户明确选择后参与生成')

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

  const clearOverride = await call('fs:clearProjectTemplateOverride', telecom.path, docType)
  assert.equal(clearOverride.success, true)
  const telecomAfterClear = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomAfterClear.templateId, global.template.id, '取消专属模板后应恢复当前项目手动选择')

  const resetSelection = await call('fs:selectProjectTemplate', telecom.path, docType, null)
  assert.equal(resetSelection.success, true)
  const telecomAfterReset = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomAfterReset.templateId, professional.template.id, '清除手动选择后应恢复通信专业模板')

  closeDb()
  console.log('TEMPLATE PRIORITY E2E PASS: 3 projects / project > selected > professional > global / restore flow')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

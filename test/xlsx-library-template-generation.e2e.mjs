import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import XLSX from 'xlsx'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-xlsx-library-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

async function assertWorkbook(filePath, expected) {
  const workbook = XLSX.readFile(filePath)
  const values = workbook.SheetNames.flatMap(name => Object.values(workbook.Sheets[name])
    .filter(cell => cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'v'))
    .map(cell => String(cell.v ?? '')))
  const text = values.join('\n')
  for (const value of expected) assert.ok(text.includes(value), `生成的 XLSX 应包含：${value}`)
  assert.equal(/{{[^{}]+}}/.test(text), false, '生成的 XLSX 不得残留占位符')
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const root = path.join(runtimeDir, 'projects')
  assert.equal((await call('settings:set', { projectRoot: root })).success, true)
  const sourcePath = path.resolve('templates/通用/12_工程变更单/工程变更单模板.xlsx')

  const professional = await call('fs:importTemplateToLibrary', {
    sourcePath, docType: '工程变更单', scope: 'professional', projectType: '信息化工程', name: '信息化工程变更单',
  })
  assert.equal(professional.success, true, professional.error)
  assert.deepEqual(professional.template.fields.sort(), ['变更内容', '变更原因', '致单位', '项目名称'].sort())
  assert.equal(fs.existsSync(path.join(path.dirname(professional.template.path), 'config.json')), true, 'XLSX 导入必须同时复制单元格映射配置')
  assert.equal((await call('template:markRuleConfigured', { id: professional.template.id })).ok, true)

  const created = await call('fs:createProject', root, 'XLSX专业模板验收项目', '信息化工程')
  assert.equal(created.success, true)
  const contract = await call('fs:getProjectTemplateContract', created.path, '工程变更单')
  assert.equal(contract.templateId, professional.template.id)
  const content = [
    '【项目名称】XLSX专业模板验收项目',
    '【致单位】测试承建单位',
    '【变更原因】用户确认的系统接口字段需要调整。',
    '【变更内容】将接口字段映射调整为用户确认版本，并同步更新测试用例。',
  ].join('\n')
  const saved = await call('fs:saveDoc', {
    projectPath: created.path, projectName: 'XLSX专业模板验收项目', docType: '工程变更单',
    userInput: '按已确认的接口变更事实生成', customSummary: '接口字段变更', content,
  })
  assert.equal(saved.success, true, saved.error)
  assert.equal(path.extname(saved.path), '.xlsx')
  await assertWorkbook(saved.path, ['XLSX专业模板验收项目', '测试承建单位', '系统接口字段需要调整', '同步更新测试用例'])

  const personal = await call('fs:importTemplateToLibrary', {
    sourcePath, docType: '工程变更单', scope: 'personal', projectType: '通用', name: '我的工程变更单',
  })
  assert.equal(personal.success, true, personal.error)
  assert.deepEqual(personal.template.fields.sort(), professional.template.fields.sort())
  assert.equal((await call('template:markRuleConfigured', { id: personal.template.id })).ok, true)
  const selected = await call('fs:selectProjectTemplate', created.path, '工程变更单', personal.template.id)
  assert.equal(selected.success, true, selected.error)
  const personalContract = await call('fs:getProjectTemplateContract', created.path, '工程变更单')
  assert.equal(personalContract.templateId, personal.template.id)

  closeDb()
  console.log('XLSX LIBRARY TEMPLATE E2E PASS: professional + personal import / config / recognition / selection / generation')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  if (process.env.KEEP_TEST_OUTPUT) console.log('KEPT TEST OUTPUT:', runtimeDir)
  else fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-project-template-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册 IPC：${channel}`)
  return handler({}, ...args)
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const root = path.join(runtimeDir, 'projects')
  const projectName = '模板隔离验收项目'
  const created = await call('fs:createProject', root, projectName, '通信工程')
  assert.equal(created.success, true)

  const replacement = path.join(runtimeDir, '项目周报模板.docx')
  fs.copyFileSync(path.resolve('templates/02_监理周报/监理周报模版.docx'), replacement)
  const assigned = await call('fs:assignProjectTemplate', created.path, '监理周报', replacement)
  assert.equal(assigned.success, true, assigned.error)
  assert.ok(fs.existsSync(assigned.path))
  assert.ok(assigned.path.startsWith(path.join(created.path, '项目模板')))

  const config = await call('fs:readProjectConfig', created.path)
  assert.equal(config.templateOverrides['监理周报'].path, assigned.path)
  const contract = await call('fs:getProjectTemplateContract', created.path, '监理周报')
  assert.equal(contract.found, true)
  assert.equal(contract.source, 'project')
  assert.ok(contract.fields.includes('集采部分内容'))
  assert.ok(contract.fields.includes('图4说明'))

  const weeklyText = `【日期范围】2026年8月10日至2026年8月16日
【周数】33
【形象进度说明】验收测试周报，数据待核对。
【集采部分内容】数据待核对。
【非集采部分内容】数据待核对。
【到货安装统计】数据待核对。
【安全质量描述】数据待核对。
【存在问题】数据待核对。
【下周计划】数据待核对。
【监理建议】建议施工单位在资料齐全后编制正式周报。
【图1路径】数据待核对。
【图1说明】数据待核对。
【图2路径】数据待核对。
【图2说明】数据待核对。
【图3路径】数据待核对。
【图3说明】数据待核对。
【图4路径】数据待核对。
【图4说明】数据待核对。`.repeat(8)
  const saved = await call('fs:saveDoc', {
    projectPath: created.path, docType: '监理周报', projectName,
    content: weeklyText, customSummary: '模板隔离验收', userInput: '验收测试',
  })
  assert.equal(saved.success, true, saved.error)
  const { default: PizZip } = await import('pizzip')
  const xml = new PizZip(fs.readFileSync(saved.path)).file('word/document.xml').asText()
  assert.equal(xml.includes('undefined'), false)
  assert.equal(xml.includes('{{'), false)
  assert.ok(xml.includes('2026年8月10日至2026年8月16日'))

  closeDb()
  console.log('PROJECT TEMPLATE E2E PASS:', saved.path)
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

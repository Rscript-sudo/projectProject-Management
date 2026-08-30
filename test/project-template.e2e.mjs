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
  assert.equal((await call('settings:set', { projectRoot: root })).success, true)
  const projectName = '模板隔离验收项目'
  const created = await call('fs:createProject', root, projectName, '通信工程')
  assert.equal(created.success, true)

  const replacement = path.join(runtimeDir, '项目周报模板.docx')
  fs.copyFileSync(path.resolve('templates/通用/02_监理周报/监理周报模板.docx'), replacement)
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
【形象进度说明】本周完成现场验收测试与资料核验。
【周进度详情】已完成设备安装抽检、功能测试见证及报验资料复核。
【集采部分内容】集采设备到货资料已核验。
【非集采部分内容】非集采材料进场记录完整。
【到货安装统计】到货与安装数据已登记。
【安全质量描述】现场安全质量检查符合当前控制要求。
【存在问题】个别资料签认时间待建设单位确认。
【下周计划】继续开展验收准备与资料复核。
【监理建议】建议施工单位在资料齐全后编制正式周报。
【图1路径】
【图1说明】
【图2路径】
【图2说明】
【图3路径】
【图3说明】
【图4路径】
【图4说明】`
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

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-e2e-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))

const handlers = new Map()
const ipcMain = {
  handle(channel, handler) {
    if (handlers.has(channel)) throw new Error(`重复注册 IPC：${channel}`)
    handlers.set(channel, handler)
  },
}
const call = async (channel, ...args) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册 IPC：${channel}`)
  return handler({}, ...args)
}
const resultData = result => {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.data)) return result.data
  if (result && typeof result === 'object' && 'success' in result) {
    const { success, ...data } = result
    return data
  }
  return result
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const projectRoot = path.join(runtimeDir, 'projects')
  fs.mkdirSync(projectRoot, { recursive: true })
  const projectName = 'E2E测试项目803'
  const created = await call('fs:createProject', projectRoot, projectName, '信息化工程')
  assert.equal(created.success, true)
  const projectPath = created.path
  assert.ok(fs.existsSync(path.join(projectPath, '03_实施阶段', '01_监理日志')))

  const config = await call('fs:readProjectConfig', projectPath)
  assert.equal(config.projectType, '信息化工程')
  const written = await call('fs:writeProjectConfig', projectPath, {
    ...config, ownerUnit: '测试建设单位', contractor: '测试承建单位', supervisorUnit: '测试监理单位', chiefEngineer: '测试总监', contractAmount: 100000,
  })
  assert.equal(written.success, true)

  const content = '项目资料已核对。'.repeat(30)
  const saved = await call('fs:saveDoc', {
    projectPath, subDir: '03_实施阶段/01_监理日志', docType: '通用文档', projectName,
    content, customSummary: '端到端测试', userInput: '生成测试文档', meta: { subject: '端到端测试' },
  })
  assert.equal(saved.success, true, saved.error)
  assert.ok(fs.existsSync(saved.path))

  const templateContent = '现场设备安装情况已核查，施工过程符合当前报审资料要求。'.repeat(10)
  const templated = await call('fs:saveDoc', {
    projectPath, docType: '监理日志', projectName,
    content: templateContent, customSummary: '模板渲染验证', userInput: '生成监理日志', meta: { subject: '模板渲染验证' },
  })
  assert.equal(templated.success, true, templated.error)
  assert.match(templated.fileName, /_JL-RZ_PJ803_.*\.docx$/)
  assert.ok(fs.existsSync(templated.path))

  const rebuilt = await call('search:rebuild')
  assert.equal(rebuilt.success, true)
  assert.ok(rebuilt.docCount >= 1)
  const searchResults = resultData(await call('search:query', '端到端测试'))
  assert.ok(searchResults.some(item => item.fileName.includes('端到端测试')))

  const inspection = await call('inspection:save', {
    projectPath,
    record: { date: '2026-08-13', location: '机房', issues: [{ found: true, dimKey: 'electrical', dimensionName: '临电安全', label: '漏电保护器有效', description: '测试隐患', severity: '一般' }] },
  })
  assert.equal(inspection.success, true)
  assert.equal(inspection.hazardCount, 1)
  assert.equal(resultData(await call('inspection:list', { projectPath })).length, 1)
  assert.equal((await call('inspection:closeHazard', { hazardId: inspection.hazardIds[0] })).success, true)

  const progress = await call('progress:add', { projectPath, node: { name: '设备安装', plan_start: '2026-08-01', plan_end: '2026-08-31', progress_percent: 50 } })
  assert.equal(progress.success, true)
  assert.equal(resultData(await call('progress:list', projectPath)).length, 1)
  assert.equal(resultData(await call('progress:gantt', { projectPath, yearMonth: '2026-08' })).nodes.length, 1)

  const payment = await call('payment:add', { projectPath, payment: { period: '2026-08', amount: 1000, status: '审批中', approval_stage: '监理员', description: '端到端付款申请' } })
  assert.equal(payment.success, true)
  assert.equal(resultData(await call('payment:list', projectPath)).length, 1)
  for (let i = 0; i < 4; i++) assert.equal((await call('payment:advance', { id: payment.id, person: '测试人', opinion: '同意' })).success, true)
  assert.equal((await call('payment:summary', projectPath)).approvedAmount, 1000)

  const contract = await call('contract:add', { projectPath, contract: { contract_name: '测试合同', amount: 100000, status: '执行中', end_date: '2026-12-31' } })
  assert.equal(contract.success, true)
  assert.equal((await call('contract:dashboard', projectPath)).contractCount, 1)

  const sourcePhoto = path.join(runtimeDir, 'source.jpg')
  fs.writeFileSync(sourcePhoto, 'not-a-real-photo-but-a-file')
  const photo = await call('photo:archive', { projectPath, srcPath: sourcePhoto, shootDate: '2026-08-13', location: '机房', description: '测试照片' })
  assert.equal(photo.success, true)
  assert.ok(fs.existsSync(photo.destPath))
  assert.equal(resultData(await call('photo:list', { projectPath, limit: 20 })).length, 1)

  closeDb()
  console.log('E2E PASS: 项目、文档、检索、巡检、进度、支付、合同、照片归档')
}

main().catch(error => {
  console.error('E2E FAIL:', error.stack || error)
  process.exitCode = 1
}).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

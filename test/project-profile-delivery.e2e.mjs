import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { normalizeProjectProfile } from '../src/shared/projectProfile.mjs'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-profile-delivery-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

async function main() {
  const profile = normalizeProjectProfile({ projectType: '信息化工程', projectTags: ['机房', '网络'], projectFeatures: '数据中心机房改造，含核心交换和视频监控。' })
  assert.equal(profile.projectTypeCode, 'information')
  assert.deepEqual(profile.projectTags, ['机房', '网络'])
  // v1.x：禁用术语机制已移除，内置专业 forbiddenTerms 恒为空
  assert.equal((profile.forbiddenTerms || []).length, 0)

  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)
  const root = path.join(runtimeDir, 'projects')
  const projectName = '信息化画像验收项目'
  const created = await call('fs:createProject', root, projectName, '信息化工程', { ...profile, projectCode: 'INFO2026', ownerUnit: '测试建设单位', contractor: '测试施工单位', supervisorUnit: '测试监理单位', chiefEngineer: '李总监' })
  assert.equal(created.success, true, created.error)
  const config = await call('fs:readProjectConfig', created.path)
  assert.equal(config.projectTypeCode, 'information')
  assert.equal(config.projectCode, 'INFO2026')
  assert.equal(config.ownerUnit, '测试建设单位')
  assert.equal(config.contractor, '测试施工单位')
  assert.equal(config.supervisorUnit, '测试监理单位')
  assert.equal(config.chiefEngineer, '李总监')
  assert.deepEqual(config.projectTags, ['机房', '网络'])
  assert.match(config.projectFeatures, /数据中心机房改造/)

  const sop = await call('sop:read', { projectType: '信息化工程', docType: '安全通知书' })
  assert.equal(sop.found, true)
  assert.equal(sop.projectTypeCode, 'information')

  // v1.x：禁用术语不再拦截 —— 含“塔吊”等土建术语的内容应能正常保存
  const saved = await call('fs:saveDoc', {
    projectPath: created.path, projectName, docType: '监理日志', userInput: '测试', customSummary: '术语不再拦截',
    content: '【施工部位】机房\n【参与人员】监理1名\n【今日内容】现场塔吊作业。\n【核心工作落实】已核查。\n【协调解决情况】无。\n【其他事项】无。',
  })
  assert.equal(saved.success, true, saved.error)

  closeDb()
  console.log('PROJECT PROFILE DELIVERY E2E PASS')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  if (!process.env.KEEP_TEST_OUTPUT) fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

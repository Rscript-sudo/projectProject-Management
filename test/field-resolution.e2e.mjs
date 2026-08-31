import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-field-resolution-'))
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

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const explicit = await call('field:resolveTemplateContext', {
    input: '2026年8月30日，天气晴，气温26℃。今天布放20公里光缆，安装15个交接箱。',
    project: { projectName: '字段解析验收项目' },
    fields: ['日期', '星期几', '天气情况', '气温', '今日内容', '协调解决情况'],
  })
  assert.equal(explicit.success, true, explicit.error)
  assert.equal(explicit.businessDate, '2026-08-30')
  assert.equal(explicit.values.日期, '2026年08月30日')
  assert.equal(explicit.values.星期几, '星期日')
  assert.deepEqual(explicit.warnings, [])
  // 用户已明确提供天气时，解析器不应再次查询或覆盖用户事实。
  assert.equal('天气情况' in explicit.values, false)
  assert.equal('气温' in explicit.values, false)

  const softMissing = await call('field:resolveTemplateContext', {
    input: '今天完成机房设备标签核对。',
    project: { projectName: '未配置实施区域项目' },
    fields: ['日期', '天气', '气温'],
  })
  assert.equal(softMissing.success, true, softMissing.error)
  assert.ok(softMissing.values.日期)
  assert.ok(softMissing.warnings.some(item => item.includes('实施区域')))
  assert.equal('天气' in softMissing.values, false)

  closeDb()
  console.log('FIELD RESOLUTION E2E PASS')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  process.exit(process.exitCode || 0)
})

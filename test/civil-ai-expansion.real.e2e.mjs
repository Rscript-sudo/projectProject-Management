// 真实 AI 冒烟验收：只读取已登录客户端的加密设置，不输出密钥或模型正文。
// 运行：npx electron test/civil-ai-expansion.real.e2e.mjs
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

app.setPath('userData', path.join(os.homedir(), 'Library', 'Application Support', 'project-management-system'))

const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = (channel, ...args) => handlers.get(channel)({}, ...args)

const endpointByProvider = {
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.chat/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { getSettings } = await import('../electron/ipc/shared.mjs')
  registerAll(ipcMain, null)
  const settings = getSettings()
  assert.equal(typeof settings.apiKey, 'string', '本机 AI Key 无法由测试进程解密；请在已安装客户端中执行真实扩写验收')
  assert.ok(settings.apiKey, '本机未配置可用 AI Key，无法执行真实扩写验收')
  const base = settings.aiProvider === 'custom'
    ? settings.baseUrl
    : endpointByProvider[settings.aiProvider]
  assert.ok(base, `服务商 ${settings.aiProvider} 没有 API 地址`)

  const projectFact = `项目画像：土建工程；标签：地基基础、主体结构、防水；建设范围：3栋18层住宅及地下1层车库；当前阶段：主体结构施工。`
  const system = `你是驻场总监理工程师。${projectFact}
只可依据项目画像和下列现场事实撰写；不得写信息化、机房、网络、测试基线等跨专业内容；未提供的数据不得编造。输出中文正式监理日志正文，分为施工部位、今日监理工作、发现及处理、明日计划四段，总字数 300 至 500 字。`
  const user = '现场事实：2026年8月13日，3号楼五层梁板施工。上午复核钢筋规格、间距、保护层垫块、箍筋加密区；下午检查模板支撑、拼缝、清扫口，并对混凝土浇筑实施旁站。发现局部梁底保护层垫块不足、模板拼缝不严；施工单位当日补齐垫块并加固拼缝，复核符合要求。明日计划复核五层混凝土养护和六层墙柱钢筋定位。'
  const result = await call('ai:call', {
    url: `${base.replace(/\/+$/, '')}/chat/completions`, model: settings.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  })
  assert.equal(result.success, true, result.error)
  const text = String(result.content || '')
  assert.ok(text.length >= 250, `AI 扩写过短：${text.length} 字`)
  assert.match(text, /钢筋|模板|混凝土|梁板/, 'AI 扩写未覆盖土建现场事实')
  assert.doesNotMatch(text, /机房|网络|测试基线|数据中心|塔吊/, 'AI 扩写出现跨类型或未提供术语')
  console.log(`CIVIL REAL AI EXPANSION PASS: ${text.length} chars; provider=${settings.aiProvider}; model=${settings.model}`)
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))

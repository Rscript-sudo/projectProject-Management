import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-ai-flow-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)
let mockServer

async function startMockServer(apiKey) {
  const child = spawn('/usr/bin/env', ['node', path.resolve('test/fixtures/mock-ai-server.mjs')], {
    env: { ...process.env, MOCK_API_KEY: apiKey },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`mock AI server exited before ready (${code})`)))
    child.stdout.once('data', chunk => resolve(Number(String(chunk).trim())))
  })
  return { child, port }
}

async function documentXml(filePath) {
  const { default: PizZip } = await import('pizzip')
  return new PizZip(fs.readFileSync(filePath)).file('word/document.xml')?.asText() || ''
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  // 设置页保存其他字段时必须保留原密钥；已保存密钥无需回显即可供主进程调用。
  const fakeKey = 'e2e-key-preserve-check'
  assert.equal((await call('settings:set', { projectRoot: runtimeDir, aiProvider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: fakeKey })).success, true)
  assert.equal((await call('settings:set', { projectRoot: runtimeDir, aiProvider: 'minimax', baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' })).success, true)
  assert.equal((await call('settings:getFull')).apiKey, fakeKey, '保存其他配置不应清除已加密 API Key')
  mockServer = await startMockServer(fakeKey)
  const port = mockServer.port
  const listedModels = await call('ai:listModels', { baseUrl: `http://127.0.0.1:${port}` })
  assert.deepEqual(listedModels.models, ['mock-recommended-model', 'mock-backup-model'], '已保存密钥应可直接拉取模型，无需再次填写')

  const imagePath = path.join(runtimeDir, '现场图片.png')
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nSIAAAAASUVORK5CYII=', 'base64'))
  const visionPort = port
  await call('settings:set', { projectRoot: runtimeDir, aiProvider: 'custom', baseUrl: `http://127.0.0.1:${visionPort}`, model: 'mock-vision-model' })
  const recognizedImage = await call('photo:recognizeImages', { paths: [imagePath] })
  assert.equal(recognizedImage.success, true, recognizedImage.error)
  assert.match(recognizedImage.content, /配电箱门开启/)

  // 1. 模板中心：导入真实 DOCX，并同时验证字段扫描和 Word 表格预览数据。
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模板.docx')
  const imported = await call('fs:importTemplateToLibrary', {
    sourcePath, docType: '监理日志', scope: 'global', projectType: '通用', name: '端到端监理日志模板',
  })
  assert.equal(imported.success, true, imported.error)
  const expectedFields = ['项目名称', '日期', '星期几', '天气', '气温', '施工部位', '参与人员', '今日内容', '核心工作落实', '协调解决情况', '其他事项']
  assert.deepEqual(imported.template.fields, expectedFields)
  const preview = await call('fs:readFileContent', imported.template.path)
  assert.equal(preview.success, true, preview.error)
  assert.match(preview.html, /<table>/)
  assert.match(preview.html, /rowspan="4"/)
  for (const field of expectedFields) assert.match(preview.html, new RegExp(`\\{\\{${field}\\}\\}`))

  // 2. AI 扩写规则：模拟界面保存后的唯一规则源。
  const uniqueRule = '仅根据当天旁站和巡视事实，按施工工序、检查结果、问题处理、复核结论依次扩写；未提供的信息写“待确认”。'
  const fieldRules = {
    今日内容: uniqueRule,
    核心工作落实: '围绕质量控制和旁站履职事实扩写，不增加未提供的数据。',
    协调解决情况: '写清问题、协调对象、处理结果和复核状态。',
    其他事项: '记录安全巡视和次日计划，仅使用已知事实。',
  }
  const systemTemplate = `【字段逐项规则】\n${expectedFields.map(field => `- 【${field}】${fieldRules[field] || '由项目资料或系统自动填充，AI不得改写。'}`).join('\n')}\n\n【输出合同】\n只输出模板已有的【key】value。`
  const settings = await call('settings:get')
  const savedSettings = await call('settings:set', {
    ...settings,
    docTypePromptOverrides: {
      监理日志: {
        systemTemplate,
        userTemplate: '${projectContext}\n\n【现场事实】\n${userInput}\n\n只输出模板字段。',
        minWords: 200,
        fields: Object.keys(fieldRules).map(key => ({ key, required: true })),
        extras: { fieldRules },
      },
    },
  })
  assert.equal(savedSettings.success, true, savedSettings.error)

  // 3. AI 助手：加载真实运行时 prompt 构建器，确认读取的是刚保存的规则，并执行模拟模型调用。
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  globalThis.window = {
    electronAPI: {
      callAI: async ({ messages }) => {
        const system = messages.find(message => message.role === 'system')?.content || ''
        assert.match(system, new RegExp(uniqueRule))
        return {
          success: true,
          content: `【施工部位】3号楼五层梁板\n【参与人员】监理2名、施工班组12名\n【今日内容】上午复核梁板钢筋规格、间距、箍筋加密区和保护层垫块，逐项核对施工图及已批准方案；下午检查模板支撑、拼缝和清扫口，并对混凝土浇筑实施旁站，巡视布料、振捣及施工缝留置情况。\n【核心工作落实】检查中发现局部梁底保护层垫块不足，施工单位当场补齐并重新调整钢筋位置；模板拼缝检查结果符合方案要求。监理人员对整改区域再次测量和观察，复核后确认满足设计及方案要求。\n【协调解决情况】监理与施工单位现场确认整改范围、处理动作和复核标准，施工班组完成整改后提交复查；监理复查通过并记录整改前后情况，未将未经确认的信息写入日志。\n【其他事项】安全巡视检查临边防护、临时用电和泵送作业区域，未发现异常；次日计划复核混凝土养护情况及六层墙柱钢筋定位。`,
        }
      },
    },
  }
  const ai = await vite.ssrLoadModule('/src/services/aiService.ts')
  ai.setDocTypePromptsOverrides({ 监理日志: { systemTemplate, userTemplate: '${projectContext}\n${userInput}', minWords: 200, fields: Object.keys(fieldRules).map(key => ({ key, required: true })), extras: { fieldRules } } }, null)
  const prompt = ai.buildDocPrompt('监理日志', '3号楼五层梁板钢筋、模板和混凝土旁站，垫块不足已整改。', {
    projectName: '端到端测试项目', projectType: '土建工程', contractor: '测试施工单位', supervisorUnit: '测试监理单位',
  }, undefined, undefined, expectedFields)
  assert.match(prompt.system, new RegExp(uniqueRule))
  for (const field of expectedFields) assert.match(prompt.system, new RegExp(`【${field}】`))
  const aiResult = await ai.callAI({ provider: 'deepseek', baseUrl: '', model: 'mock-model' }, [
    { role: 'system', content: prompt.system }, { role: 'user', content: prompt.user },
  ])
  assert.equal(aiResult.success, true)
  const structured = ai.parseStructuredContent(aiResult.content)
  for (const field of Object.keys(fieldRules)) assert.ok(structured[field], `AI 输出缺少字段：${field}`)

  // 4. 输出文档：当前项目选择导入模板，用 AI 结果生成正式 Word，并检查残留占位符。
  const project = await call('fs:createProject', path.join(runtimeDir, 'projects'), '端到端测试项目', '土建工程', {})
  assert.equal(project.success, true, project.error)
  const chatMessages = [
    { id: 'user-1', role: 'user', content: '五层梁板支撑存在松动，请撰写整改通知书。', timestamp: new Date().toISOString() },
    { id: 'assistant-1', role: 'assistant', content: '已按项目事实生成。', docType: '整改通知书', timestamp: new Date().toISOString() },
  ]
  const historySaved = await call('fs:writeProjectChatHistory', project.path, chatMessages)
  assert.equal(historySaved.success, true, historySaved.error)
  const historyRestored = await call('fs:readProjectChatHistory', project.path)
  assert.equal(historyRestored.success, true, historyRestored.error)
  assert.deepEqual(historyRestored.messages.map(item => ({ role: item.role, content: item.content })), chatMessages.map(item => ({ role: item.role, content: item.content })), '项目聊天记录必须可持久化恢复')
  await call('fs:writeProjectConfig', project.path, {
    projectType: '土建工程', contractor: '测试施工单位', supervisorUnit: '测试监理单位', templateSelections: { 监理日志: imported.template.id },
  })
  const selected = await call('fs:selectProjectTemplate', project.path, '监理日志', imported.template.id)
  assert.equal(selected.success, true, selected.error)
  const output = await call('fs:saveDoc', {
    projectPath: project.path, projectName: '端到端测试项目', docType: '监理日志', userInput: '当天旁站巡视事实', content: aiResult.content,
  })
  assert.equal(output.success, true, output.error)
  assert.ok(fs.existsSync(output.path))
  const xml = await documentXml(output.path)
  assert.doesNotMatch(xml, /\{\{[^}]+\}\}/, '最终 Word 仍残留模板占位符')
  assert.match(xml, /梁板钢筋规格/)
  assert.match(xml, /复查通过/)

  await vite.close()
  closeDb()
  console.log('TEMPLATE → RULES → AI ASSISTANT → DOCX FULL FLOW PASS')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  mockServer?.child.kill('SIGTERM')
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  process.exit(process.exitCode || 0)
})

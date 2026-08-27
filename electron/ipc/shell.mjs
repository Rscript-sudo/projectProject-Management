import { shell, dialog, app, net } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { safeCall } from './safe.mjs'
import { getSettings } from './shared.mjs'
import { DATA_TOOLS } from '../dataTools.mjs'
import { parseMaterial } from './material.mjs'
import { registerTaskCancellation, updateTask, appendDiagnostic } from '../operationCenter.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 文件内容读取 — 支持的文件类型
const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.less', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.env', '.sh', '.bat', '.py', '.java', '.cpp', '.c', '.h', '.sql', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.vue', '.svelte', '.astro'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif'])

const PROVIDER_BASE_URLS = {
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimaxi.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

// Electron 主进程优先使用 Chromium 网络栈；它对系统代理、证书和局域网服务的
// 行为比 Node 全局 fetch 更稳定，也避免新版本 Electron 中请求无法及时中止。
const requestFetch = (...args) => net.fetch(...args)

function normalizeAIBaseUrl(provider, baseUrl) {
  let base = String(baseUrl || PROVIDER_BASE_URLS[provider] || '').replace(/\/+$/, '')
  // MiniMax 旧域名仍可能响应，但官方 OpenAI 兼容接口已迁移到 minimaxi.com。
  if (provider === 'minimax' && /api\.minimax\.chat/i.test(base)) base = 'https://api.minimaxi.com/v1'
  return base
}

function resolveAIUrl(options, settings) {
  const provider = options.provider || settings.aiProvider || 'deepseek'
  const base = normalizeAIBaseUrl(provider, options.baseUrl || settings.baseUrl)
  if (!base) throw new Error('API 地址未配置')
  return `${base}/chat/completions`
}

function getTemplatesDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'templates')
  }
  return path.join(__dirname, '..', '..', 'templates')
}

export function register(ipcMain, mainWindow) {
  ipcMain.handle('shell:openFile', async (_, filePath) => {
    if (!filePath || !isPathSafe(filePath)) {
      return { success: false, error: '路径不安全' }
    }
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }
    const err = await shell.openPath(filePath)
    if (err) return { success: false, error: err }
    return { success: true }
  })

  ipcMain.handle('shell:openPath', async (_, dirPath) => {
    if (!dirPath || !isPathSafe(dirPath)) {
      return { success: false, error: '路径不安全' }
    }
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: '路径不存在' }
    }
    const err = await shell.openPath(dirPath)
    if (err) return { success: false, error: err }
    return { success: true }
  })

  // 复制路径到剪贴板
  ipcMain.handle('shell:copyPath', safeCall(async (_, targetPath) => {
    const { clipboard } = await import('electron')
    clipboard.writeText(targetPath || '')
    return { success: true }
  }))

  // 从系统剪贴板读取文本。用于密钥等 Password 输入框的明确“粘贴”操作，
  // 避免 macOS 打包应用中右键菜单或快捷键不可用时无法录入。
  ipcMain.handle('shell:readClipboardText', safeCall(async () => {
    const { clipboard } = await import('electron')
    return { success: true, text: clipboard.readText() }
  }))

  ipcMain.handle('dialog:selectDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '文档', extensions: ['doc', 'docx', 'xlsx', 'xls', 'pdf', 'txt', 'md', 'csv', 'json'] },
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif'] },
      ],
    })
    if (result.canceled) return null
    return result.filePaths
  })

  // 读取文件内容（供 AI 分析使用）
  ipcMain.handle('fs:readFileContent', safeCall(async (_, filePath) => {
    if (!filePath || !isPathSafe(filePath)) {
      return { success: false, error: '路径不安全' }
    }
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }

    const ext = path.extname(filePath).toLowerCase()
    const fileName = path.basename(filePath)
    const stat = fs.statSync(filePath)
    const MAX_SIZE = 50 * 1024  // 50KB

    // 文本文件
    if (TEXT_EXTS.has(ext)) {
      let content = fs.readFileSync(filePath, 'utf-8')
      const truncated = content.length > MAX_SIZE
      if (truncated) content = content.slice(0, MAX_SIZE) + '\n\n... [内容截断，仅显示前50KB]'
      return { success: true, fileName, ext, type: 'text', content, size: stat.size, truncated }
    }

    // Word 文档
    if (ext === '.docx') {
      const mammoth = await import('mammoth')
      const buffer = fs.readFileSync(filePath)
      const [textResult, htmlResult] = await Promise.all([
        mammoth.extractRawText({ buffer }),
        mammoth.convertToHtml({ buffer }),
      ])
      let content = textResult.value || ''
      const truncated = content.length > MAX_SIZE
      if (truncated) content = content.slice(0, MAX_SIZE) + '\n\n... [内容已截断，仅显示前50KB]'
      return { success: true, fileName, ext, type: 'text', content, html: htmlResult.value || '', size: stat.size, truncated }
    }

    // Excel、PDF：统一本地解析。PDF 有文字层时可直接用于 AI；扫描件明确提示需 OCR。
    if (ext === '.xlsx' || ext === '.xls' || ext === '.pdf') {
      const parsed = await parseMaterial(filePath)
      if (!parsed.success) return { success: false, error: parsed.error }
      let content = parsed.text || ''
      const truncated = Boolean(parsed.truncated)
      if (truncated) content += '\n\n... [内容已截断，仅显示前50KB]'
      return { success: true, fileName, ext, type: 'text', content, size: stat.size, truncated, note: parsed.note }
    }

    // 图片
    if (IMAGE_EXTS.has(ext)) {
      return { success: true, fileName, ext, type: 'image', content: '', size: stat.size, note: '图片文件，无法直接读取文字内容' }
    }

    // 其他二进制文件
    return { success: true, fileName, ext, type: 'binary', content: '', size: stat.size, note: `文件类型 ${ext} 暂不支持内容解析` }
  }))

  ipcMain.handle('dialog:selectSavePath', async (_, defaultPath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['createDirectory'],
    })
    if (result.canceled) return null
    return result.filePath
  })

  ipcMain.handle('dialog:selectTemplateFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目专用 Word 模板',
      properties: ['openFile'],
      filters: [{ name: 'Word 模板', extensions: ['docx'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('fs:getTemplateCatalog', async () => {
    try {
      const templatesDir = getTemplatesDir()
      const { buildTemplateCatalog } = await import('../templateService.mjs')
      return buildTemplateCatalog(templatesDir)
    } catch (e) {
      console.error('[fs:getTemplateCatalog]', e.message)
      return []
    }
  })

/**
 * 上下文截断 — 防止 API 请求超出模型上下文窗口
 * 保留 system prompt + 最近的 N 条对话，丢弃旧消息
 */
const MODEL_LIMITS = {
  'deepseek': 131072,
  'moonshot': 131072,
  'glm': 131072,
  'qwen': 131072,
  'abab': 262144,
}
const DEFAULT_LIMIT = 131072
const SAFETY_MARGIN = 8192  // 保留给 AI 输出

function estimateTokens(text) {
  // 粗略估算：中文 ~1.5 tokens/字，英文/符号 ~0.5 tokens/字符
  let chinese = 0, other = 0
  for (const c of text) {
    if (c > 'ÿ') chinese++
    else other++
  }
  return Math.ceil(chinese * 1.5 + other * 0.5) + 4  // +4 算 message 开销
}

function trimContext(messages, modelName) {
  const maxTokens = (Object.entries(MODEL_LIMITS).find(([k]) => modelName?.includes(k))?.[1] || DEFAULT_LIMIT) - SAFETY_MARGIN

  // 计算总 tokens
  let total = 0
  for (const m of messages) total += estimateTokens(m.content)

  if (total <= maxTokens) return messages  // 安全

  // 超限 → 保留 system + 尽可能多的最近消息
  const sysMsg = messages.find(m => m.role === 'system')
  const others = messages.filter(m => m !== sysMsg)

  const kept = []
  let keptTotal = sysMsg ? estimateTokens(sysMsg.content) : 0
  // 从最新消息开始保留
  for (let i = others.length - 1; i >= 0; i--) {
    const t = estimateTokens(others[i].content)
    if (keptTotal + t > maxTokens) break
    kept.push(others[i])
    keptTotal += t
  }

  const result = sysMsg ? [sysMsg, ...kept.reverse()] : kept.reverse()
  const dropped = messages.length - result.length

  if (dropped > 0) {
    console.debug(`[trimContext] ${modelName || 'unknown'} — dropped ${dropped}/${messages.length} messages (${total}→${keptTotal} tokens)`)
  }

  return result
}

/**
 * 数据预取 — 将项目实时数据注入为 LLM 上下文
 * 用于 ai:stream 和 ai:call 两个 handler 共享
 */
function buildDataInjectedMessages(messages, mode, projectName, dataToolIds, reportPeriod) {
  if (!mode || !projectName || !dataToolIds?.length) return messages
  if (mode !== 'DATA_QUERY' && mode !== 'HYBRID') return messages

  const dataParts = []
  for (const toolId of dataToolIds) {
    const tool = DATA_TOOLS.find(t => t.id === toolId)
    if (!tool) continue
    try {
      const raw = tool.query(projectName, { period: reportPeriod })
      if (raw && Object.keys(raw).length > 0) {
        dataParts.push(`【${tool.name}】\n${JSON.stringify(raw, null, 2)}`)
      }
    } catch (e) {
      console.error(`[shell] dataTool ${toolId} error:`, e.message)
    }
  }

  if (dataParts.length === 0) return messages

  const dataContext = dataParts.join('\n\n')

  if (mode === 'HYBRID') {
    const sysIdx = messages.findIndex(m => m.role === 'system')
    if (sysIdx >= 0) {
      const sys = { ...messages[sysIdx] }
      const periodHint = reportPeriod?.start && reportPeriod?.end ? `报告期为 ${reportPeriod.start} 至 ${reportPeriod.end}，不得引用报告期外事实。` : '未选择报告期：不得生成可签发的周报或月报，只能提示用户先选择报告期。'
      sys.content += `\n\n【项目受控数据】\n${dataContext}\n\n${periodHint} 请充分利用以上数据生成准确的文档内容；未提供的数量、日期和事实不得补造。`
      const result = [...messages]
      result[sysIdx] = sys
      return result
    }
    return messages
  }

  // DATA_QUERY
  const userMsg = messages.find(m => m.role === 'user')?.content || ''
  return [
    {
      role: 'system',
      content: `你是一位资深的工程监理业务AI助手，当前可以访问项目「${projectName}」的实时数据。

【当前项目数据】
${dataContext}

请根据以上数据回答用户的问题。要求：
1. 引用具体数据（数字、条目数、具体名称）
2. 如果有异常（滞后、未整改隐患、审批停滞等），给出简要分析
3. 使用自然、简洁的语言
4. 如需要进一步查看细节，可以建议用户进一步提问`,
    },
    { role: 'user', content: userMsg },
  ]
}

  // 流式 AI 调用 — 通过 webContents.send 推送每个 chunk
  // 新增参数：mode / projectName / dataToolIds — 用于数据预取后注入 prompt
  // 安全：apiKey 不再从 IPC 参数传入，主进程从加密存储读取
  ipcMain.handle('ai:stream', async (event, options) => {
    const sender = event.sender
    const requestId = options.requestId || `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    const operationId = String(options.operationId || '')
    const unregisterCancellation = operationId ? registerTaskCancellation(operationId, () => controller.abort('cancelled')) : () => {}
    if (operationId) {
      try { updateTask(operationId, { status: 'running', stage: 'requesting', progress: 30, attempts: Number(options.attempt || 1), requestId }) } catch {}
    }

    // 监听渲染进程主动中断
    const abortChannel = `ai:abort:${requestId}`
    ipcMain.once(abortChannel, () => controller.abort())

    const settings = getSettings()
    const apiKey = settings.apiKey
    if (!apiKey) {
      // 区分两种情况：
      //   1. settings.json 里压根没 apiKey  → 真正的"未配置"
      //   2. settings.json 里有但解不开      → 提示重新输入（Keychain 数据失效）
      const errMsg = settings._apiKeyDecryptError
        ? `已配置的 API Key 无法解密（可能换了电脑/系统重装）。请到【设置】页重新输入 API Key。原因：${settings._apiKeyDecryptError}`
        : '未配置 API Key，请在【设置】页填写'
      return { success: false, error: settings._apiKeyDecryptError ? 'API Key 配置异常' : 'API Key 未配置', requestId }
    }

    let url
    try {
      url = resolveAIUrl(options, settings)
    } catch (error) {
      return { success: false, error: error.message, requestId }
    }

    // IPC 立即返回 requestId；渲染端已在发起请求前注册好监听器。
    setImmediate(async () => {
      const timeout = setTimeout(() => controller.abort(), 180000)
      let finalMessages = buildDataInjectedMessages(options.messages, options.mode, options.projectName, options.dataToolIds, options.reportPeriod)
      finalMessages = trimContext(finalMessages, options.model)
      const send = (channel, payload) => {
        if (!sender.isDestroyed()) sender.send(channel, payload)
      }
      const sendEnd = () => send('ai:stream:end', { requestId })
      try {
        let response
        let lastFetchError
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            response = await requestFetch(url, {
              method: 'POST', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ model: options.model, messages: finalMessages, stream: true, temperature: 0.4, max_tokens: 8192 }),
            })
            if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break
            if (operationId) appendDiagnostic({ taskId: operationId, level: 'warn', stage: 'transport_retry', message: `模型服务返回 ${response.status}，正在自动重试` })
          } catch (error) {
            lastFetchError = error
            if (error.name === 'AbortError' || attempt === 2) throw error
            if (operationId) appendDiagnostic({ taskId: operationId, level: 'warn', stage: 'transport_retry', message: '网络请求失败，正在自动重试', detail: error.message })
          }
          await new Promise(resolve => setTimeout(resolve, 800 * attempt))
        }
        if (!response && lastFetchError) throw lastFetchError
        if (!response.ok || !response.body) {
          let errorMsg = `API 请求失败 (${response.status})`
          try { const data = await response.json(); errorMsg = data.error?.message || data.error || errorMsg } catch {}
          send('ai:stream:chunk', { requestId, type: 'error', error: errorMsg })
          sendEnd()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const consumeEvent = (evt) => {
          for (const line of evt.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (!data || data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || ''
              if (content) send('ai:stream:chunk', { requestId, type: 'content', content })
            } catch {}
          }
        }
        while (true) {
          if (sender.isDestroyed()) { try { await reader.cancel() } catch {}; return }
          const { done, value } = await reader.read()
          if (done) break
          if (operationId) { try { updateTask(operationId, { status: 'running', stage: 'streaming', progress: 65 }) } catch {} }
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() || ''
          events.forEach(consumeEvent)
        }
        buffer += decoder.decode()
        if (buffer.trim()) consumeEvent(buffer)
        sendEnd()
      } catch (error) {
        const cancelled = controller.signal.reason === 'cancelled'
        const errorMsg = error.name === 'AbortError' ? (cancelled ? 'AI 请求已取消' : 'AI 请求超时（180秒）') : error.message
        send('ai:stream:chunk', { requestId, type: 'error', error: errorMsg })
        sendEnd()
      } finally {
        clearTimeout(timeout)
        unregisterCancellation()
        ipcMain.removeAllListeners?.(abortChannel)
      }
    })

    return { success: true, requestId }
  })

  // 前端拉取项目实时数据（供右侧面板展示）
  ipcMain.handle('data:query', safeCall(async (_, { projectName, toolIds, reportPeriod }) => {
    const results = {}
    if (!projectName || !toolIds?.length) return results
    for (const toolId of toolIds) {
      const tool = DATA_TOOLS.find(t => t.id === toolId)
      if (tool) {
        try {
          results[toolId] = tool.query(projectName, { period: reportPeriod })
        } catch (e) {
          results[toolId] = { error: e.message }
        }
      }
    }
    return results
  }))

  ipcMain.handle('ai:call', safeCall(async (_, options) => {
    // 主进程持有 apiKey，不再从 IPC 接收
    const settings = getSettings()
    const apiKey = settings.apiKey
    if (!apiKey) {
      return { success: false, error: 'API Key 未配置，请在设置中填写' }
    }
    const url = resolveAIUrl(options, settings)
    let finalMessages = buildDataInjectedMessages(options.messages, options.mode, options.projectName, options.dataToolIds, options.reportPeriod)
    finalMessages = trimContext(finalMessages, options.model)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await requestFetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: options.model, messages: finalMessages, stream: false, temperature: 0.4, max_tokens: 8192 }),
      })
      clearTimeout(timeout)

      if (!response.ok) {
        let errorMsg = `API 请求失败 (${response.status})`
        try {
          const errorData = await response.json()
          errorMsg = errorData.error?.message || errorData.error || errorMsg
        } catch {
          try {
            errorMsg = await response.text()
          } catch {}
        }
        return { success: false, error: errorMsg }
      }

      const data = await response.json()
      if (!data.choices?.[0]?.message?.content) {
        return { success: false, error: 'AI 响应格式异常，未返回有效内容' }
      }
      return { success: true, content: data.choices[0].message.content, usage: data.usage }
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') {
        return { success: false, error: 'AI 请求超时（60秒），请稍后重试' }
      }
      throw e
    }
  }))

  // 获取 AI 模型列表（调用各服务商的 /models 接口）
  ipcMain.handle('ai:listModels', safeCall(async (_, { baseUrl, apiKey }) => {
    const savedApiKey = getSettings().apiKey
    const effectiveApiKey = apiKey || (typeof savedApiKey === 'string' ? savedApiKey : '')
    if (!effectiveApiKey) return { success: false, error: 'API Key 未配置' }
    if (!baseUrl) return { success: false, error: 'API 地址未填写' }

    // 构造 /models 请求地址
    const base = baseUrl.replace(/\/+$/, '')  // 去掉末尾斜杠
    let modelUrl = `${base}/models`

    // 通义千问 DashScope 的模型列表地址特殊
    if (base.includes('dashscope')) {
      modelUrl = 'https://dashscope.aliyuncs.com/api/v1/models'
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await requestFetch(modelUrl, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${effectiveApiKey}`,
          'Accept': 'application/json',
        },
      })
      clearTimeout(timeout)

      if (!response.ok) {
        let errorMsg = `获取模型列表失败 (${response.status})`
        try { const d = await response.json(); errorMsg = d.error?.message || d.error || errorMsg } catch {}
        return { success: false, error: errorMsg }
      }

      const data = await response.json()
      // OpenAI 兼容格式: { data: [{ id: 'gpt-4', ... }] }
      // DashScope 格式: { data: { models: [...] } }
      let models = []
      if (Array.isArray(data.data)) {
        models = data.data.map(m => m.id).filter(Boolean)
      } else if (data.data?.models) {
        models = data.data.models.map(m => m.model_name || m.name).filter(Boolean)
      }

      return { success: true, models }
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') {
        return { success: false, error: '请求超时，请检查 API 地址是否正确' }
      }
      return { success: false, error: e.message || '网络请求失败' }
    }
  }))

  ipcMain.handle('ai:health', safeCall(async (_, options = {}) => {
    const settings = getSettings()
    const apiKey = settings.apiKey
    if (!apiKey || typeof apiKey !== 'string') return { success: false, error: 'API Key 未配置或无法解密' }
    const provider = options.provider || settings.aiProvider
    const baseUrl = normalizeAIBaseUrl(provider, options.baseUrl || settings.baseUrl)
    const model = options.model || settings.model
    if (!baseUrl) return { success: false, error: 'API 地址未配置' }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await requestFetch(`${baseUrl}/models`, {
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      })
      if (response.status === 404 || response.status === 405) {
        return { success: true, provider, baseUrl, model, models: [], warning: '服务商不支持模型列表检查' }
      }
      if (!response.ok) return { success: false, error: `AI 服务检查失败 (${response.status})` }
      const data = await response.json()
      const models = Array.isArray(data.data) ? data.data.map(item => item.id).filter(Boolean) : []
      if (models.length && model && !models.includes(model)) {
        return { success: false, error: `当前模型“${model}”不在服务商可用列表中`, models }
      }
      return { success: true, provider, baseUrl, model, models }
    } catch (error) {
      return { success: false, error: error.name === 'AbortError' ? 'AI 服务健康检查超时' : (error.message || 'AI 服务无法连接') }
    } finally {
      clearTimeout(timeout)
    }
  }))
}

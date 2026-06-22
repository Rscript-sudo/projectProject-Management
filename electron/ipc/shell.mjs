import { shell, dialog, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { safeCall } from './safe.mjs'
import { DATA_TOOLS } from '../dataTools.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 文件内容读取 — 支持的文件类型
const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.less', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.env', '.sh', '.bat', '.py', '.java', '.cpp', '.c', '.h', '.sql', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.vue', '.svelte', '.astro'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif'])

function getTemplatesDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'templates')
  }
  return path.join(__dirname, '..', '..', 'templates')
}

export function register(ipcMain, mainWindow) {
  ipcMain.handle('shell:openFile', async (_, filePath) => {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }
    const err = await shell.openPath(filePath)
    if (err) return { success: false, error: err }
    return { success: true }
  })

  ipcMain.handle('shell:openPath', async (_, dirPath) => {
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: '路径不存在' }
    }
    const err = await shell.openPath(dirPath)
    if (err) return { success: false, error: err }
    return { success: true }
  })

  // 复制路径到剪贴板
  ipcMain.handle('shell:copyPath', async (_, targetPath) => {
    try {
      const { clipboard } = await import('electron')
      clipboard.writeText(targetPath || '')
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

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
    if (!filePath || !fs.existsSync(filePath)) {
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
      const { extractRawText } = await import('mammoth')
      const buffer = fs.readFileSync(filePath)
      const result = await extractRawText({ buffer })
      let content = result.value || ''
      const truncated = content.length > MAX_SIZE
      if (truncated) content = content.slice(0, MAX_SIZE) + '\n\n... [内容已截断，仅显示前50KB]'
      return { success: true, fileName, ext, type: 'text', content, size: stat.size, truncated }
    }

    // Excel 文件
    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = await import('xlsx')
      const workbook = XLSX.readFile(filePath)
      const parts = []
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 })
        const text = json.map(row => (Array.isArray(row) ? row.join('\t') : '')).join('\n')
        parts.push(`【工作表：${sheetName}】\n${text}`)
      }
      let content = parts.join('\n\n')
      const truncated = content.length > MAX_SIZE
      if (truncated) content = content.slice(0, MAX_SIZE) + '\n\n... [内容已截断，仅显示前50KB]'
      return { success: true, fileName, ext, type: 'text', content, size: stat.size, truncated }
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
    console.log(`[trimContext] ${modelName || 'unknown'} — dropped ${dropped}/${messages.length} messages (${total}→${keptTotal} tokens)`)
  }

  return result
}

/**
 * 数据预取 — 将项目实时数据注入为 LLM 上下文
 * 用于 ai:stream 和 ai:call 两个 handler 共享
 */
function buildDataInjectedMessages(messages, mode, projectName, dataToolIds) {
  if (!mode || !projectName || !dataToolIds?.length) return messages
  if (mode !== 'DATA_QUERY' && mode !== 'HYBRID') return messages

  const dataParts = []
  for (const toolId of dataToolIds) {
    const tool = DATA_TOOLS.find(t => t.id === toolId)
    if (!tool) continue
    try {
      const raw = tool.query(projectName)
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
      sys.content += `\n\n【当前项目实时数据】\n${dataContext}\n\n请充分利用以上数据生成准确的文档内容。所有日期/时间字段使用当前实际日期，不要自行推算。`
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
  ipcMain.handle('ai:stream', async (event, { url, apiKey, model, messages, mode, projectName, dataToolIds }) => {
    const sender = event.sender
    const requestId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    // 流式响应超时放宽到 120 秒（流式场景下首字节到达时间不可控）
    const timeout = setTimeout(() => controller.abort(), 120000)

    // 监听渲染进程主动中断
    const abortChannel = `ai:abort:${requestId}`
    ipcMain.once(abortChannel, () => controller.abort())

    // ===== 数据预取：在调 LLM 前把项目实时数据注入 prompt =====
    let finalMessages = buildDataInjectedMessages(messages, mode, projectName, dataToolIds)

    // ===== 上下文截断：防止超限报错 =====
    finalMessages = trimContext(finalMessages, model)

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages: finalMessages, stream: true, temperature: 0.7 }),
      })
      clearTimeout(timeout)

      if (!response.ok || !response.body) {
        let errorMsg = `API 请求失败 (${response.status})`
        try {
          const errData = await response.json()
          errorMsg = errData.error?.message || errData.error || errorMsg
        } catch {}
        sender.send('ai:stream:chunk', { requestId, type: 'error', error: errorMsg })
        sender.send('ai:stream:end', { requestId })
        return { success: false, error: errorMsg }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 格式按 \n\n 分割事件
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const evt of events) {
          const lines = evt.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || ''
              if (content) {
                sender.send('ai:stream:chunk', { requestId, type: 'content', content })
              }
            } catch {
              // 忽略非 JSON 行（部分 API 会发注释行）
            }
          }
        }
      }

      sender.send('ai:stream:end', { requestId })
      return { success: true, requestId }
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') {
        sender.send('ai:stream:chunk', { requestId, type: 'error', error: 'AI 请求超时（120秒）' })
      } else {
        sender.send('ai:stream:chunk', { requestId, type: 'error', error: e.message })
      }
      sender.send('ai:stream:end', { requestId })
      return { success: false, error: e.message, requestId }
    }
  })

  // 前端拉取项目实时数据（供右侧面板展示）
  ipcMain.handle('data:query', safeCall(async (_, { projectName, toolIds }) => {
    const results = {}
    if (!projectName || !toolIds?.length) return results
    for (const toolId of toolIds) {
      const tool = DATA_TOOLS.find(t => t.id === toolId)
      if (tool) {
        try {
          results[toolId] = tool.query(projectName)
        } catch (e) {
          results[toolId] = { error: e.message }
        }
      }
    }
    return results
  }))

  ipcMain.handle('ai:call', safeCall(async (_, { url, apiKey, model, messages, mode, projectName, dataToolIds }) => {
    let finalMessages = buildDataInjectedMessages(messages, mode, projectName, dataToolIds)
    finalMessages = trimContext(finalMessages, model)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages: finalMessages, stream: false, temperature: 0.7 }),
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
}
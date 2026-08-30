/** 移除模型思考段；流式未闭合的标签也不允许进入用户界面。 */
export function stripThinkingContent(text) {
  let visible = String(text || '')
    .replace(/<(think|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  const unfinished = visible.search(/<(think|analysis)\b[^>]*>/i)
  if (unfinished >= 0) visible = visible.slice(0, unfinished)
  return visible.replace(/<\/?(?:think|analysis)\b[^>]*>/gi, '').trimStart()
}

/**
 * Parse the first JSON object returned by a model. Some compatible providers
 * occasionally put literal control characters inside quoted prose. Escape
 * only those characters and retry without weakening the rest of JSON syntax.
 */
export function parseAIJsonObject(text) {
  const candidate = String(text || '').match(/\{[\s\S]*\}/)?.[0] || '{}'
  try { return JSON.parse(candidate) } catch (originalError) {
    let repaired = ''
    let inString = false
    let escaped = false
    for (const char of candidate) {
      if (!inString) {
        repaired += char
        if (char === '"') inString = true
        continue
      }
      if (escaped) {
        repaired += char
        escaped = false
        continue
      }
      if (char === '\\') {
        repaired += char
        escaped = true
        continue
      }
      if (char === '"') {
        repaired += char
        inString = false
        continue
      }
      const code = char.charCodeAt(0)
      if (code < 0x20) {
        const escapes = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' }
        repaired += escapes[char] || `\\u${code.toString(16).padStart(4, '0')}`
      } else repaired += char
    }
    try { return JSON.parse(repaired) } catch { throw originalError }
  }
}

/** 移除模型思考段；流式未闭合的标签也不允许进入用户界面。 */
export function stripThinkingContent(text) {
  let visible = String(text || '')
    .replace(/<(think|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  const unfinished = visible.search(/<(think|analysis)\b[^>]*>/i)
  if (unfinished >= 0) visible = visible.slice(0, unfinished)
  return visible.replace(/<\/?(?:think|analysis)\b[^>]*>/gi, '').trimStart()
}

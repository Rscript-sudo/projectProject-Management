/**
 * 统一的 IPC handler 包装器
 * 确保所有 handler 不会抛出未捕获异常，统一返回 { success, error } 格式
 */
export function safeCall(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args)
      if (result === null || result === undefined) {
        return { success: true, data: result }
      }
      if (typeof result === 'object') {
        if (Array.isArray(result)) {
          return { success: true, data: result }
        }
        // 只要存在 success 字段就尊重原样返回（fix：原来 'success' in result 会
        // 把 { error: 'x' } 错误地包成 success:true）
        if ('success' in result) {
          return result
        }
        return { success: true, ...result }
      }
      return { success: true, data: result }
    } catch (e) {
      console.error('[safeCall] Error:', e.message)
      return { success: false, error: e.message }
    }
  }
}

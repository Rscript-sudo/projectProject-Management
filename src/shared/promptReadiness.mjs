/**
 * 内置正文型规则要求系统/用户两侧提示词齐全；字段型模板可由系统规则 + 字段契约执行，
 * 用户侧提示会在解析时补标准模板。兼容旧版本已经保存但 userTemplate 为空的模板规则。
 */
export function hasUsablePromptConfig(defaultPrompt, override) {
  const prompt = defaultPrompt ? { ...defaultPrompt, ...(override || {}) } : override
  const hasFieldContract = Array.isArray(prompt?.fields) && prompt.fields.length > 0
  return Boolean(prompt?.systemTemplate?.trim() && (prompt?.userTemplate?.trim() || hasFieldContract))
}

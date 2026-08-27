/** 内置规则与用户覆盖合并后，系统/用户两侧提示词都非空才允许生成。 */
export function hasUsablePromptConfig(defaultPrompt, override) {
  const prompt = defaultPrompt ? { ...defaultPrompt, ...(override || {}) } : override
  return Boolean(prompt?.systemTemplate?.trim() && prompt?.userTemplate?.trim())
}

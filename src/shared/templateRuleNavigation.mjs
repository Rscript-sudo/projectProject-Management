/**
 * 从项目 AI 文档助手进入模板规则页时，始终携带可恢复的返回地址。
 * 保存规则后由 TemplateCenter 读取 returnTo，回到原项目并恢复文种、模板和输入。
 */
export function buildTemplateRuleEditorUrl({ pathname, search = '', docType, templateId = '', input = '' }) {
  const returnParams = new URLSearchParams(search)
  returnParams.set('docType', String(docType || '').trim())
  if (String(input || '').trim()) returnParams.set('input', String(input).trim())
  else returnParams.delete('input')
  if (templateId) returnParams.set('generationTemplateId', templateId)
  else returnParams.delete('generationTemplateId')

  const returnTo = `${pathname}?${returnParams.toString()}`
  const ruleParams = new URLSearchParams({ rules: String(docType || '').trim(), returnTo })
  if (templateId) ruleParams.set('templateId', templateId)
  return `/template-center?${ruleParams.toString()}`
}

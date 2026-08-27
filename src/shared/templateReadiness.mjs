export const TEMPLATE_STATUS = Object.freeze({
  READY: 'ready',
  MISSING_FILE: 'missing_file',
  PENDING_FIELDS: 'pending_fields',
  PENDING_RULES: 'pending_rules',
})

/**
 * 所有模板共用同一套就绪判定：文件 → 占位符 → AI 规则。
 * 系统通用模板的规则随应用交付，因此 readOnly 模板只需验证文件和占位符。
 */
export function getTemplateStatus(template = {}) {
  if (template.missing || !template.path) return TEMPLATE_STATUS.MISSING_FILE
  if (!Array.isArray(template.fields) || template.fields.length === 0) return TEMPLATE_STATUS.PENDING_FIELDS
  if (!template.readOnly && !template.aiRuleConfiguredAt) return TEMPLATE_STATUS.PENDING_RULES
  return TEMPLATE_STATUS.READY
}

export function isTemplateReady(template = {}) {
  return getTemplateStatus(template) === TEMPLATE_STATUS.READY
}

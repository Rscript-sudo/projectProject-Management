export const TEMPLATE_STATUS = Object.freeze({
  READY: 'ready',
  MISSING_FILE: 'missing_file',
  PENDING_FIELDS: 'pending_fields',
  PENDING_RULES: 'pending_rules',
  NEEDS_UPDATE: 'needs_update',
})

/**
 * 所有模板共用同一套就绪判定：文件 → 占位符 → AI 规则。
 * 系统通用模板的规则随应用交付，因此 readOnly 模板只需验证文件和占位符。
 */
export function getTemplateStatus(template = {}) {
  if (template.missing || !template.path) return TEMPLATE_STATUS.MISSING_FILE
  if (!Array.isArray(template.fields) || template.fields.length === 0) return TEMPLATE_STATUS.PENDING_FIELDS
  if (!template.readOnly && template.aiRuleNeedsUpdate) return TEMPLATE_STATUS.NEEDS_UPDATE
  if (!template.readOnly && !template.aiRuleConfiguredAt) return TEMPLATE_STATUS.PENDING_RULES
  return TEMPLATE_STATUS.READY
}

export function getTemplateStatusBadge(template = {}) {
  if (template.scope === 'system' || template.readOnly) return { key: 'system', label: '系统规则', color: 'blue', title: '系统已内置字段和 AI 扩写规则，可直接生成' }
  const status = getTemplateStatus(template)
  if (status === TEMPLATE_STATUS.READY) return { key: status, label: '已就绪', color: 'green', title: '字段和 AI 扩写规则均已配置，可直接生成' }
  if (status === TEMPLATE_STATUS.NEEDS_UPDATE) return { key: status, label: '需更新', color: 'red', title: '模板文件或字段已变化，需要重新检查并保存 AI 扩写规则' }
  if (status === TEMPLATE_STATUS.MISSING_FILE) return { key: status, label: '需更新', color: 'red', title: '模板文件不存在，需要重新添加模板' }
  return { key: status, label: '待配置', color: 'orange', title: status === TEMPLATE_STATUS.PENDING_FIELDS ? '尚未识别到可填写字段' : '尚未保存 AI 扩写规则' }
}

export function isTemplateReady(template = {}) {
  return getTemplateStatus(template) === TEMPLATE_STATUS.READY
}

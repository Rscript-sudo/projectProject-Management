/**
 * 删除专业后同步清理设置。
 *
 * 自定义专业从 customProjectTypes 物理移除；系统专业不可删除定义，改为写入
 * hiddenProfessionalTemplateTypes，使模板中心不再展示。
 */
export function removeProfessionalCategoryFromSettings(settings = {}, { projectType = '', projectTypeCode = '' } = {}) {
  const label = String(projectType || '').trim()
  const code = String(projectTypeCode || '').trim()
  const customProjectTypes = Array.isArray(settings.customProjectTypes) ? settings.customProjectTypes : []
  const isCustom = customProjectTypes.some(item =>
    (code && item?.code === code) || (label && item?.label === label)
  )

  if (isCustom) {
    return {
      ...settings,
      customProjectTypes: customProjectTypes.filter(item =>
        !((code && item?.code === code) || (label && item?.label === label))
      ),
      hiddenProfessionalTemplateTypes: Array.isArray(settings.hiddenProfessionalTemplateTypes)
        ? settings.hiddenProfessionalTemplateTypes
        : [],
    }
  }

  const hidden = Array.isArray(settings.hiddenProfessionalTemplateTypes)
    ? settings.hiddenProfessionalTemplateTypes
    : []
  return {
    ...settings,
    customProjectTypes,
    hiddenProfessionalTemplateTypes: code ? Array.from(new Set([...hidden, code])) : hidden,
  }
}

import { getProjectTypeProfile, normalizeProjectType } from './projectProfile.mjs'

export function isSitePackageTemplate(template = {}) {
  return template.resourceKind === 'site-package'
}

export function matchesCurrentProfessionalTemplate(template = {}, projectType = '') {
  if (template.scope !== 'professional') return true
  const targetCode = normalizeProjectType(projectType)
  if (!targetCode || targetCode === 'unclassified') return false
  return normalizeProjectType(template.projectType || template.projectTypeLabel) === targetCode
}

/**
 * AI 文档助手的模板资源分组真相源。
 * 分组按“资源用途”而非物理目录命名；空的当前项目专业库也必须显示，
 * 让用户知道专业路由已经生效以及应当去哪里补充模板。
 */
export function buildTemplateResourceGroups(templates = [], projectType = '') {
  const projectProfile = getProjectTypeProfile(projectType)
  const visible = templates.filter(item => matchesCurrentProfessionalTemplate(item, projectType))
  const documents = visible.filter(item => !isSitePackageTemplate(item))
  const packages = visible.filter(isSitePackageTemplate)
  return [
    {
      key: 'builtin',
      label: '内置通用模板',
      emptyText: '暂无可用的内置模板',
      items: documents.filter(item => item.scope === 'system'),
    },
    {
      key: 'professional',
      label: `当前项目专业模板库 · ${projectProfile.label}`,
      emptyText: `暂无${projectProfile.label}专业模板，可到模板中心上传并完成 AI 规则分析`,
      items: documents.filter(item => item.scope === 'professional'),
    },
    {
      key: 'personal',
      label: '私人模板库',
      emptyText: '暂无私人模板，可在模板中心上传或另存',
      items: documents.filter(item => item.scope === 'personal'),
    },
    {
      key: 'custom',
      label: '用户自定义模板',
      emptyText: '暂无用户自定义模板',
      items: documents.filter(item => item.scope === 'global' || item.scope === 'other'),
    },
    {
      key: 'site-package',
      label: '站点资料包',
      emptyText: '暂无站点资料包模板',
      items: packages,
    },
  ]
}


export interface TemplateResource {
  scope?: string
  projectType?: string
  projectTypeLabel?: string
  resourceKind?: 'document' | 'site-package'
}

export function isSitePackageTemplate(template?: TemplateResource): boolean
export function matchesCurrentProfessionalTemplate(template?: TemplateResource, projectType?: string): boolean
export function buildTemplateResourceGroups<T extends TemplateResource>(templates?: T[], projectType?: string): Array<{
  key: string
  label: string
  emptyText: string
  items: T[]
}>

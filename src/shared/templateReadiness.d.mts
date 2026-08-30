export const TEMPLATE_STATUS: Readonly<{
  READY: 'ready'
  MISSING_FILE: 'missing_file'
  PENDING_FIELDS: 'pending_fields'
  PENDING_RULES: 'pending_rules'
  NEEDS_UPDATE: 'needs_update'
}>

export interface TemplateReadinessInput {
  path?: string
  missing?: boolean
  fields?: string[]
  readOnly?: boolean
  aiRuleConfiguredAt?: string
  aiRuleNeedsUpdate?: boolean
  scope?: string
}

export function getTemplateStatus(template?: TemplateReadinessInput): typeof TEMPLATE_STATUS[keyof typeof TEMPLATE_STATUS]
export function isTemplateReady(template?: TemplateReadinessInput): boolean
export function getTemplateStatusBadge(template?: TemplateReadinessInput): { key: string; label: string; color: string; title: string }

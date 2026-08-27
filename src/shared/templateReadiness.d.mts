export const TEMPLATE_STATUS: Readonly<{
  READY: 'ready'
  MISSING_FILE: 'missing_file'
  PENDING_FIELDS: 'pending_fields'
  PENDING_RULES: 'pending_rules'
}>

export interface TemplateReadinessInput {
  path?: string
  missing?: boolean
  fields?: string[]
  readOnly?: boolean
  aiRuleConfiguredAt?: string
}

export function getTemplateStatus(template?: TemplateReadinessInput): typeof TEMPLATE_STATUS[keyof typeof TEMPLATE_STATUS]
export function isTemplateReady(template?: TemplateReadinessInput): boolean

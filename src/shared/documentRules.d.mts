export interface DocumentRulePack {
  id: string
  group: string
  label: string
  description: string
  default: boolean
  docTypes?: string[]
  minWords?: number
}

export interface DocumentRulesInput {
  rulePackIds?: string[]
  additionalInstruction?: string
}

export interface NormalizedDocumentRules {
  rulePackIds: string[]
  additionalInstruction: string
}

export const RULE_PACKS: DocumentRulePack[]
export const DEFAULT_RULE_PACK_IDS: string[]
export const RULE_GROUPS: string[]
export function normalizeDocumentRules(input?: DocumentRulesInput): NormalizedDocumentRules
export function getApplicableRulePacks(docType: string, rules?: DocumentRulesInput): DocumentRulePack[]
export function getDocumentRuleMinWords(docType: string, rules?: DocumentRulesInput): number
export function buildDocumentRulesInjection(docType: string, rules?: DocumentRulesInput): string

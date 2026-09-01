export type SemanticType = 'project' | 'date' | 'weather' | 'person' | 'quantity' | 'location' | 'approval' | 'narrative' | 'text'
export type ExpansionLevel = 'exact' | 'normalize' | 'summarize' | 'contextual' | 'advisory' | 'none'

export interface FieldContract {
  schemaVersion: number
  key: string
  label: string
  semanticType: SemanticType
  fillMode: string
  expansionLevel: ExpansionLevel
  sourcePriority: string[]
  dependencies: string[]
  requiredForGeneration: boolean
  requiredForDelivery: boolean
  missingPolicy: string
  source: string
  requirement: string
  minWords: number
  maxWords: number
  antiFabrication: boolean
  projectTypeConstraint: boolean
  forbiddenAssertions: string[]
}

export interface FieldPlanItem {
  field: string
  contract: FieldContract
  value: string
  source: string
  provenance: unknown
  status: 'resolved' | 'manual' | 'expand' | 'unresolved'
}

export function normalizeFieldName(value?: string): string
export function inferSemanticType(field?: string): SemanticType
export function buildFieldContract(field: string, configured?: Record<string, any>): FieldContract
export function buildFieldConfigsFromPrompt(prompt?: Record<string, any>, fields?: string[]): Record<string, any>
export function buildFactPool(input?: string, options?: { project?: Record<string, any>; autoValues?: Record<string, string>; provenance?: Record<string, unknown> }): Record<string, any>
export function buildFieldResolutionPlan(fields?: string[], options?: { fieldConfigs?: Record<string, any>; factPool?: Record<string, any> }): FieldPlanItem[]
export function formatResolutionContext(factPool: Record<string, any>, plan: FieldPlanItem[]): string
export function mergeResolvedFields(content?: string, plan?: FieldPlanItem[]): string
export function sanitizeGeneratedFieldsByPlan(content?: string, plan?: FieldPlanItem[], sourceText?: string): string
export function retainTemplateFields(content?: string, fields?: string[]): string
export function setStructuredFieldValue(content?: string, field?: string, value?: string): string
export function updateFieldPlanValue(plan?: FieldPlanItem[], field?: string, value?: string, source?: string): FieldPlanItem[]
export function getPendingFieldPlan(plan?: FieldPlanItem[]): FieldPlanItem[]

import type { SuggestedField } from '../services/aiService'

export function isPlausibleTemplateFieldName(value?: string): boolean
export function clampTemplateFieldRule<T extends Record<string, any>>(field: string, rule: T): T
export function normalizeTemplateFieldSuggestions(fields?: SuggestedField[]): SuggestedField[]
export function mergeTemplateAnalysisFields(
  existingFields?: string[],
  aiFields?: SuggestedField[],
  fallbackForField?: (field: string) => SuggestedField | null,
): Array<SuggestedField & { existing: boolean }>
export function resolveReloadedTemplateFields(scanSucceeded: boolean, scannedFields?: string[], registeredFields?: string[]): string[]
export function suggestPlaceholderNames(anchor?: string, existingFields?: string[], analyzedFields?: SuggestedField[]): string[]

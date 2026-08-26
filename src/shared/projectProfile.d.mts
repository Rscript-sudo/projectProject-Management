export type BuiltinProjectTypeCode =
  | 'information'
  | 'communication'
  | 'power'
  | 'civil'
  | 'municipal'
  | 'building'
  | 'landscape'
  | 'steel'
  | 'decoration'
  | 'unclassified'

export interface ProjectTypeProfile {
  code: string
  label: string
  aliases: string[]
  suggestedTags: string[]
  forbiddenTerms: string[]
  source?: 'builtin' | 'custom'
  hasCustomSop?: boolean
}

export interface ProjectProfileInput {
  projectType?: unknown
  projectTypeCode?: unknown
  projectTags?: unknown
  projectFeatures?: unknown
  projectPhase?: unknown
}

export interface NormalizedProjectProfile {
  projectType: string
  projectTypeCode: string
  projectTags: string[]
  projectFeatures: string
  projectPhase: string
}

export const PROJECT_TYPE_OPTIONS: ProjectTypeProfile[]
export function setCustomProjectTypes(list: unknown): { ok: boolean; added: number; rejected: unknown[] }
export function getCustomProjectTypes(): ProjectTypeProfile[]
export function getAllProjectTypes(): ProjectTypeProfile[]
export function normalizeProjectType(value: unknown): string
export function getProjectTypeProfile(value: unknown): ProjectTypeProfile
export function normalizeTags(tags: unknown): string[]
export function normalizeProjectProfile(input?: ProjectProfileInput): NormalizedProjectProfile
export function findForbiddenTerms(content: unknown, type: unknown): string[]

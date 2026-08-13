export type ProjectTypeCode =
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
  code: ProjectTypeCode
  label: string
  aliases: string[]
  suggestedTags: string[]
  forbiddenTerms: string[]
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
  projectTypeCode: ProjectTypeCode
  projectTags: string[]
  projectFeatures: string
  projectPhase: string
}

export const PROJECT_TYPE_OPTIONS: ProjectTypeProfile[]
export function normalizeProjectType(value: unknown): ProjectTypeCode
export function getProjectTypeProfile(value: unknown): ProjectTypeProfile
export function normalizeTags(tags: unknown): string[]
export function normalizeProjectProfile(input?: ProjectProfileInput): NormalizedProjectProfile
export function findForbiddenTerms(content: unknown, type: unknown): string[]

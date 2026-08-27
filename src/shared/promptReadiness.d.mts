export interface PromptReadinessInput {
  systemTemplate?: string
  userTemplate?: string
}

export function hasUsablePromptConfig(
  defaultPrompt?: PromptReadinessInput,
  override?: PromptReadinessInput | null,
): boolean

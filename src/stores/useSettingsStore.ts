// v1.x：自定义专业 + 自定义文种 + 自定义 SOP 状态管理
//
// 数据源：主进程 settings.json（customProjectTypes + customDocTypes）
// 启动时拉一次；主进程 settings 变更后会推送 settings:customTypesChanged
//
// 关键：收到推送后除了更新本 store 状态，还要把数据同步到 aiService 缓存
// （否则 aiService.ts 里的 customDocTypesCache 是空的，识别不了自定义文种）
import { create } from 'zustand'
import { setCustomProjectTypes } from '../shared/projectProfile.mjs'
import { setCustomDocTypes, setDocTypePromptsOverrides } from '../services/aiService'

export interface CustomProjectType {
  code: string
  label: string
  aliases?: string[]
  suggestedTags?: string[]
  forbiddenTerms?: string[]
  hasCustomSop?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CustomDocType {
  code: string
  label: string
  fileCode: string
  projectType?: string | null
  minWords?: number
  inStructuredWhitelist?: boolean
  hasCustomSop?: boolean
  createdAt?: string
  updatedAt?: string
}

export type DocTypeOverride = Record<string, Partial<any>>
export type GlobalRuleOverride = Record<string, Partial<any>>

interface SettingsState {
  customProjectTypes: CustomProjectType[]
  customDocTypes: CustomDocType[]
  docTypePromptOverrides: DocTypeOverride | null
  globalRulesOverrides: GlobalRuleOverride | null
  loaded: boolean

  loadCustomTypes: () => Promise<void>
  applyCustomTypes: (
    projectTypes: CustomProjectType[],
    docTypes: CustomDocType[],
    promptOverrides?: DocTypeOverride | null,
    ruleOverrides?: GlobalRuleOverride | null,
  ) => void
  uploadSop: (code: string, sopData: unknown) => Promise<{ ok: boolean; error?: string }>
  removeSop: (code: string) => Promise<{ ok: boolean; error?: string }>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  customProjectTypes: [],
  customDocTypes: [],
  docTypePromptOverrides: null,
  globalRulesOverrides: null,
  loaded: false,

  /**
   * 启动时拉一次；同时订阅主进程推送
   */
  loadCustomTypes: async () => {
    try {
      const [projects, docs, overrides] = await Promise.all([
        window.electronAPI.listCustomProjectTypes(),
        window.electronAPI.listCustomDocTypes(),
        window.electronAPI.listDocTypePromptOverrides
          ? window.electronAPI.listDocTypePromptOverrides()
          : Promise.resolve(null),
      ])
      get().applyCustomTypes(
        projects || [],
        docs || [],
        overrides?.docTypes || null,
        overrides?.globalRules || null,
      )
      set({ loaded: true })
    } catch (e) {
      console.error('[useSettingsStore] loadCustomTypes failed:', e)
      set({ loaded: true })
    }

    // 订阅主进程推送：settings 变更后主进程会主动发
    if (window.electronAPI.onCustomTypesChanged) {
      window.electronAPI.onCustomTypesChanged((data) => {
        get().applyCustomTypes(
          data?.customProjectTypes || [],
          data?.customDocTypes || [],
          data?.docTypePromptOverrides ?? null,
          data?.globalRulesOverrides ?? null,
        )
      })
    }
  },

  /**
   * 同步注入到所有运行时缓存
   * 1. projectProfile.mjs 的 setCustomProjectTypes → 主进程 normalizeProjectType 用
   * 2. aiService.ts 的 setCustomDocTypes → AI 扩写 genericPrompt 路由用
   */
  applyCustomTypes: (projectTypes, docTypes, promptOverrides, ruleOverrides) => {
    set({
      customProjectTypes: projectTypes,
      customDocTypes: docTypes,
      docTypePromptOverrides: promptOverrides ?? null,
      globalRulesOverrides: ruleOverrides ?? null,
    })
    try {
      setCustomProjectTypes(projectTypes)
    } catch (e) {
      console.error('[useSettingsStore] inject setCustomProjectTypes failed:', e)
    }
    try {
      setCustomDocTypes(docTypes.map(item => ({
        ...item,
        projectType: item.projectType ?? null,
        minWords: item.minWords ?? 600,
        inStructuredWhitelist: item.inStructuredWhitelist ?? false,
        hasCustomSop: item.hasCustomSop ?? false,
      })))
    } catch (e) {
      console.error('[useSettingsStore] inject setCustomDocTypes failed:', e)
    }
    try {
      setDocTypePromptsOverrides(promptOverrides, ruleOverrides)
    } catch (e) {
      console.error('[useSettingsStore] inject setDocTypePromptsOverrides failed:', e)
    }
  },

  uploadSop: async (code, sopData) => {
    try {
      const result = await window.electronAPI.uploadCustomSop({ code, sopData })
      if (result?.ok) {
        // 标记 hasCustomSop
        const next = get().customProjectTypes.map(p =>
          p.code === code ? { ...p, hasCustomSop: true, updatedAt: new Date().toISOString() } : p
        )
        const nextDocs = get().customDocTypes.map(d =>
          d.code === code ? { ...d, hasCustomSop: true, updatedAt: new Date().toISOString() } : d
        )
        get().applyCustomTypes(next, nextDocs)
      }
      return result
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  },

  removeSop: async (code) => {
    try {
      const result = await window.electronAPI.removeCustomSop({ code })
      if (result?.ok) {
        const next = get().customProjectTypes.map(p =>
          p.code === code ? { ...p, hasCustomSop: false, updatedAt: new Date().toISOString() } : p
        )
        const nextDocs = get().customDocTypes.map(d =>
          d.code === code ? { ...d, hasCustomSop: false, updatedAt: new Date().toISOString() } : d
        )
        get().applyCustomTypes(next, nextDocs)
      }
      return result
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  },
}))

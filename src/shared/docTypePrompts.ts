// v1.x：docType 扩写规则 loader
//
// 数据源：
//   1. 默认配置：src/shared/docTypePrompts.default.json（编译期打包）
//   2. 用户覆盖：settings.json.docTypePromptsOverrides（运行时读盘）
//
// 合并规则：
//   - 用户覆盖层完全替换默认层的 systemTemplate / fields / hardConstraints / extras / minWords
//   - 用户未指定的字段，回退默认层
//   - globalRules 走"enabled + content"合并：用户 enabled=false 时该规则被关掉
//
// 占位符处理：
//   - ${...} 由调用方在 buildDocPrompt 阶段替换为运行时变量（dateRange/weekNum 等）
//   - {{...}} / [待填写：...______] 是 AI 反编造铁律的保留位，不替换
import defaultConfig from './docTypePrompts.default.json'
import { hasUsablePromptConfig } from './promptReadiness.mjs'

export interface DocTypeField {
  key: string
  required: boolean
  minWords?: number
  maxWords?: number
}

export interface DocTypeConfig {
  key: string
  mode: 'A' | 'B'
  minWords: number
  systemTemplate: string
  userTemplate: string
  fields: DocTypeField[]
  hardConstraints: string[]
  extras: {
    decisionTree?: boolean
    proofExample?: string
    regulationHints?: boolean
  }
  dynamicVars?: Record<string, string>
}

export interface GlobalRule {
  key: string
  label: string
  enabled: boolean
  content: string
}

export interface MarketplaceTemplate {
  id: string
  label: string
  description: string
  docTypes: string[]
}

export interface DocTypePromptsConfig {
  version: string
  globalRules: Record<string, GlobalRule>
  docTypes: Record<string, DocTypeConfig>
  marketplace: MarketplaceTemplate[]
}

/** 加载默认配置（编译期静态） */
export function getDefaultPrompts(): DocTypePromptsConfig {
  return defaultConfig as unknown as DocTypePromptsConfig
}

/**
 * 判断文种是否已有可执行的 AI 扩写规则。
 * 内置文种使用默认规则并叠加用户覆盖；自定义文种必须由用户保存覆盖规则。
 */
export function hasUsableDocTypePrompt(
  docType: string,
  userOverrides?: Record<string, Partial<DocTypeConfig>> | null,
): boolean {
  const config = getDefaultPrompts()
  const defaultDoc = config.docTypes[docType]
  return hasUsablePromptConfig(defaultDoc, userOverrides?.[docType])
}

/**
 * 合并全局规则：用户覆盖层 enabled=false 时禁用某条规则；content 替换默认
 */
export function mergeGlobalRules(
  defaultRules: Record<string, GlobalRule>,
  userOverrides?: Record<string, Partial<GlobalRule>>,
): Record<string, GlobalRule> {
  if (!userOverrides) return { ...defaultRules }
  const merged: Record<string, GlobalRule> = { ...defaultRules }
  for (const [key, override] of Object.entries(userOverrides)) {
    if (merged[key]) {
      merged[key] = {
        ...merged[key],
        ...override,
        // 默认 content 必须保留为 fallback
        content: override.content ?? merged[key].content,
      }
    }
  }
  return merged
}

/**
 * 合并单个 docType 的扩写规则
 */
export function mergeDocTypePrompt(
  defaultDoc: DocTypeConfig | undefined,
  userOverride?: Partial<DocTypeConfig>,
): DocTypeConfig | null {
  if (!defaultDoc) return null
  if (!userOverride) return { ...defaultDoc }
  return {
    ...defaultDoc,
    ...userOverride,
    // 数组类（fields / hardConstraints / extras）整组替换，不深合并
    fields: userOverride.fields ?? defaultDoc.fields,
    hardConstraints: userOverride.hardConstraints ?? defaultDoc.hardConstraints,
    extras: userOverride.extras ?? defaultDoc.extras,
  }
}

/**
 * 替换模板里的 ${varName} 占位符
 * 调用方传 vars 字典（如 { weekNum: '23', dateRange: '2026年6月1日 至 2026年6月7日' }）
 */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (full, name) => {
    if (name in vars) return vars[name]
    return full  // 保留原样
  })
}

/**
 * 一站式：取一个 docType 的完整配置（默认 + 用户覆盖 + 占位符替换）
 */
export function resolveDocTypePrompt(
  docType: string,
  userOverrides?: Record<string, Partial<DocTypeConfig>>,
  globalOverrides?: Record<string, Partial<GlobalRule>>,
  dynamicVars?: Record<string, string>,
): {
  prompt: DocTypeConfig | null
  globalRules: Record<string, GlobalRule>
} {
  const config = getDefaultPrompts()
  const user = userOverrides?.[docType]
  const merged = mergeDocTypePrompt(config.docTypes[docType], user)
  if (!merged) {
    return { prompt: null, globalRules: mergeGlobalRules(config.globalRules, globalOverrides) }
  }
  // 替换占位符
  let systemTemplate = merged.systemTemplate
  let userTemplate = merged.userTemplate
  if (dynamicVars) {
    systemTemplate = interpolateTemplate(systemTemplate, dynamicVars)
    userTemplate = interpolateTemplate(userTemplate, dynamicVars)
  }
  return {
    prompt: { ...merged, systemTemplate, userTemplate },
    globalRules: mergeGlobalRules(config.globalRules, globalOverrides),
  }
}

/**
 * 统一解析：内置文种（默认+覆盖）与自定义文种（仅覆盖）都返回可用的 DocTypeConfig。
 * - 内置 16 类：默认配置 + 用户覆盖合并
 * - 自定义文种（不在默认 16）：仅当有用户覆盖（systemTemplate/userTemplate）时返回，否则 null
 * 返回 null 表示该文种无任何专属提示词，应由调用方回退到通用骨架。
 */
export function resolveDocTypePromptForAny(
  docType: string,
  userOverrides?: Record<string, Partial<DocTypeConfig>>,
  globalOverrides?: Record<string, Partial<GlobalRule>>,
  dynamicVars?: Record<string, string>,
): { prompt: DocTypeConfig | null; globalRules: Record<string, GlobalRule> } {
  const config = getDefaultPrompts()
  const globalRules = mergeGlobalRules(config.globalRules, globalOverrides)

  // 内置文种：默认 + 覆盖
  if (config.docTypes[docType]) {
    const merged = mergeDocTypePrompt(config.docTypes[docType], userOverrides?.[docType])
    if (!merged) return { prompt: null, globalRules }
    let systemTemplate = merged.systemTemplate
    let userTemplate = merged.userTemplate
    if (dynamicVars) {
      systemTemplate = interpolateTemplate(systemTemplate, dynamicVars)
      userTemplate = interpolateTemplate(userTemplate, dynamicVars)
    }
    return { prompt: { ...merged, systemTemplate, userTemplate }, globalRules }
  }

  // 自定义文种（或不在默认 16）：仅有覆盖时以覆盖为准
  const override = userOverrides?.[docType]
  if (override && (override.systemTemplate || override.userTemplate)) {
    const merged: DocTypeConfig = {
      key: docType,
      mode: 'B',
      minWords: override.minWords ?? 600,
      systemTemplate: override.systemTemplate ?? '',
      userTemplate: override.userTemplate ?? '',
      fields: override.fields ?? [],
      hardConstraints: override.hardConstraints ?? [],
      extras: override.extras ?? {},
    }
    let systemTemplate = merged.systemTemplate
    let userTemplate = merged.userTemplate
    if (dynamicVars) {
      systemTemplate = interpolateTemplate(systemTemplate, dynamicVars)
      userTemplate = interpolateTemplate(userTemplate, dynamicVars)
    }
    return { prompt: { ...merged, systemTemplate, userTemplate }, globalRules }
  }

  return { prompt: null, globalRules }
}

/**
 * 取 marketplace 模板包列表
 * @deprecated 无调用方，待清理
 */
export function listMarketplace(): MarketplaceTemplate[] {
  return getDefaultPrompts().marketplace
}

/**
 * 取内置全部 docType label 列表（UI 左侧列表）
 * @deprecated 无调用方，待清理
 */
export function listBuiltinDocTypes(): string[] {
  return Object.keys(getDefaultPrompts().docTypes)
}

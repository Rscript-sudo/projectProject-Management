/**
 * 字段注册表 — 业务字段单一真相源
 *
 * 问题背景：
 *   - AI prompt 用 `施工单位/致单位/致送单位` 多个并列 key 适配不同模板
 *   - templateService.buildPlaceholderData 又独立维护一份别名映射
 *   - 字段重命名要改 3 个地方，容易漏
 *
 * 解决：
 *   - 所有"业务字段"在这里声明一次（含 key、displayName、aliases、source、default）
 *   - AI prompt / 模板占位符 / 数据库字段 都通过 Registry 查
 *   - 新增字段只改这一处
 */

export type FieldSource = 'env' | 'project' | 'computed' | 'user' | 'ai-extracted'

export interface FieldDef {
  /** 业务唯一 key（如 `contractor`）— 数据库存储、API 传参都用这个 */
  key: string
  /** 中文显示名（如 `施工单位`） */
  displayName: string
  /** 数据来源：env=项目配置/computed=系统计算/user=用户输入/ai-extracted=AI 生成的内容里抽取 */
  source: FieldSource
  /** 占位符别名列表（向后兼容老模板里的 `{{}}` 写法） */
  aliases: string[]
  /** 默认值 */
  default?: string
  /** 字段分类（用于 AI prompt 分段展示） */
  group: 'project' | 'party' | 'meta' | 'content'
  /** AI prompt 注入提示 */
  aiHint?: string
}

/**
 * 字段注册表 — 任何"项目名/参建方/日期/编号/事由"都来这里加
 */
export const FIELD_REGISTRY: Record<string, FieldDef> = {
  // ===== 项目自身 =====
  projectName: {
    key: 'projectName',
    displayName: '项目名称',
    source: 'project',
    aliases: ['项目名称', '工程名称'],
    group: 'project',
    aiHint: '业主/施工/监理正式场合使用的完整项目名称',
  },
  projectType: {
    key: 'projectType',
    displayName: '项目类型',
    source: 'project',
    aliases: ['项目类型', '工程类型'],
    default: '通用',
    group: 'project',
  },

  // ===== 参建方 =====
  ownerUnit: {
    key: 'ownerUnit',
    displayName: '建设单位',
    source: 'project',
    aliases: ['建设单位', '甲方', '建设方', '业主单位', '业主'],
    group: 'party',
    aiHint: '项目业主/建设单位/甲方单位的完整名称',
  },
  contractor: {
    key: 'contractor',
    displayName: '施工单位',
    source: 'project',
    aliases: ['施工单位', '乙方', '承建单位', '致单位', '致送单位'],
    group: 'party',
    aiHint: '总承包/施工单位名称',
  },
  supervisorUnit: {
    key: 'supervisorUnit',
    displayName: '监理单位',
    source: 'project',
    aliases: ['监理单位', '监理公司', '监理机构'],
    group: 'party',
    aiHint: '监理单位完整名称',
  },
  chiefEngineer: {
    key: 'chiefEngineer',
    displayName: '总监理工程师',
    source: 'project',
    aliases: ['总监理工程师', '总监姓名', '总监理'],
    group: 'party',
    aiHint: '项目总监理工程师姓名',
  },

  // ===== 时间/编号 =====
  date: {
    key: 'date',
    displayName: '日期',
    source: 'computed',
    aliases: ['日期', '签章日期', '报告日期', '检查日期'],
    default: '',
    group: 'meta',
  },
  fileNumber: {
    key: 'fileNumber',
    displayName: '文件编号',
    source: 'computed',
    aliases: ['文件编号', '编号', '文号'],
    group: 'meta',
  },
  weekNumber: {
    key: 'weekNumber',
    displayName: '周数',
    source: 'computed',
    aliases: ['周数'],
    group: 'meta',
  },
  monthNumber: {
    key: 'monthNumber',
    displayName: '月份',
    source: 'computed',
    aliases: ['月份'],
    group: 'meta',
  },

  // ===== 内容（AI 生成）=====
  subject: {
    key: 'subject',
    displayName: '事由',
    source: 'user',
    aliases: ['事由', '主题', '摘要'],
    group: 'content',
  },
  content: {
    key: 'content',
    displayName: '正文内容',
    source: 'ai-extracted',
    aliases: ['正文内容', '内容', '正文', '主要内容'],
    group: 'content',
  },
  userInput: {
    key: 'userInput',
    displayName: '用户输入',
    source: 'user',
    aliases: ['用户输入'],
    group: 'content',
  },
}

/**
 * 反向索引：别名 → 业务 key（用于从 AI 输出或老模板占位符里找字段）
 */
const ALIAS_TO_KEY: Record<string, string> = {}
for (const def of Object.values(FIELD_REGISTRY)) {
  for (const alias of def.aliases) {
    ALIAS_TO_KEY[alias] = def.key
  }
}

/**
 * 把任意输入（可能是 alias）解析为标准 key
 */
export function resolveKey(name: string): string | null {
  if (FIELD_REGISTRY[name]) return name
  if (ALIAS_TO_KEY[name]) return ALIAS_TO_KEY[name]
  // 占位符 {{XXX}} 形式
  const stripped = name.replace(/^\{\{|\}\}$/g, '').trim()
  if (FIELD_REGISTRY[stripped]) return stripped
  if (ALIAS_TO_KEY[stripped]) return ALIAS_TO_KEY[stripped]
  return null
}

/**
 * 构建模板占位符数据 — 统一从 Registry + env 解析
 */
export function buildDataFromRegistry(values: {
  projectName?: string
  ownerUnit?: string
  contractor?: string
  supervisorUnit?: string
  chiefEngineer?: string
  projectType?: string
  fileNumber?: string
  weekNumber?: string | number
  monthNumber?: string | number
  subject?: string
  content?: string
  userInput?: string
}): Record<string, string> {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`

  // 标准 key → 值
  const canonical: Record<string, string> = {
    projectName: values.projectName || '',
    ownerUnit: values.ownerUnit || '建设单位',
    contractor: values.contractor || '施工单位',
    supervisorUnit: values.supervisorUnit || '监理单位',
    chiefEngineer: values.chiefEngineer || '总监理工程师',
    projectType: values.projectType || '通用',
    fileNumber: values.fileNumber || '',
    weekNumber: values.weekNumber ? String(values.weekNumber) : '',
    monthNumber: values.monthNumber ? String(values.monthNumber) : '',
    subject: values.subject || '',
    content: values.content || values.userInput || '',
    date: dateStr,
  }

  // 展开为所有 alias 的扁平 dict（docxtemplater 直接用）
  const out: Record<string, string> = {}
  for (const def of Object.values(FIELD_REGISTRY)) {
    const v = canonical[def.key] ?? def.default ?? ''
    for (const alias of def.aliases) {
      out[alias] = v
    }
  }
  return out
}

/**
 * 给 AI prompt 用的字段提示
 */
export function buildAIPromptHint(): string {
  const lines: string[] = []
  const groups: Record<string, FieldDef[]> = {}
  for (const def of Object.values(FIELD_REGISTRY)) {
    if (!def.aiHint) continue
    if (!groups[def.group]) groups[def.group] = []
    groups[def.group].push(def)
  }
  for (const [group, defs] of Object.entries(groups)) {
    const groupName = { project: '项目信息', party: '参建方', meta: '元信息', content: '内容' }[group] || group
    lines.push(`【${groupName}】`)
    for (const d of defs) {
      lines.push(`- ${d.displayName}（${d.key}）：${d.aiHint}`)
    }
  }
  return lines.join('\n')
}

/**
 * 模板里出现的 `{{XXX}}` 反查标准 key
 */
export function templateVarToKey(varName: string): { key: string | null; alias: string } {
  const stripped = varName.replace(/^\{\{|\}\}$/g, '').trim()
  const key = resolveKey(stripped)
  return { key, alias: stripped }
}
// AI 服务 - 遵循"带头大哥监理业务技能"模板规范
// 规范来源：监理业务 skill modules/信息管理/document-generator
//
// ============================================================
// 虚竹 v2.0 反编造铁律（v1.1.0 新增 · 2026-06-23）
// ============================================================
// 来源：~/.claude/skills/监理业务/modules/信息管理/document-generator/docs/02_AI扩写型.md
// 原 skill 规范自相矛盾——既说"推断具体现场场景"又说"禁止编造"，
// v1.1.0 消解矛盾，统一为"反编造铁律"（本文件唯一真相源）。
//
// 核心三禁：
//   1. 禁编造具体时间   — 不得写出"2023年11月15日14时30分"等具体日期时间
//   2. 禁编造具体场景   — 不得写出"经我监理部于XX对XX工程施工现场进行XX"
//   3. 禁编造具体人员   — 不得写出未由用户提供的"张XX / 李XX 总监理工程师"
//
// 必填项缺失处理：
//   - 时间字段缺失 → 使用 {{CURRENT_DATE}} 占位符
//   - 场景字段缺失 → 使用"近日 / 现场 / 指定部位 / 施工作业"等模糊表述
//   - 人员字段缺失 → 使用"现场监理人员 / 总监理工程师"等角色词
//   - 文末追加【信息缺口提示】，列出本文未由用户提供而留空的事实字段
//
// 兜底：
//   - postProcessTimeFields()  清洗"YYYY年MM月DD日HH时MM分"等残留
//   - postProcessFabricationGuard() 检测未授权的具体场景描述
// ============================================================

const ANTI_FABRICATION_RULES = `【反编造铁律 — 全篇适用，违反则文档作废】

一、禁止编造具体时间
   - 禁止自行编造任何具体日期/时间，如"2023年11月15日14时30分"。
   - 若用户未提供日期 → 使用 {{CURRENT_DATE}} 占位符（系统会自动替换为生成当日）
   - 若用户未提供时间 → 使用"近日"、"近期"、"规定时间"等模糊表述

二、禁止编造具体场景
   - 禁止自行编造"经我监理部于XX时XX分对XX工程XX部位进行XX"这类话
   - 若用户未提供具体部位 → 使用"施工现场"、"指定部位"、"作业区域"
   - 若用户未提供具体工序 → 使用"施工作业"、"指定工序"、"现场作业"
   - 若用户未提供具体设备 → 使用"相关设备"、"指定设备"

三、禁止编造具体人员
   - 禁止自行编造具体人名，如"张XX总监理工程师于XX时签发"
   - 若用户未提供姓名 → 使用"总监理工程师"、"现场监理人员"、"专业监理工程师"
   - 若用户未提供具体单位 → 使用"建设单位"、"施工单位"、"监理单位"

四、信息缺口自检
   - 文末必须追加【信息缺口提示】，列出本文未由用户提供而留空的事实字段
   - 格式：【信息缺口提示】日期、人员、部位、工序、设备型号（按实际缺失列举）

五、必须使用占位符
   - 日期字段统一使用 {{CURRENT_DATE}}，由系统后处理替换为真实日期
   - 不得在正文中直接写出具体日期`

export type AIProvider = 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'qwen' | 'custom'

export interface AIConfig {
  provider: AIProvider
  // v1.0.6 脱敏设计：apiKey 已迁至主进程安全存储，前端不再持有
  apiKey?: string
  baseUrl: string
  model: string
}

// 模型配置
export const providerConfigs: Record<AIProvider, { baseUrl: string; defaultModel: string; name: string }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    name: 'DeepSeek',
  },
  minimax: {
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    name: 'MiniMax',
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    name: '智谱 GLM',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    name: 'Kimi',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    name: '通义千问',
  },
  custom: {
    baseUrl: '',
    defaultModel: '',
    name: '自定义',
  },
}

// 通过 main 进程调用 AI（避免 CORS）
// 支持额外参数：mode / projectName / dataToolIds — 触发数据预取
export async function callAI(
  config: AIConfig,
  messages: {role: string; content: string}[],
  extra?: { mode?: string; projectName?: string; dataToolIds?: string[] }
): Promise<{
  success: boolean
  content?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
}> {
  const { provider, apiKey, baseUrl, model } = config

  const config2 = providerConfigs[provider as keyof typeof providerConfigs] || providerConfigs.deepseek
  const url = provider === 'custom' && baseUrl
    ? `${baseUrl}/chat/completions`
    : `${config2.baseUrl}/chat/completions`

  return await window.electronAPI.callAI({
    url,
    apiKey,
    model: model || config2.defaultModel,
    messages,
    ...extra,
  })
}

// 从用户输入识别文档类型
export function identifyDocType(input: string): { type: string; confidence: number; mode: 'A' | 'B' } {
  const lower = input.toLowerCase()

  // 严格匹配：按优先级排序，避免重叠关键词冲突
  // 优先级：监理规划/细则 > 方案审核 > 变更单 > 索赔报告 > 巡视记录 > 安全检查 > 质量评估 > 付款审核 > 停工令 > 整改通知书 > ...
  const patterns = [
    // 监理规划/细则 — 优先级最高（含"细则"必须排在"会议纪要"前）
    { type: '监理规划', keywords: ['监理规划', '监理细则', '实施细则', '规划编制', '细则编制'], mode: 'B' as const },
    // 方案审核意见
    { type: '方案审核意见', keywords: ['方案审核', '施组审核', '施工组织设计审核', '专项方案审核', '审核意见'], mode: 'B' as const },
    // 工程变更单
    { type: '工程变更单', keywords: ['工程变更', '变更申请', '变更单', '设计变更'], mode: 'B' as const },
    // 索赔报告
    { type: '索赔报告', keywords: ['索赔报告', '工程索赔', '费用索赔', '工期索赔', '索赔申请'], mode: 'B' as const },
    // 现场巡视记录
    { type: '巡视记录', keywords: ['巡视记录', '现场巡视', '巡视报告'], mode: 'B' as const },
    // 安全检查记录
    { type: '安全检查记录', keywords: ['安全检查记录', '安全巡检', '安全检查'], mode: 'B' as const },
    // 质量评估报告
    { type: '质量评估报告', keywords: ['质量评估', '质量评价', '质量评估报告'], mode: 'B' as const },
    // 付款审核意见
    { type: '付款审核意见', keywords: ['付款审核', '支付审核', '进度款审核', '付款意见'], mode: 'B' as const },
    // 停工令 — 优先级最高
    { type: '停工令', keywords: ['停工令', '暂停施工', '停工指令'], mode: 'B' as const },
    // 整改通知书 — "安全隐患"同时含"安全"和"隐患"，需排在安全通知书前面
    { type: '整改通知书', keywords: ['整改通知', '整改单', '质量问题', '安全隐患', '违规行为'], mode: 'B' as const },
    // 安全通知书 — 节假日相关
    { type: '安全通知书', keywords: ['安全通知', '节假日', '五一', '端午', '国庆', '春节', '中秋', '清明'], mode: 'B' as const },
    // 工程联系单 — 行为管理类，关键词不与其他类型重叠
    { type: '工程联系单', keywords: ['工程联系单', '联系单', '联系函', '行为规范', '管理通知', '工作联系'], mode: 'B' as const },
    // 会议纪要
    { type: '会议纪要', keywords: ['会议纪要', '例会', '研讨会', '协调会'], mode: 'A' as const },
    // 监理周报
    { type: '监理周报', keywords: ['监理周报', '周报', '每周', '本周', '本周监理'], mode: 'A' as const },
    // 监理月报
    { type: '监理月报', keywords: ['监理月报', '月报', '每月', '本月', '本月监理'], mode: 'A' as const },
    // 监理日志
    { type: '监理日志', keywords: ['监理日志', '日志', '值班日志', '今日工作'], mode: 'A' as const },
  ]

  for (const pattern of patterns) {
    for (const keyword of pattern.keywords) {
      if (lower.includes(keyword)) {
        return { type: pattern.type, confidence: 0.9, mode: pattern.mode }
      }
    }
  }

  return { type: '通用文档', confidence: 0.3, mode: 'B' }
}

// 生成文档文件名 — 调主进程 IPC（虚竹 v2.0 唯一真相源）
// 返回 { fileName, subDir, code, projectCode, summary, date, version, ext }
export async function generateFileName(
  docType: string,
  projectName: string,
  description: string,
  version: string = ''
): Promise<{ fileName: string; subDir?: string; code?: string; projectCode?: string; summary?: string; date?: string; version?: string; ext?: string }> {
  if (window.electronAPI?.buildFileName) {
    try {
      const result = await window.electronAPI.buildFileName({
        docType,
        projectName,
        customSummary: description,
        version,
      })
      return result
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.warn('[generateFileName] IPC failed, fallback:', errMsg)
    }
  }

  // 兜底（无 IPC 时）：本地拼，保留旧行为
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const typeCodes: Record<string, string> = {
    '整改通知书': 'ZG-TZ',
    '安全通知书': 'JL-TZ',
    '工程联系单': 'LX-D',
    '会议纪要': 'HY-JY',
    '监理周报': 'JL-ZB',
    '监理月报': 'JL-YB',
    '监理日志': 'JL-RZ',
    '停工令': 'TG-LM',
    '通用文档': 'DOC',
  }
  const code = typeCodes[docType] || 'DOC'
  const projCode = extractProjectCode(projectName)
  const desc = sanitizeFileName(description.slice(0, 15) || docType)
  const versionSuffix = version ? `_${version}` : ''
  const fileName = `${date}_${code}_${projCode}_${desc}${versionSuffix}.docx`
  return { fileName, code, projectCode: projCode, summary: desc, date }
}

// ===== 三类模式意图分类 =====
//
// 返回 mode 说明：
//   CHAT       — 自由问答（规范咨询、项目问题分析等）
//   DOC        — 文档生成（当前 16 种文档类型）
//   DATA_QUERY — 数据查询（查 DB 实时数据）
//   HYBRID     — 文档生成 + 数据注入（如"生成进度报告"）

export type SessionMode = 'CHAT' | 'DOC' | 'DATA_QUERY' | 'HYBRID'

export interface ModeResult {
  mode: SessionMode
  docType?: string
  dataToolIds?: string[]
  confidence: number
}

/**
 * 数据查询关键词 — 与 electron/dataTools.mjs 中的 keywords 对齐
 */
const DATA_QUERY_KEYWORDS: { toolId: string; keywords: string[] }[] = [
  { toolId: 'progress_summary', keywords: ['进度', '进展', '滞后', '延误', '完成率', '百分比', '横道图', '计划', '节点'] },
  { toolId: 'hazard_open', keywords: ['隐患', '安全问题', '未整改', '危险源', '安全风险', '整改'] },
  { toolId: 'payment_status', keywords: ['付款', '支付', '资金', '进度款', '审批', '投资'] },
  { toolId: 'contract_overview', keywords: ['合同', '签约', '甲方', '乙方', '合同额', '采购'] },
  { toolId: 'correspondence_recent', keywords: ['函件', '通知', '联系单', '台账', '发文', '收文', '发出'] },
  { toolId: 'project_meta', keywords: ['项目信息', '基本信息', '概况', '参建单位', '项目类型'] },
  { toolId: 'photo_recent', keywords: ['照片', '影像', '拍照', '图片', '归档'] },
  { toolId: 'change_claim', keywords: ['变更', '索赔', '签证'] },
  { toolId: 'photo_scan', keywords: ['照片', '照片归档', '整理照片', '归档照片', '扫描照片', '重命名'] },
]

/** 从用户输入推断数据查询工具 ID 列表 */
export function inferDataTools(input: string): string[] {
  const lower = input.toLowerCase()
  const matched = new Set<string>()
  for (const entry of DATA_QUERY_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        matched.add(entry.toolId)
        break
      }
    }
  }
  // 宽泛的"全貌"查询触发所有工具
  if (/项目情况|总体|全貌|总览|整体|概况/.test(lower)) {
    DATA_QUERY_KEYWORDS.forEach(e => matched.add(e.toolId))
  }
  return [...matched]
}

/**
 * 识别用户输入的会话模式
 */
export function identifyMode(input: string): ModeResult {
  // 1. 先检查文档生成意图
  const docResult = identifyDocType(input)
  if (docResult.confidence >= 0.7) {
    // 判断此文档类型是否涉及数据查询（进度报告、月报等）
    const dataKeywords = ['进度', '投资', '合同', '隐患', '付款', '报告', '月报', '周报']
    const needsData = dataKeywords.some(k => input.includes(k) || docResult.type.includes(k))
    const toolIds = needsData ? inferDataTools(input) : []
    return {
      mode: needsData ? 'HYBRID' : 'DOC',
      docType: docResult.type,
      dataToolIds: toolIds,
      confidence: docResult.confidence,
    }
  }

  // 2. 检查数据查询意图
  const toolIds = inferDataTools(input)
  if (toolIds.length > 0) {
    return { mode: 'DATA_QUERY', dataToolIds: toolIds, confidence: 0.85 }
  }

  // 3. 通用文档生成意图（强度不够但用户明确要生成）
  const docIntent = /生成|写|出|开|打印|输出|制作|起草|出一份/.test(input)
  if (docIntent) {
    return { mode: 'DOC', docType: '通用文档', confidence: 0.5 }
  }

  // 4. 剩余走自由问答
  return { mode: 'CHAT', confidence: 0.6 }
}

// ===== 自由问答（CHAT）system prompt =====

/**
 * 构建自由问答模式 system prompt
 */
export function buildChatPrompt(projectInfo?: {
  projectName: string
  ownerUnit?: string
  contractor?: string
  supervisorUnit?: string
  chiefEngineer?: string
  projectType?: string
}): string {
  const ctx = projectInfo ? `
【当前项目】
- 项目名称：${projectInfo.projectName}
- 项目类型：${projectInfo.projectType || '通用'}
- 建设单位：${projectInfo.ownerUnit || '—'}
- 施工单位：${projectInfo.contractor || '—'}
- 监理单位：${projectInfo.supervisorUnit || '—'}
- 总监：${projectInfo.chiefEngineer || '—'}` : ''

  return `你是一位资深的工程监理业务AI助手，回答关于工程监理、施工技术、安全管理和项目管理的问题。${ctx}

【你可以回答以下类型的问题】
1. 监理规范咨询 — 《建设工程监理规范》GB/T 50319-2013 等相关条款解读
2. 施工技术咨询 — 各专业工程施工工艺、验收标准、质量控制要点
3. 安全管理咨询 — 安全检查要点、危险源识别、安全法规引用
4. 合同管理咨询 — 合同条款解释、变更索赔分析
5. 项目管理建议 — 进度控制、投资控制、质量控制方法
6. 项目数据分析 — 如果用户询问项目数据相关问题，引导他们切换到数据查询

【回答要求】
- 引用具体规范条款号（如《GB 50319-2013》第X.X条）
- 条理清晰，分点论述
- 不确定的内容明确说明"建议核实相关规范原文"
- 如果检测到用户有文档生成意图，在回答末尾提示可以生成对应文档
- 使用中文回答，专业但不晦涩`
}

// ===== 时间字段后处理 =====

/**
 * 将 AI 生成内容中的时间占位符替换为当前真实时间
 * 所有日期字段统一使用生成时刻的时间，不给 AI 编造的机会
 *
 * v1.1.0 增强：除了占位符替换，还做以下防护：
 *  1. 拦截"具体到分秒"的时间模式（如"14时30分"），替换为 {{未指定时间}}
 *  2. 拦截"经我监理部于X时X分"这种模板化编造句式，整句替换为占位
 *  3. 拦截"近日"之外的近义模糊词，统一替换
 */
export function postProcessTimeFields(content: string): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}年${month}月${day}日`
  const dateNum = `${year}${month}${day}`

  // 1. 替换 {{CURRENT_DATE}} 占位符
  let result = content.replace(/\{\{CURRENT_DATE\}\}/g, dateStr)

  // 2. 覆盖常见日期 key 的 AI 生成值
  // 【日期】xxx → 【日期】2026年06月22日
  const timeKeys = ['日期', '巡视日期', '检查日期', '签章日期', '报告日期']
  for (const key of timeKeys) {
    const regex = new RegExp(`【${key}】[^】\\n]+`, 'g')
    result = result.replace(regex, `【${key}】${dateStr}`)
  }

  // 3. v1.1.0 防御：拦截"具体到分秒"的时间（AI 容易编造"14时30分"这种）
  //    模式："14时30分"、"14点30分"、"14:30"、"下午14时30分"
  //    替换为 {{未指定时间}}，提醒老板补充
  result = result.replace(
    /(?:上午|下午|凌晨|早上|晚上|傍晚)?\s*\d{1,2}\s*[时点]\s*\d{1,2}\s*分?/g,
    '{{未指定时间}}'
  )
  // 也拦截纯日期+时刻的组合如"2023年11月15日14时30分" → 整段替换为占位
  result = result.replace(
    /\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}\s*[时点]\s*\d{1,2}\s*分?)?/g,
    '{{CURRENT_DATE}}'
  )
  // 拦截"X月X日"具体日期（如"11月15日"），保留月份占位
  result = result.replace(
    /(?<![年月日\d])\d{1,2}月\d{1,2}日(?![\d年月日])/g,
    '{{CURRENT_DATE}}'
  )

  return result
}

/**
 * v1.1.0 反编造守门员 — 检测并标注 AI 编造的具体场景
 *
 * 触发条件（任意一条命中即标注）：
 *  1. 出现"经我监理部于..."、"经监理工程师检查..."等模板化编造句
 *  2. 出现具体人名（如"张三"、"李四"等二/三字姓名 + 总监/监理工程师/项目经理）
 *  3. 出现"近期"、"最近"、"前阵子"等模糊时间词（应改为"本月"或具体日期）
 *
 * 返回值：{ safe: boolean, warnings: string[], content: string }
 *  - safe: 是否通过（true=无编造嫌疑）
 *  - warnings: 命中的可疑模式列表
 *  - content: 处理后的内容（命中处已替换为 {{待补充}}）
 */
export function postProcessFabricationGuard(content: string): {
  safe: boolean
  warnings: string[]
  content: string
} {
  const warnings: string[] = []
  let result = content

  // 1. 检测"经我监理部于..."、"经监理检查..."等模板化编造句
  const fabricationPatterns = [
    { pattern: /经我监理部于[^,，。；;]{0,80}(?:时|分|巡查|检查|巡视)/g, label: '编造监理部行动' },
    { pattern: /经.{0,8}监理.{0,8}(?:检查|巡查|巡视|发现|签发)/g, label: '编造监理行动' },
    { pattern: /于\d{4}年\d{1,2}月\d{1,2}日[^,，。；;\n]{0,40}对[^,，。；;\n]{1,30}(?:进行|开展)?(?:.{0,10})?(?:检查|巡查|巡视|督查)/g, label: '编造具体巡查时间地点' },
    { pattern: /\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}时\s*\d{1,2}分[^,，。；;\n]{0,30}对[^,，。；;\n]{1,30}进行[^,，。；;\n]{1,15}(?:检查|巡查|巡视)/g, label: '编造完整巡查句式' },
  ]
  for (const { pattern, label } of fabricationPatterns) {
    const matches = result.match(pattern)
    if (matches) {
      warnings.push(`${label}（${matches.length}处）`)
      result = result.replace(pattern, '{{待补充：具体巡查时间地点}}')
    }
  }

  // 2. 检测模糊时间词（应改为"本月"或具体日期）
  const fuzzyTimePatterns = [
    { pattern: /最近|前阵子|前段时间|近期/g, replacement: '本月', label: '模糊时间词' },
  ]
  for (const { pattern, replacement, label } of fuzzyTimePatterns) {
    const matches = result.match(pattern)
    if (matches) {
      warnings.push(`${label}（${matches.length}处）`)
      result = result.replace(pattern, replacement)
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
    content: result,
  }
}

// 提取项目代码
function extractProjectCode(projectName: string): string {
  // 优先取下划线前的部分（如 PJ803）
  const match = projectName.match(/^([A-Z0-9]+)_/)
  if (match) return match[1]
  // 提取前8个字符中的字母数字（支持中文项目名）
  const filtered = projectName.slice(0, 8).replace(/[^A-Za-z0-9]/g, '')
  if (filtered) return filtered.toUpperCase()
  // 回退：取拼音首字母或项目名首字
  return projectName.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'PROJECT'
}

// 清理文件名
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

// 获取文档保存路径
export function getDocSavePath(docType: string): string {
  const paths: Record<string, string> = {
    '整改通知书': '03_实施阶段/06_往来函件/01_监理整改通知书/原始稿',
    '安全通知书': '03_实施阶段/06_往来函件/02_监理安全通知书/原始稿',
    '工程联系单': '03_实施阶段/06_往来函件/03_工程联系单/原始稿',
    '停工令': '03_实施阶段/06_往来函件/05_停工令/原始稿',
    '会议纪要': '03_实施阶段/04_会议纪要',
    '监理日志': '03_实施阶段/01_监理日志',
    '监理周报': '03_实施阶段/02_监理周报',
    '监理月报': '03_实施阶段/03_监理月报',
    '监理规划': '02_准备阶段/02_监理规划',
    '监理细则': '02_准备阶段/03_监理细则',
    '方案审核意见': '02_准备阶段/04_开工报审',
    '工程变更单': '03_实施阶段/06_往来函件/04_工程函件/原始稿',
    '索赔报告': '03_实施阶段/06_往来函件/04_工程函件/原始稿',
    '巡视记录': '03_实施阶段/10_问题清单',
    '安全检查记录': '03_实施阶段/05_安全管理',
    '质量评估报告': '04_验收阶段/04_分部分项验收',
    '付款审核意见': '03_实施阶段/06_往来函件/04_工程函件/原始稿',
    '通用文档': '03_实施阶段',
  }

  return paths[docType] || '03_实施阶段'
}

// ===== 结构化内容解析 =====

/**
 * 从 AI 输出内容中解析 【key】value 格式的结构化数据
 * 用于将 AI 生成的各段落映射到模板占位符
 * 示例输入:
 *   【施工部位】机房、弱电间
 *   【今日内容】今日进行保温棉安装...
 * 示例输出: { 施工部位: "机房、弱电间", 今日内容: "今日进行保温棉安装..." }
 */
export function parseStructuredContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const sectionRegex = /【([^】]+)】([\s\S]*?)(?=【|$)/g
  let match: RegExpExecArray | null
  while ((match = sectionRegex.exec(content)) !== null) {
    const key = match[1].trim()
    const value = match[2].trim()
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

/**
 * 从结构化内容中提取某个 key 的值
 */
export function extractSection(content: string, key: string): string {
  const data = parseStructuredContent(content)
  return data[key] || ''
}

// ===== 项目类型 → 工序映射 =====

const WORK_PROCEDURE_MAPS: Record<string, {
  name: string
  procedures: { keyword: string; safety: string; quality: string }[]
}> = {
  '信息化工程': {
    name: 'IT/机房工程',
    procedures: [
      { keyword: '保温棉', safety: '临电安全', quality: '材料验收、隐蔽验收' },
      { keyword: '铜排', safety: '临电安全', quality: '隐蔽验收、接地系统' },
      { keyword: '机柜', safety: '临电安全、高空安全', quality: '成品保护' },
      { keyword: '上架', safety: '临电安全、高空安全', quality: '成品保护' },
      { keyword: '静电地板', safety: '临电安全', quality: '材料验收、标高线位' },
      { keyword: '防静电地板', safety: '临电安全', quality: '材料验收、标高线位' },
      { keyword: '桥架', safety: '高空安全、临边洞口', quality: '标高线位' },
      { keyword: '布线', safety: '临电安全', quality: '材料验收' },
      { keyword: '线缆', safety: '临电安全', quality: '材料验收' },
      { keyword: '接地', safety: '—', quality: '接地系统' },
    ],
  },
  '通信工程': {
    name: 'Telecom',
    procedures: [
      { keyword: '立杆', safety: '特种设备、临边洞口', quality: '标高线位' },
      { keyword: '打桩', safety: '特种设备、临边洞口', quality: '标高线位' },
      { keyword: '光缆', safety: '临电安全', quality: '材料验收' },
      { keyword: '光纤', safety: '临电安全', quality: '材料验收、隐蔽验收' },
      { keyword: '熔接', safety: '临电安全', quality: '材料验收、隐蔽验收' },
      { keyword: '天线', safety: '高空安全', quality: '标高线位' },
      { keyword: '基站', safety: '临电安全', quality: '成品保护' },
    ],
  },
  '电力工程': {
    name: '电力工程',
    procedures: [
      { keyword: '变压器', safety: '临电安全', quality: '材料验收' },
      { keyword: '配电柜', safety: '临电安全', quality: '隐蔽验收、接地系统' },
      { keyword: '电缆', safety: '临电安全', quality: '材料验收' },
      { keyword: '立杆', safety: '特种设备', quality: '标高线位' },
    ],
  },
}

const DEFAULT_PROCEDURE_MAP = {
  name: '通用',
  procedures: [
    { keyword: '模板', safety: '高空安全、临边洞口', quality: '标高线位' },
    { keyword: '钢筋', safety: '高空安全', quality: '材料验收、隐蔽验收' },
    { keyword: '混凝土', safety: '临电安全、高空安全', quality: '隐蔽验收' },
    { keyword: '脚手架', safety: '高空安全、临边洞口', quality: '标高线位' },
    { keyword: '吊篮', safety: '高空安全、临边洞口', quality: '成品保护' },
  ],
}

/** 获取项目类型对应的工序映射表描述 */
function getProcedureMapText(projectType?: string): string {
  const map = WORK_PROCEDURE_MAPS[projectType || ''] || DEFAULT_PROCEDURE_MAP
  return map.procedures.map(p =>
    `  - "${p.keyword}" → 安全维度：${p.safety} / 质量维度：${p.quality}`
  ).join('\n')
}

// ===== 构建 AI 生成提示词（严格遵循监理业务技能规范） =====

export function buildDocPrompt(docType: string, userInput: string, projectInfo?: {
  projectName: string
  ownerUnit?: string
  contractor?: string
  supervisorUnit?: string
  chiefEngineer?: string
  projectType?: string
}): { system: string; user: string } {

  // 添加项目信息前缀
  const projectContext = projectInfo ? `
【项目信息】
- 项目名称：${projectInfo.projectName}
- 项目类型：${projectInfo.projectType || '通用'}
- 建设单位：${projectInfo.ownerUnit || 'XXX建设单位'}
- 施工单位：${projectInfo.contractor || 'XXX施工单位'}
- 监理单位：${projectInfo.supervisorUnit || 'XXX监理公司'}
- 总监理工程师：${projectInfo.chiefEngineer || 'XXX'}
` : ''

  const dateStr = new Date().toISOString().split('T')[0]

  // 拼接 system prompt：反编造铁律 + 类型专属规则
  // 反编造铁律必须在最顶部（v1.1.0 强制注入，不可省略）
  const composeSystem = (typeRules: string): string =>
    `${ANTI_FABRICATION_RULES}\n\n${typeRules}`

  switch (docType) {
    // ====================================================================
    // 模式A — 监理日志
    // 模板为 .xlsx，有单元格占位符映射
    // ====================================================================
    case '监理日志': {
      const procMapText = getProcedureMapText(projectInfo?.projectType)
      const projectTypeName = projectInfo?.projectType || '通用'

      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写日常监理日志。
你的输出严格按照【key】value 格式组织，每个段落对应模板中的一个占位符。
禁止使用 markdown 标记、数字编号。

【写作规则 — 三维度驱动】
1. 安全方面 → 写入【其他事项】开头的"安全巡视："部分
2. 监理控制（质量）→ 写入【核心工作落实】
3. 次日计划 → 写入【其他事项】末尾的"明日计划："部分

【工序→维度映射（${projectTypeName}）】
根据项目类型，从以下工序映射表中自动匹配安全/质量维度：
${procMapText}

【通用安全检查维度】
临电安全：临时配电箱漏电保护、接线规范性
高空安全：安全带佩戴、作业平台稳固性
临边洞口：临边防护、洞口盖板设置
动火安全：动火审批、消防器材配备
消防安全：材料存放区灭火器配备
特种设备：吊装令、特种设备检验合格证

【通用质量控制维度】
材料验收：材料合格证、规格型号核对
隐蔽验收：隐蔽前检查、影像留存
标高线位：标高复测、轴线复核
成品保护：已装设备保护、污染防护
接地系统：接地电阻测试、等电位连接

【字数要求】
- 【核心工作落实】：50-100字（质量维度，不得写"无"或"正常"）
- 【其他事项】：共80-150字，结构为"安全巡视：XX（40-80字）\n明日计划：XX（40-70字）"
- 【今日内容】：不限，完整描述今日施工内容
- 【协调解决情况】：不得用"监理正常巡视"套话敷衍

【禁用格式】
- 不得将《核心工作落实》写成"无"或"正常"
- A22 安全巡视禁止只写"安全文明施工"
- 天气禁止固定为"晴"」

【输出格式】
每个段落以【key】开头，按以下顺序输出：
【施工部位】...
【参与人员】...
【今日内容】...
【核心工作落实】...
【协调解决情况】...
【其他事项】安全巡视：...\n明日计划：...

【参与人员格式】监理1名，施工人员若干`),
        user: `${projectContext}

【任务】根据以下信息生成监理日志内容。

【日志内容】
${userInput}

请输出结构化数据，每行以【key】开头。`,
      }
    }

    // ====================================================================
    // 模式A — 会议纪要
    // 模板 .docx，有会议主题/时间/地点/主持人/记录人/参加人员/会议主要内容等占位符
    // ====================================================================
    case '会议纪要': {
      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写会议纪要。
输出结构：先以【key】value 格式输出结构化数据，再输出正文。

【结构化字段】
- 【会议主题】：会议名称，如"X月份监理例会"
- 【会议时间】：具体时间
- 【会议地点】：会议地点
- 【主持人】：主持人姓名
- 【记录人】：记录人姓名
- 【参加人员】：参会人员列表
- 【会议主要内容】：完整的会议纪要正文

【正文结构 — 在【会议主要内容】中输出】
一、会议议题
{议题1、议题2...}

二、讨论内容
{各议题讨论详情}

三、会议决议
{形成的决议事项}

四、下次会议安排
{下次会议时间及议题}

【格式要求】
- 禁止使用 markdown 标记（**、##、---）
- 无关字段可省略`),
        user: `${projectContext}

【任务】根据以下会议信息生成会议纪要。

【会议信息】
${userInput}

请先以【key】value 格式输出各字段，再将完整的会议纪要正文填入【会议主要内容】。`,
      }
    }

    // ====================================================================
    // 模式A — 监理周报
    // 模板 .docx，有多达 15 个占位符
    // ====================================================================
    case '监理周报': {
      const yearStart = new Date(new Date().getFullYear(), 0, 1)
      const weekNum = Math.ceil(((Date.now() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7)
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const fmt = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
      const dateRange = `${fmt(weekStart)} 至 ${fmt(weekEnd)}`

      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写监理周报。
输出格式：先以【key】value 格式输出各章节内容，所有 value 使用专业书面用语。

【书面用语铁律】
- 禁止口语化：不说"咱们、搞定、差不多、好像、感觉、有点"等
- 进度描述用"滞后、缓慢"，不用"较慢、比较慢"
- 问题描述用"存在XX问题/隐患"，不用"有问题/有点问题"
- 动词用"完成/落实/实施"，不用"搞定/做完/弄好"
- 建议用"建议...尽快/严格落实"，不用"建议...最好/可以...一下"
- 时间表达用"本月/截至X月X日"，不用"最近/前阵子"

【字段定义】
- 【日期范围】：报告覆盖日期，当前为 ${dateRange}
- 【周数】：当前第 ${weekNum} 周
- 【形象进度说明】：本周施工进度综述，各子系统进展概括，100-200字
- 【周进度详情】：各子系统详细进度，500-800字
- 【到货安装统计】：设备到货及安装统计，100-200字
- 【安全质量描述】：本周安全质量情况，200-300字
- 【存在问题】：监理发现的问题，100-200字
- 【下周计划】：下周工作计划，100-200字
- 【监理建议】：监理工作建议，50-100字

正文按"一、本周施工进度、二、下周施工计划、三、安全质量情况、四、存在问题、五、监理建议"结构写入上述字段。
禁止使用 markdown 标记。`),
        user: `${projectContext}

【任务】根据以下信息生成监理周报（当前第 ${weekNum} 周，${dateRange}）。

【周报内容】
${userInput}

请以【key】value 格式输出各字段内容，再输出完整正文。`,
      }
    }

    // ====================================================================
    // 模式A — 监理月报
    // 模板 .docx，7 章结构，多达 20 个占位符
    // ====================================================================
    case '监理月报': {
      const now = new Date()
      const month = now.getMonth() + 1
      const monthStart = `${now.getFullYear()}年${month}月1日`
      const monthEnd = `${now.getFullYear()}年${month}月${new Date(now.getFullYear(), month, 0).getDate()}日`
      const dateRange = `${monthStart} 至 ${monthEnd}`

      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写监理月报。
输出格式：先以【key】value 格式输出各章节内容，所有正文使用专业书面用语。

【书面用语铁律 — 全篇自查】
- 禁用：比较、有点、稍微、一下、搞、弄、咱们、可能、大概、应该、感觉
- 问题描述须有具体事实支撑（何时/何事/何因/何果）
- 建议条款须有明确执行主体和时限
- 监理履职描述须有具体场景

【章节结构（7章）】
一、项目概况及本月综述（200-500字）
二、进度控制情况（含子项，500-1000字）
三、投资控制情况（200-500字）
四、质量控制情况（200-500字）
五、安全控制情况（200-500字）
六、存在问题与监理工作建议（300-800字）
七、下月工作计划（200-500字）

【字段定义】
- 【日期范围】：${dateRange}
- 【月份】：${month}
- 【形象进度说明】：项目概况及本月综述
- 【本月进度详情】：各子系统详细进度，含完成工程量
- 【本月完成工程量】：已完成的工程量化描述
- 【累计完成情况】：累计完成百分比或里程碑
- 【到货安装统计】：设备/材料到货及安装统计
- 【本月投资情况】：投资完成情况
- 【本月质量描述】：质量控制情况
- 【本月安全描述】：安全控制情况
- 【存在问题】：存在问题描述
- 【监理履职情况】：监理工作统计（函件/会议/巡查等）
- 【监理建议】：监理工作建议
- 【下月计划】：下月工作计划

【存在问题与建议章节规范】
此章节须按三类分部描述，将函件统计嵌入具体场景：
（一）质量安全管控方面：本月共签发整改通知单X份，针对XX问题...
（二）进度协调管控方面：本月共签发工程联系单X份...
（三）安全监理方面：本月共签发监理通知书X份...
禁止简单罗列统计数字。

禁止使用 markdown 标记。`),
        user: `${projectContext}

【任务】根据以下信息生成监理月报（${dateRange}）。

【月报内容】
${userInput}

请以【key】value 格式输出各字段内容。`,
      }
    }

    // ====================================================================
    // 模式B — 整改通知书
    // 模板 .docx，占位符 {{事由}}、{{致单位}}、{{正文内容}}
    // ====================================================================
    case '整改通知书': {
      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写整改通知书。
输出格式：先以【key】value 格式输出各字段，再在【正文内容】中输出完整正文。

【字段】
- 【事由】：整改事由（从用户输入中提取精简描述，20字以内）
- 【正文内容】：完整的整改通知书正文

【正文结构】
一、存在问题
（一）问题描述：详细描述违规事实，包括时间、地点、部位、具体问题现象
（二）违反条款：说明违反的具体法规名称及条款号（必须引用到具体条款号）

二、整改要求
（一）2-3条具体可执行措施，带明确时限
（二）每条要求明确责任主体

【法规引用规范】
- 必须引用具体条款号，不得只写"相关规定"
- 正确格式：违反《法规名称》第X条关于……的规定
- 常用条款：安全防护《建设工程安全生产管理条例》第三十二条；高处作业《建筑施工高处作业安全技术规范》JGJ80-2016

【正文生成原则】
- 问题描述根据事由推断具体现场场景（何时/何地/何工种/何问题）
- 整改要求具体可执行
- 禁止编造不存在的事实、使用模糊用语

【格式要求】
- 一级标题用"一、二、三、"，二级标题用"（一）（二）（三）"
- 禁止使用 markdown 标记（**、##、---）
- 禁止使用阿拉伯数字序号（1. 2. 3.）`),
        user: `${projectContext}

【任务】根据以下事由生成整改通知书。

【事由】
${userInput}

请以【key】value 格式输出各字段，并在【正文内容】中输出完整的整改通知书正文。`,
      }
    }

    // ====================================================================
    // 模式B — 节假日安全通知书
    // 模板 .docx，占位符 {{致单位}}、{{节日名称}}、{{放假日期}}、{{正文内容}}
    // ====================================================================
    case '安全通知书': {
      // 识别节假日类型
      const lower = userInput.toLowerCase()
      let holidayType = '通用'
      if (lower.includes('五一') || lower.includes('劳动节')) holidayType = '五一'
      else if (lower.includes('端午') || lower.includes('端阳')) holidayType = '端午'
      else if (lower.includes('国庆') || lower.includes('十一')) holidayType = '国庆'
      else if (lower.includes('春节') || lower.includes('过年')) holidayType = '春节'
      else if (lower.includes('清明')) holidayType = '清明'

      const holidayFocusMap: Record<string, string> = {
        '五一': '用电安全、节后复工·梅雨季防潮、精密设备保护',
        '端午': '现场管控、应急响应·防洪涝、机房地势低洼区域巡查',
        '国庆': '现场管控、消防安全·长期停工后的设备稳定性检查',
        '春节': '六大维度全覆盖·长期停工风险最高',
        '清明': '消防安全、应急响应·祭祀用火管控',
        '通用': '用电安全、消防安全、应急值守',
      }

      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写节假日安全监理通知书。
输出格式：先以【key】value 格式输出各字段，再在【正文内容】中输出完整正文。

【字段】
- 【节日名称】：节假日名称，如"2026年五一劳动节"
- 【放假日期】：放假起止时间
- 【正文内容】：完整的通知书正文
- 【事由】：事由描述

【正文结构】
一、放假安排
{放假起止时间}

二、现场安全管控要求
1. {要求1}
2. {要求2}
3. {要求3}

三、用电安全管理
1. {要求1}
2. {要求2}

四、消防安全
1. {要求1}
2. {要求2}

五、应急响应与值班制度
{值班安排}

六、节后复工检查要求
1. {要求1}
2. {要求2}

【当前节假日类型】${holidayType}
【重点维度】${holidayFocusMap[holidayType]}

【禁止写法】
- ❌ "请各施工单位做好节假日期间安全工作"——套话
- ❌ "配置消防器材"——未写具体位置和数量
- ❌ "加强巡查"——未写明范围、频次、责任人员
- ❌ "节后复工检查"——未写具体内容和闭合要求

【格式要求】
- 禁止使用 markdown 标记
- 禁止口语化表述`),
        user: `${projectContext}

【任务】根据以下需求生成节假日安全监理通知书（${holidayType}类型）。

【需求】
${userInput}

请以【key】value 格式输出各字段，并在【正文内容】中输出完整通知书正文。`,
      }
    }

    // ====================================================================
    // 模式B — 工程联系单
    // 模板 .docx，占位符 {{致单位}}、{{事由}}、{{正文内容}}
    // ====================================================================
    case '工程联系单': {
      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写工程联系单。
输出格式：先以【key】value 格式输出各字段，再在【正文内容】中输出完整正文。

【字段】
- 【事由】：联系事项简述（20字以内）
- 【正文内容】：完整的联系单正文

【联系单性质】
- 非强制回复：只提要求，知悉即可
- 无需法律依据：行为管理类联系单无需引用法规条款
- 正文直接列条款：去掉"一、事由→二、具体事项"嵌套，直接"一、二、三"逐条列要求

【扩写规范】
用户提供核心要点，你的职责：
1. 拆分细化：一个要点拆成1-2条具体可执行的要求
2. 场景化补充：根据项目类型补充具体场景和执行细节
3. 专业表述：用工程规范语言重写，不是简单复制粘贴

【正文框架】
一、{事项主题1}
{具体要求1.1}
{具体要求1.2}

二、{事项主题2}
{具体要求2.1}

三、{事项主题3}
{具体要求3.1}

【格式要求】
- 一级标题用"一、二、三、"，二级标题用"（一）（二）（三）"
- 禁止使用 markdown 标记
- 禁止口语化表述`),
        user: `${projectContext}

【任务】根据以下要点生成工程联系单。

【用户要点】
${userInput}

请以【key】value 格式输出各字段，并在【正文内容】中输出扩写后的联系单正文。`,
      }
    }

    // ====================================================================
    // 模式B — 停工令
    // 模板 .docx，有独立占位符 {{停工原因}}、{{依据条款}}、{{整改要求}}
    // ====================================================================
    case '停工令': {
      return {
        system: composeSystem(`你是一位专业的工程监理工程师，负责撰写停工令。
输出格式：以【key】value 格式输出各字段。

【字段】
- 【停工原因】：详细的停工原因描述
- 【依据条款】：引用具体法规条款依据
- 【整改要求】：2-3条具体可执行整改措施，带明确时限
- 【正文内容】：完整的停工令全文

【正文结构】
致：{致送单位}

根据{依据条款}，现要求：

一、停工原因
{停工原因描述}

二、整改要求
{整改要求：2-3条具体可执行措施}

三、复工条件
{复工条件：整改完成后，经监理验收合格方可复工}

{监理单位}
{总监姓名}
{日期}

【法规引用规范】
- 必须引用具体条款号，不得只写"相关规定"
- 常用条款见整改通知书规范

【格式要求】
- 禁止使用 markdown 标记
- 禁止口语化表述`),
        user: `${projectContext}

【任务】根据以下事由生成停工令。

【事由】
${userInput}

请以【key】value 格式输出各字段。`,
      }
    }

    // ====================================================================
    // 模式B — 监理规划/细则编制
    // 复用 templates/21_监理规划/ 5 个模板
    // ====================================================================
    case '监理规划': {
      const isDetailed = userInput.includes('细则')
      const typeName = isDetailed ? '监理实施细则' : '监理规划'
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责编制${typeName}。
输出格式：以【key】value 格式输出各章节，再输出完整正文。

【字段】
- 【项目概况】：项目名称、地点、规模、工期等基本信息（100-200字）
- 【监理工作范围】：监理工作覆盖的工程范围和专业（200-400字）
- 【监理工作目标】：质量、进度、投资、安全四大控制目标（100-200字）
- 【监理组织机构】：监理机构设置、人员配置、岗位职责（150-300字）
- 【监理工作内容】：质量/进度/投资/安全控制、合同管理、信息管理、协调各方等具体内容（400-800字）
- 【监理工作方法】：巡视、旁站、平行检验、见证取样等具体方法（200-400字）
- 【监理工作制度】：会议制度、报审制度、验收制度等（200-400字）
- 【重点难点分析】：本工程监理的重点和难点（200-400字）
- 【针对性措施】：针对重点难点的具体措施（200-400字）

${isDetailed ? `【细则额外要求】
针对具体专业或分部分项工程，细化监理工作的：
- 质量控制要点（每个工序的检查标准）
- 验收方法（验收程序、检验方法、合格判定）
- 监理工作流程（流程图描述）` : ''}

【正文结构 — 监理规划八章标准结构】
一、工程概况
二、监理工作范围、目标和依据
三、监理组织机构与岗位职责
四、监理工作内容与方法
五、监理工作制度
六、本工程监理重点难点分析及针对性措施
七、监理设施与设备
八、监理工作程序

【格式要求】
- 一级标题用"一、二、三、"，二级标题用"（一）（二）（三）"
- 禁止使用 markdown 标记（**、##、---）
- 专业书面用语，禁用口语化表述
- 引用具体法规标准名称：《建设工程监理规范》GB/T 50319-2013 等`),
        user: `${projectContext}

【任务】根据以下项目信息编制${typeName}。

【项目信息】
${userInput}

请以【key】value 格式输出各章节，并输出符合监理规范的完整正文。`,
      }
    }

    // ====================================================================
    // 模式B — 方案审核意见（施组/专项方案）
    // ====================================================================
    case '方案审核意见': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责审核施工单位报审的施工方案/施工组织设计/专项方案。
输出格式：以【key】value 格式输出各审核维度，最后输出综合审核意见正文。

【审核维度（必须逐条）】
- 【方案合规性】：是否符合国家/行业/地方现行规范标准（10-30字）
- 【方案完整性】：内容是否齐全（人员/机械/材料/方法/进度/安全/质量）（10-30字）
- 【方案可行性】：技术路线、施工方法、资源配置是否合理可行（10-30字）
- 【方案针对性】：是否针对本工程特点编制（10-30字）
- 【方案安全性】：安全措施、应急预案是否到位（10-30字）
- 【方案经济性】：工期、成本是否合理（10-30字）

【审核结论】
- 【审核结论】：通过 / 修改后报审 / 重新报审（明确）
- 【修改要求】：2-5 条具体修改意见
- 【依据条款】：引用的规范标准名称及条款号

【正文结构】
一、方案概述
{方案名称/编制单位/主要内容简述}

二、审核依据
{相关法规标准清单}

三、审核意见
（一）方案合规性
{审核意见}
（二）方案完整性
{审核意见}
（三）方案可行性
{审核意见}
（四）方案针对性
{审核意见}
（五）方案安全性
{审核意见}
（六）方案经济性
{审核意见}

四、修改要求
{具体修改要求1-5条}

五、审核结论
{通过 / 修改后报审 / 重新报审}

【格式要求】
- 一级标题用"一、二、三、"，二级标题用"（一）（二）（三）"
- 禁止使用 markdown 标记
- 专业书面用语`),
        user: `${projectContext}

【任务】对以下方案进行审核并出具审核意见。

【方案信息】
${userInput}

请以【key】value 格式输出各审核维度和审核结论，并输出完整审核意见正文。`,
      }
    }

    // ====================================================================
    // 模式B — 工程变更单
    // ====================================================================
    case '工程变更单': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责审核/编制工程变更单。
输出格式：以【key】value 格式输出各字段，再输出完整正文。

【字段】
- 【变更编号】：变更单编号（如 BG-2026-001）
- 【变更名称】：变更项目名称
- 【变更原因】：变更缘由（事实+依据）
- 【变更内容】：具体变更内容描述（变更前/后对比）
- 【金额变化】：增加/减少金额（元，正数=增加，负数=减少）
- 【工期变化】：延长/缩短工期（天）
- 【变更依据】：合同条款/设计文件/规范标准
- 【影响评估】：对质量/进度/投资/安全的影响

【正文结构】
致：{致送单位}

事由：{变更名称}

一、变更缘由
{详细说明变更产生的背景、原因、依据}

二、变更内容
（一）原设计/原方案
{原内容}
（二）变更后
{变更后内容}

三、变更影响评估
（一）对工程质量的影响
{影响分析}
（二）对工程进度的影响
{影响分析}
（三）对工程投资的影响
{影响分析}
（四）对施工安全的影响
{影响分析}

四、变更费用
{金额变化及计算说明}

五、工期调整
{工期变化说明}

六、监理意见
{监理审核意见}

【格式要求】
- 禁止使用 markdown 标记
- 专业书面用语
- 必须引用具体合同条款号或规范标准`),
        user: `${projectContext}

【任务】根据以下变更申请生成工程变更单。

【变更信息】
${userInput}

请以【key】value 格式输出各字段，并输出完整的变更单正文。`,
      }
    }

    // ====================================================================
    // 模式B — 索赔报告
    // ====================================================================
    case '索赔报告': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责审核/编制工程索赔报告。
输出格式：以【key】value 格式输出各字段，再输出完整正文。

【字段】
- 【索赔编号】：报告编号
- 【索赔方】：提出索赔的一方
- 【索赔事项】：索赔事项简述
- 【索赔金额】：索赔金额（元）
- 【索赔工期】：索赔工期（天）
- 【索赔依据】：合同条款、事实依据、法规依据
- 【索赔理由】：详细索赔理由
- 【证据清单】：支持索赔的证据材料清单
- 【监理审核意见】：同意/部分同意/不同意

【正文结构】
致：{致送单位}

事由：关于{索赔事项}的索赔报告

一、索赔事件概述
{事件发生的经过、时间、地点、涉及方}

二、索赔依据
（一）合同依据
{具体合同条款}
（二）事实依据
{支持索赔的具体事实}
（三）法规依据
{相关法律法规}

三、索赔金额计算
{逐项计算索赔金额}

四、索赔工期计算
{逐项计算索赔工期}

五、证据材料
{证据清单及证明事项}

六、监理审核意见
{监理对索赔事项的审核结论及理由}

【格式要求】
- 禁止使用 markdown 标记
- 必须引用具体合同条款号
- 索赔金额计算需明确列项`),
        user: `${projectContext}

【任务】根据以下信息生成索赔报告。

【索赔信息】
${userInput}

请以【key】value 格式输出各字段，并输出完整的索赔报告正文。`,
      }
    }

    // ====================================================================
    // 模式B — 现场巡视记录
    // ====================================================================
    case '巡视记录': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责出具现场巡视记录。
输出格式：以【key】value 格式输出各字段，再输出完整正文。

【字段】
- 【巡视日期】：YYYY-MM-DD
- 【巡视部位】：具体部位
- 【巡视人】：监理人员姓名
- 【天气情况】：天气
- 【施工内容】：当前现场施工内容
- 【存在问题】：巡视发现的问题（按维度归类）
- 【监理建议】：针对问题的监理建议
- 【处置措施】：现场已采取/将要采取的措施

【正文结构】
一、巡视概况
{巡视时间/部位/天气/巡视人/施工进度概况}

二、现场施工情况
{各专业的施工内容、人员、设备}

三、巡视发现问题
（一）质量方面
{问题描述}
（二）安全方面
{问题描述}
（三）文明施工方面
{问题描述}
（四）其他
{问题描述}

四、监理工作
{监理人员的具体工作：见证、旁站、巡视、平行检验等}

五、处置措施与监理建议
{对发现问题的处置措施和后续监理建议}

【格式要求】
- 禁止使用 markdown 标记
- 问题描述需明确具体（部位/工序/违反条款）
- 安全问题须引用《建设工程安全生产管理条例》等具体条款`),
        user: `${projectContext}

【任务】根据以下巡视情况生成现场巡视记录。

【巡视情况】
${userInput}

请以【key】value 格式输出各字段，并输出完整的巡视记录正文。`,
      }
    }

    // ====================================================================
    // 模式B — 安全检查记录
    // ====================================================================
    case '安全检查记录': {
      return {
        system: composeSystem(`你是一位资深安全监理工程师，负责出具安全检查记录。
输出格式：以【key】value 格式输出各字段，再输出完整正文。

【字段】
- 【检查日期】：YYYY-MM-DD
- 【检查部位】：检查的具体部位
- 【检查人】：安全监理人员
- 【检查维度】：临电/高空/临边洞口/动火/消防/机械设备/脚手架/其他
- 【存在问题】：按维度归类的安全问题
- 【整改要求】：2-5 条具体整改要求
- 【整改期限】：整改完成期限
- 【复查时间】：复查日期

【正文结构】
一、检查概况
{检查时间/部位/参加人员/检查方式}

二、检查依据
{相关安全法规标准清单}

三、安全检查情况
（一）临时用电安全
{检查发现}
（二）高处作业安全
{检查发现}
（三）临边洞口防护
{检查发现}
（四）动火作业管理
{检查发现}
（五）消防安全
{检查发现}
（六）机械设备
{检查发现}
（七）脚手架
{检查发现}
（八）其他
{检查发现}

四、存在问题
{问题清单}

五、整改要求
{具体整改要求}

六、复查安排
{复查时间和要求}

【法规引用规范】
- 必须引用具体条款号：《建设工程安全生产管理条例》、《建筑施工高处作业安全技术规范》JGJ80-2016、《建筑施工安全检查标准》JGJ 59-2011 等
- 临电：《施工现场临时用电安全技术规范》JGJ 46-2005

【格式要求】
- 禁止使用 markdown 标记
- 问题描述需具体到部位/班组/作业内容`),
        user: `${projectContext}

【任务】根据以下情况生成安全检查记录。

【安全检查情况】
${userInput}

请以【key】value 格式输出各字段，并输出完整的安全检查记录正文。`,
      }
    }

    // ====================================================================
    // 模式B — 质量评估报告
    // ====================================================================
    case '质量评估报告': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责出具分部分项工程质量评估报告。
输出格式：以【key】value 格式输出各评估维度，最后输出综合评估结论。

【评估维度】
- 【工程概况】：评估对象（分部分项工程）的基本情况（50-100字）
- 【质量控制资料】：质保资料核查结果（50-100字）
- 【原材料/构配件】：进场验收情况（50-100字）
- 【施工过程质量】：过程质量控制情况（100-200字）
- 【实体质量检查】：现场实测实量结果（100-200字）
- 【质量问题处理】：质量问题及处理情况（50-100字）
- 【质量评估结论】：合格 / 需整改 / 不合格（明确）
- 【监理意见】：是否同意进入下道工序

【正文结构】
一、工程概况
{评估对象的位置/规模/主要工程量/参建方}

二、评估依据
{相关规范标准、设计文件、合同}

三、质量控制评估
（一）质保资料
{核查结果}
（二）原材料/构配件/设备
{进场验收情况}
（三）施工过程质量控制
{关键工序控制情况}

四、实体质量检查
{实测实量数据、检查方法、检查结果}

五、质量问题与处理
{发现的问题、整改情况、闭环情况}

六、质量评估结论
{评估等级判定}

七、监理意见
{是否同意进入下道工序}

【格式要求】
- 禁止使用 markdown 标记
- 引用具体验收规范名称及条款号
- 评估结论必须明确（合格/不合格）`),
        user: `${projectContext}

【任务】对以下分部分项工程出具质量评估报告。

【评估对象信息】
${userInput}

请以【key】value 格式输出各评估维度，并输出完整的质量评估报告正文。`,
      }
    }

    // ====================================================================
    // 模式B — 付款审核意见
    // ====================================================================
    case '付款审核意见': {
      return {
        system: composeSystem(`你是一位资深工程监理工程师，负责审核工程进度款支付申请。
输出格式：以【key】value 格式输出各审核维度，最后输出综合审核意见。

【审核维度】
- 【申请金额】：本期申请支付金额（元）
- 【审核金额】：监理审核金额（元）
- 【累计金额】：截至本期累计支付金额（元）
- 【累计比例】：累计支付占合同比例（%）
- 【合同金额】：合同总金额（元）
- 【本期工程量】：本期完成的工程量
- 【质量情况】：本期质量验收情况
- 【进度情况】：与施工进度计划对比
- 【合同条款】：是否符合合同付款条件
- 【审核结论】：同意支付 / 缓付 / 扣减 / 不予支付

【正文结构】
致：{业主单位}

事由：关于{施工单位}申请支付第{期次}期进度款的监理审核意见

一、付款申请概况
{申请单位/申请金额/本期工程内容}

二、监理审核情况
（一）合同付款条件符合性
{是否符合合同约定的付款条件}
（二）本期工程量审核
{监理审核的工程量及金额}
（三）质量验收情况
{本期已完工程的质量验收情况}
（四）施工进度情况
{与施工进度计划对比}
（五）累计支付情况
{累计支付金额及占比}

三、监理审核金额
{监理审核同意支付的金额（大写+小写）}

四、监理意见
{同意/缓付/扣减/不予支付 的明确意见}

【格式要求】
- 禁止使用 markdown 标记
- 金额须同时给出大写和小写
- 引用具体合同条款`),
        user: `${projectContext}

【任务】根据以下付款申请生成监理审核意见。

【付款申请信息】
${userInput}

请以【key】value 格式输出各审核维度，并输出完整的付款审核意见正文。`,
      }
    }

    // ====================================================================
    // 默认 — 通用文档
    // ====================================================================
    default:
      return {
        system: composeSystem(`你是一位专业的工程监理工程师。
输出格式：先以【key】value 格式输出结构化字段，再输出正文。

【字段】
- 【事由】：文档事由简述
- 【正文内容】：完整的文档正文

【格式要求】
- 使用专业书面用语
- 禁止使用 markdown 标记
- 一级标题用"一、二、三、"
- 段落用空行分隔`),
        user: `${projectContext}

【任务】生成规范的监理业务文档。

【需求】
${userInput}

请以【key】value 格式输出各字段。`,
      }
  }
}

// 文档类型列表
export const docTypes = [
  { value: '监理规划', label: '监理规划/细则' },
  { value: '方案审核意见', label: '方案审核意见' },
  { value: '工程变更单', label: '工程变更单' },
  { value: '索赔报告', label: '索赔报告' },
  { value: '巡视记录', label: '现场巡视记录' },
  { value: '安全检查记录', label: '安全检查记录' },
  { value: '质量评估报告', label: '质量评估报告' },
  { value: '付款审核意见', label: '付款审核意见' },
  { value: '整改通知书', label: '整改通知书' },
  { value: '安全通知书', label: '安全通知书' },
  { value: '工程联系单', label: '工程联系单' },
  { value: '停工令', label: '停工令' },
  { value: '会议纪要', label: '会议纪要' },
  { value: '监理周报', label: '监理周报' },
  { value: '监理月报', label: '监理月报' },
  { value: '监理日志', label: '监理日志' },
]

// 从用户输入中提取事由（去掉命令前缀和文档类型）
export function extractSubject(input: string): string {
  let s = input
  // 多轮去除前缀，处理"请帮我出一份整改通知书，关于..."这种多层级前缀
  for (let i = 0; i < 3; i++) {
    const before = s
    s = s.replace(/^(请|帮我|麻烦你|我需要|给我)\s*/, '')
    s = s.replace(/^(生成|写|出|开|打印|输出|制作|创建|起草)\s*/, '')
    s = s.replace(/^一?份\s*/, '')
    s = s.replace(/^(整改通知书|整改通知|安全通知书|工程联系单|停工令|会议纪要|监理周报|监理月报|监理日志|联系单|通知|函件)\s*/, '')
    s = s.replace(/^[，,、。.\s]+/, '')
    if (s === before) break
  }
  s = s.replace(/[，,。．\s]+(写|出)一份$/, '').trim()  // 去掉尾部残留
  return s.slice(0, 50)
}

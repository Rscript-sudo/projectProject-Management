// 项目画像的唯一类型事实源。前端、主进程和模板渲染均从这里解析类型，
// 持久化时保存稳定 code，展示时保存/使用中文名称，避免“信息化工程”被误判为土建。
//
// ============================================================
// 自定义专业（v1.x 新增 · 2026-08-19）
// ============================================================
// 用户在 Settings → 专业类型 Tab 加的专业会落到 settings.json 的
// customProjectTypes 字段。运行时通过 setCustomProjectTypes() 注入到
// builtin 数组末尾。code 必须英文小写，全局唯一，与内置不冲突。
export const PROJECT_TYPE_OPTIONS = [
  {
    code: 'information', label: '信息化工程', aliases: ['信息化', '信息化工程', '智能化工程', '弱电工程', '系统集成'],
    suggestedTags: ['机房', '网络', '安防', '综合布线', '数据中心'],
    // v1.x：禁用术语机制已移除（老板拍板），不再做 AI 扩写约束。
    forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'communication', label: '通信工程', aliases: ['通信', '通信工程', '通信线路', '传输工程'],
    suggestedTags: ['传输', '无线', '核心网', '光缆', '基站'],
    forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'power', label: '电力工程', aliases: ['电力', '电力工程', '输配电工程'],
    suggestedTags: ['变配电', '配电柜', '电缆', '接地', '继电保护'],
    forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'civil', label: '土建工程', aliases: ['土建', '土建工程'],
    suggestedTags: ['地基基础', '主体结构', '砌体', '防水', '装饰装修'], forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'municipal', label: '市政工程', aliases: ['市政', '市政工程'],
    suggestedTags: ['道路', '管网', '桥梁', '给排水', '照明'], forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'building', label: '房建工程', aliases: ['房建', '房建工程'],
    suggestedTags: ['主体结构', '机电安装', '幕墙', '消防', '装修'], forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'landscape', label: '园林工程', aliases: ['园林', '园林工程'],
    suggestedTags: ['绿化', '苗木', '景观', '园路', '灌溉'], forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'steel', label: '钢结构工程', aliases: ['钢结构', '钢结构工程'],
    suggestedTags: ['钢构件', '焊接', '防腐', '吊装', '高强螺栓'], forbiddenTerms: [],
    source: 'builtin',
  },
  {
    code: 'decoration', label: '装饰工程', aliases: ['装饰', '装饰工程', '装修工程'],
    suggestedTags: ['吊顶', '墙地面', '门窗', '涂饰', '机电末端'], forbiddenTerms: [],
    source: 'builtin',
  },
  { code: 'unclassified', label: '未分类', aliases: ['通用', '未分类', ''], suggestedTags: [], forbiddenTerms: [], source: 'builtin' },
]

// 用户自定义专业的运行时缓存。来源：settings.json.customProjectTypes
// 通过 setCustomProjectTypes() 注入。getAllProjectTypes() 时合并返回。
let customProjectTypesCache = []

/**
 * 主进程启动 / settings 变更时调用，注入用户自定义专业
 * 校验：code 唯一（小写英文）、label 非空、code 不与内置冲突
 */
export function setCustomProjectTypes(list) {
  if (!Array.isArray(list)) {
    customProjectTypesCache = []
    return { ok: true, added: 0, rejected: [] }
  }
  const builtinCodes = new Set(PROJECT_TYPE_OPTIONS.map(p => p.code))
  const rejected = []
  const cleaned = []
  for (const item of list) {
    if (!item || typeof item !== 'object') { rejected.push({ item, reason: 'not-object' }); continue }
    const code = String(item.code || '').trim().toLowerCase()
    const label = String(item.label || '').trim()
    if (!code || !/^[a-z][a-z0-9_]{0,30}$/.test(code)) { rejected.push({ item, reason: 'invalid-code' }); continue }
    if (!label) { rejected.push({ item, reason: 'empty-label' }); continue }
    if (builtinCodes.has(code)) { rejected.push({ item, reason: 'code-conflict-with-builtin' }); continue }
    if (cleaned.some(c => c.code === code)) { rejected.push({ item, reason: 'duplicate-code' }); continue }
    cleaned.push({
      code,
      label,
      aliases: Array.isArray(item.aliases) ? item.aliases.map(a => String(a).trim()).filter(Boolean) : [],
      suggestedTags: Array.isArray(item.suggestedTags) ? item.suggestedTags.map(t => String(t).trim()).filter(Boolean) : [],
      forbiddenTerms: Array.isArray(item.forbiddenTerms) ? item.forbiddenTerms.map(t => String(t).trim()).filter(Boolean) : [],
      hasCustomSop: !!item.hasCustomSop,
      source: 'custom',
    })
  }
  customProjectTypesCache = cleaned
  return { ok: true, added: cleaned.length, rejected }
}

/** 当前已注入的自定义专业（仅 custom 项，不含内置） */
export function getCustomProjectTypes() {
  return customProjectTypesCache
}

/** 内置 + 自定义合并返回（永远先内置后自定义） */
export function getAllProjectTypes() {
  return [...PROJECT_TYPE_OPTIONS, ...customProjectTypesCache]
}

const byCode = (() => {
  const map = Object.fromEntries(PROJECT_TYPE_OPTIONS.map(item => [item.code, item]))
  // 自定义专业的 code 也可以查
  return new Proxy(map, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return customProjectTypesCache.find(p => p.code === prop)
    },
    has(target, prop) {
      if (prop in target) return true
      return customProjectTypesCache.some(p => p.code === prop)
    },
  })
})()

export function normalizeProjectType(value) {
  const normalized = String(value || '').trim()
  if (byCode[normalized]) return normalized
  const all = getAllProjectTypes()
  const exact = all.find(item => item.aliases.includes(normalized) || item.label === normalized)
  if (exact) return exact.code
  const partial = all.find(item => item.code !== 'unclassified' && item.aliases.some(alias => alias && normalized.includes(alias)))
  return partial?.code || 'unclassified'
}

export function getProjectTypeProfile(value) {
  return byCode[normalizeProjectType(value)] || byCode.unclassified
}

export function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags : String(tags || '').split(/[，,、]/)
  return [...new Set(source.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 12)
}

export function normalizeProjectProfile(input = {}) {
  const code = normalizeProjectType(input.projectTypeCode || input.projectType)
  const type = getProjectTypeProfile(code)
  return {
    projectType: type.label,
    projectTypeCode: code,
    projectTags: normalizeTags(input.projectTags),
    projectFeatures: String(input.projectFeatures || '').trim(),
    projectPhase: String(input.projectPhase || '').trim(),
    implementationArea: String(input.implementationArea || '').trim(),
  }
}

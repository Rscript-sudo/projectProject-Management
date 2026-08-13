// 项目画像的唯一类型事实源。前端、主进程和模板渲染均从这里解析类型，
// 持久化时保存稳定 code，展示时保存/使用中文名称，避免“信息化工程”被误判为土建。
export const PROJECT_TYPE_OPTIONS = [
  {
    code: 'information', label: '信息化工程', aliases: ['信息化', '信息化工程', '智能化工程', '弱电工程', '系统集成'],
    suggestedTags: ['机房', '网络', '安防', '综合布线', '数据中心'],
    forbiddenTerms: ['塔吊', '施工升降机', '木工', '扬尘', '混凝土', '钢筋', '砌体', '模板', '脚手架', '深基坑', '高支模'],
  },
  {
    code: 'communication', label: '通信工程', aliases: ['通信', '通信工程', '通信线路', '传输工程'],
    suggestedTags: ['传输', '无线', '核心网', '光缆', '基站'],
    forbiddenTerms: ['塔吊', '施工升降机', '木工', '扬尘', '混凝土', '钢筋', '砌体', '模板', '脚手架', '深基坑', '高支模'],
  },
  {
    code: 'power', label: '电力工程', aliases: ['电力', '电力工程', '输配电工程'],
    suggestedTags: ['变配电', '配电柜', '电缆', '接地', '继电保护'],
    forbiddenTerms: ['塔吊', '施工升降机', '木工', '扬尘', '钢筋', '砌体', '模板', '脚手架', '深基坑', '高支模'],
  },
  {
    code: 'civil', label: '土建工程', aliases: ['土建', '土建工程'],
    suggestedTags: ['地基基础', '主体结构', '砌体', '防水', '装饰装修'], forbiddenTerms: [],
  },
  {
    code: 'municipal', label: '市政工程', aliases: ['市政', '市政工程'],
    suggestedTags: ['道路', '管网', '桥梁', '给排水', '照明'], forbiddenTerms: [],
  },
  {
    code: 'building', label: '房建工程', aliases: ['房建', '房建工程'],
    suggestedTags: ['主体结构', '机电安装', '幕墙', '消防', '装修'], forbiddenTerms: [],
  },
  {
    code: 'landscape', label: '园林工程', aliases: ['园林', '园林工程'],
    suggestedTags: ['绿化', '苗木', '景观', '园路', '灌溉'], forbiddenTerms: [],
  },
  {
    code: 'steel', label: '钢结构工程', aliases: ['钢结构', '钢结构工程'],
    suggestedTags: ['钢构件', '焊接', '防腐', '吊装', '高强螺栓'], forbiddenTerms: [],
  },
  {
    code: 'decoration', label: '装饰工程', aliases: ['装饰', '装饰工程', '装修工程'],
    suggestedTags: ['吊顶', '墙地面', '门窗', '涂饰', '机电末端'], forbiddenTerms: [],
  },
  { code: 'unclassified', label: '未分类', aliases: ['通用', '未分类', ''], suggestedTags: [], forbiddenTerms: [] },
]

const byCode = Object.fromEntries(PROJECT_TYPE_OPTIONS.map(item => [item.code, item]))

export function normalizeProjectType(value) {
  const normalized = String(value || '').trim()
  if (byCode[normalized]) return normalized
  const exact = PROJECT_TYPE_OPTIONS.find(item => item.aliases.includes(normalized) || item.label === normalized)
  if (exact) return exact.code
  const partial = PROJECT_TYPE_OPTIONS.find(item => item.code !== 'unclassified' && item.aliases.some(alias => alias && normalized.includes(alias)))
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
  }
}

export function findForbiddenTerms(content, type) {
  const text = String(content || '')
  return getProjectTypeProfile(type).forbiddenTerms.filter(term => text.includes(term))
}

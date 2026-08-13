// 项目文书规则唯一事实源。规则以可勾选的“能力包”呈现，避免让用户维护提示词。
// group 用于紧凑 UI；docTypes 为空时表示所有正式文书适用。
export const RULE_PACKS = [
  { id: 'source_only', group: '通用底线', label: '事实必须有来源', description: '未提供的数量、日期、人员、部位不补造；正式件不得含“待核对”。', default: true },
  { id: 'formal_tone', group: '通用底线', label: '正式监理文风', description: '使用“检查、复核、整改、报验、旁站”等专业书面表达，禁口语和模糊词。', default: true },
  { id: 'closed_loop', group: '通用底线', label: '问题闭环', description: '问题须写发现事实、处置要求、责任主体和复核动作。', default: true },
  { id: 'no_empty_phrases', group: '通用底线', label: '拒绝套话', description: '不得只写“加强管理、做好工作”；每项要求应说明对象、动作和验收点。', default: true },
  { id: 'project_scope', group: '通用底线', label: '严格按项目专业', description: '只写项目类型、标签和建设范围内的工序、风险及控制点。', default: true },

  { id: 'log_complete', group: '监理日志', label: '四段完整日志', description: '施工部位、当日监理、发现及处理、明日计划四段均有实质内容。', default: true, docTypes: ['监理日志'], minWords: 250 },
  { id: 'log_quality_controls', group: '监理日志', label: '质量控制写具体', description: '至少写 2 项已实施的检查/旁站/复核点及其处理结果。', default: true, docTypes: ['监理日志'] },
  { id: 'log_safety_controls', group: '监理日志', label: '安全巡视有范围', description: '写明当日适用的作业区域、风险点和检查结果；无依据不虚构隐患。', default: true, docTypes: ['监理日志'] },
  { id: 'log_next_day', group: '监理日志', label: '次日计划可执行', description: '计划应对应下一道工序或待复核事项，不写泛泛“继续跟进”。', default: true, docTypes: ['监理日志'] },

  { id: 'weekly_evidence', group: '监理周报', label: '进度数据可追溯', description: '进度、到货、安装、函件统计须来自台账、报验、日报或已归档资料。', default: true, docTypes: ['监理周报'] },
  { id: 'weekly_reported_vs_verified', group: '监理周报', label: '自报与核验分列', description: '施工单位自报数据与监理核验数据不混用，并说明各自来源。', default: true, docTypes: ['监理周报'] },
  { id: 'weekly_structure', group: '监理周报', label: '五类内容齐全', description: '本周进展、质量安全、问题、下周计划、监理建议均有对应内容。', default: true, docTypes: ['监理周报'], minWords: 1000 },
  { id: 'weekly_actions', group: '监理周报', label: '问题与建议可执行', description: '每项问题含场景、处置要求；建议明确执行主体和时限。', default: true, docTypes: ['监理周报'] },
  { id: 'weekly_images_optional', group: '监理周报', label: '影像仅在有资料时附', description: '无归档照片时移除影像附录，不保留空表或虚构图注。', default: true, docTypes: ['监理周报'] },

  { id: 'monthly_rollup', group: '监理月报', label: '只汇总当月归档资料', description: '以周报、函件、纪要、进度台账为来源，不重新编造累计数据。', default: true, docTypes: ['监理月报'] },
  { id: 'monthly_seven_sections', group: '监理月报', label: '七章完整月报', description: '概况、进度、投资、质量、安全、问题建议、下月计划均需有实质内容。', default: true, docTypes: ['监理月报'], minWords: 2000 },
  { id: 'monthly_metrics', group: '监理月报', label: '累计指标有计算依据', description: '工程量、进度比例、投资数据应写明来源或计算口径；无数据不填估算。', default: true, docTypes: ['监理月报'] },
  { id: 'monthly_supervision', group: '监理月报', label: '履职记录可核验', description: '巡视、旁站、函件、会议等写具体事项或编号，不只罗列数量。', default: true, docTypes: ['监理月报'] },

  { id: 'notice_three_parts', group: '通知与函件', label: '通知书三段结构', description: '整改/安全通知按问题（或风险）、要求、复核或复工安排组织。', default: true, docTypes: ['整改通知书', '安全通知书', '停工令'], minWords: 800 },
  { id: 'notice_deadline', group: '通知与函件', label: '时限必须有依据', description: '仅使用用户提供或已配置的完成期限，不自行编造具体时点。', default: true, docTypes: ['整改通知书', '安全通知书', '停工令'] },
  { id: 'contact_actionable', group: '通知与函件', label: '联系单写成行动事项', description: '每项写清对象、需配合事项、提交资料或会议安排，不套用整改语气。', default: true, docTypes: ['工程联系单'], minWords: 800 },
  { id: 'regulation_controlled', group: '通知与函件', label: '规范条款受控引用', description: '仅引用用户提供或受控规范库中能核验的条款；不能确定就不写条款号。', default: true, docTypes: ['整改通知书', '安全通知书', '停工令'] },
]

export const DEFAULT_RULE_PACK_IDS = RULE_PACKS.filter(item => item.default).map(item => item.id)
export const RULE_GROUPS = ['通用底线', '监理日志', '监理周报', '监理月报', '通知与函件']

export function normalizeDocumentRules(input = {}) {
  const validIds = new Set(RULE_PACKS.map(item => item.id))
  const raw = Array.isArray(input.rulePackIds) ? input.rulePackIds : DEFAULT_RULE_PACK_IDS
  const rulePackIds = [...new Set(raw.filter(id => validIds.has(id)))]
  return { rulePackIds: rulePackIds.length ? rulePackIds : DEFAULT_RULE_PACK_IDS, additionalInstruction: String(input.additionalInstruction || '').trim().slice(0, 500) }
}

export function getApplicableRulePacks(docType, rules = {}) {
  const normalized = normalizeDocumentRules(rules)
  return RULE_PACKS.filter(pack => normalized.rulePackIds.includes(pack.id) && (!pack.docTypes || pack.docTypes.includes(docType)))
}

export function getDocumentRuleMinWords(docType, rules = {}) {
  return Math.max(0, ...getApplicableRulePacks(docType, rules).map(pack => pack.minWords || 0))
}

export function buildDocumentRulesInjection(docType, rules = {}) {
  const normalized = normalizeDocumentRules(rules)
  const packs = getApplicableRulePacks(docType, normalized)
  const lines = packs.map((pack, index) => `${index + 1}. ${pack.label}：${pack.description}`)
  const target = getDocumentRuleMinWords(docType, normalized)
  if (target) lines.push(`${lines.length + 1}. 建议正文达到 ${target} 字左右；篇幅应与事项复杂度匹配，不以标题、占位符或重复内容凑数。`)
  if (normalized.additionalInstruction) lines.push(`${lines.length + 1}. 项目补充要求：${normalized.additionalInstruction}`)
  return `【本项目文书规则（已选择的能力包）】\n${lines.join('\n')}\n\n交付前静默自查：内容是否有来源、是否符合项目专业、结构是否齐全、每项要求是否可执行。规则不得覆盖“不得编造事实、正式件不得含待核对内容、模板字段契约和专业术语门禁”。`
}

import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'

const root = path.resolve(import.meta.dirname, '..')
const promptPath = path.join(root, 'src/shared/docTypePrompts.default.json')
const config = JSON.parse(fs.readFileSync(promptPath, 'utf8'))

const docs = [
  ['监理日志', '01_监理日志'], ['监理周报', '02_监理周报'], ['监理月报', '03_监理月报'], ['会议纪要', '04_会议纪要'],
  ['整改通知书', '05_整改通知书'], ['工程联系单', '06_工程联系单'], ['安全通知书', '07_安全通知书'], ['开工条件检查表', '08_开工条件检查表'],
  ['承建资格报审表', '09_承建资格报审表'], ['施工组织设计报审表', '10_施工组织设计报审表'], ['总监理工程师任命书', '11_总监理工程师任命书'],
  ['工程变更单', '12_工程变更单'], ['开工通知', '13_开工通知'], ['竣工通知', '14_竣工通知'], ['停工令', '15_停工令'],
  ['工程款支付证书', '16_工程款支付证书'], ['进度分析报告', '17_进度分析报告'], ['监理规划', '21_监理规划'], ['监理细则', '21_监理规划'],
]

const aiPatterns = /(正文|内容|说明|情况|进度|问题|计划|建议|措施|要求|原因|依据|风险|工作|意见|结论|事项|履职|评估|统计|部位|人员|事由|主题|附件)/
const numericPatterns = /(金额|比例|工程量|数量|日期|时间|周数|月份|编号|温度)/

function actualFields(dir, docType) {
  const cfgPath = path.join(dir, 'config.json')
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}
  const files = fs.readdirSync(dir).filter(name => /\.(docx|xlsx)$/i.test(name) && !name.startsWith('~$'))
  const hints = docType === '监理细则' ? ['监理实施细则模板.docx', '信息化项目监理实施细则通用模板.docx']
    : docType === '监理规划' ? ['监理规划模板.docx'] : []
  const file = hints.find(name => files.includes(name)) || files.find(name => name === path.basename(cfg.template || '')) || files[0]
  if (!file) return { fields: [], sources: {}, file: '' }
  const sources = Object.fromEntries(Object.entries(cfg.placeholders || {}).map(([key, value]) => [key.replace(/^\{\{|\}\}$/g, ''), value.source]))
  if (file.endsWith('.xlsx')) return { fields: Object.keys(sources), sources, file }
  const zip = new PizZip(fs.readFileSync(path.join(dir, file)))
  const xml = zip.file('word/document.xml')?.asText() || ''
  return { fields: [...new Set([...xml.matchAll(/\{\{([^}]{1,80})\}\}/g)].map(match => match[1].trim()))], sources, file }
}

const DOC_TYPE_FOCUS = {
  监理日志: '结合当前项目专业特点，按当日施工活动、监理检查方法、质量安全控制结果、问题处置和次日跟踪安排组织',
  监理周报: '按本周完成工作、质量安全检查、进度偏差、问题闭环、协调事项和下周计划组织，并与周周期一致',
  监理月报: '按月度工程概况、质量进度安全投资控制、合同信息管理、问题风险和下月重点组织，数据必须来自月度记录',
  会议纪要: '按议题、各方发言事实、形成的明确决议、责任主体、完成时限和待跟踪事项组织',
  整改通知书: '按问题事实、检查依据、风险影响、整改动作、责任边界、完成要求和复查安排组织',
  安全通知书: '按危险源事实、风险后果、立即措施、持续控制、责任落实和复查要求组织',
  工程联系单: '按联系背景、待协调事实、各方职责、建议处理路径、需回复事项和时限组织',
  停工令: '按停工事实、风险或违规依据、停工范围、现场保护、整改条件和复工报审要求组织',
  开工通知: '按开工依据、已确认条件、开工范围、执行要求和资料报送要求组织',
  竣工通知: '按完成范围、验收依据、遗留事项、资料移交和后续配合要求组织',
  工程变更单: '按变更背景、原设计或合同状态、变更内容、原因依据、质量进度投资影响和审批边界组织',
  工程款支付证书: '按合同与申请依据、已核验工程量、应扣款项、计算过程和支付边界组织，AI 不代替审核决定',
  进度分析报告: '按计划基准、实际完成、关键线路、偏差量、原因证据、风险预测和纠偏措施组织',
  开工条件检查表: '逐项核对人员、方案、图纸、场地、材料设备、安全措施和报批手续，只写检查证据与客观状态',
  承建资格报审表: '核对单位资质、许可范围、项目组织、关键岗位、人员证书和有效期，只写可核验资料',
  施工组织设计报审表: '从完整性、针对性、质量安全进度措施、资源配置、专项方案和审批手续逐项形成核查意见',
  总监理工程师任命书: '仅依据正式任命资料填写项目、单位、人员、任期和授权范围，不扩大法定或合同权限',
  监理规划: '结合项目专业、建设目标和合同范围，从监理范围目标依据、组织职责、控制方法、制度流程、重点难点和资源配置组织',
}

function fieldRule(docType, field, source) {
  if (source === 'env') return `【${field}】由项目资料自动填写；AI 不得改写、推测或补造。`
  if (source === 'computed' || /(编号|星期)/.test(field)) return `【${field}】由系统计算或生成；AI 不得伪造。`
  if (/(日期|时间)/.test(field)) return `【${field}】优先原样提取用户本次描述或已归档记录中的业务日期/时间；若字段明确是编制日期才允许系统填写当天日期。不得用当前时间替代会议、检查、发现、签收、开工、竣工等事件时间；缺失时按字段策略留空或待确认。`
  if (/天气/.test(field)) return `【${field}】只提取用户输入、监理日志或现场资料中明确记录的天气现象；可规范为“晴、阴、多云、小雨”等简洁值，不得根据日期、季节或城市猜测。`
  if (/气温|温度/.test(field)) return `【${field}】保留资料中的最高/最低或实测温度及℃单位；不得从天气推算，未提供时留空或标注待确认。`
  if (numericPatterns.test(field)) return `【${field}】从合同、报审资料、计量记录或用户输入中提取原始数值与单位；涉及金额、工程量、比例时写清可复核的计算依据，不估算、不凑数，缺少依据时按缺失策略处理。`
  if (/(单位|厂家|姓名|编制人|审核人|批准人|主持人|记录人|参加人员|参与人员)/.test(field)) return `【${field}】只列资料中明确出现的单位、岗位、姓名或人数，保持称谓一致；不从项目角色、通讯录或常识补齐未出现人员，不写“若干人”等虚构概数。`
  if (/施工部位|检查部位|工程部位/.test(field)) return `【${field}】从用户事实中提取楼栋、楼层、轴线、机房、线路区段、设备点位或具体作业面；按当前项目专业采用准确部位术语，禁止跨专业套用，不明确时待确认。`
  if (/正文|内容|情况|进度|问题|计划|建议|措施|要求|原因|依据|风险|工作|意见|事项|履职|评估|统计|事由|主题|附件/.test(field)) {
    return `【${field}】${DOC_TYPE_FOCUS[docType] || '围绕当前文种职责和模板上下文组织'}；先列可核验事实，再写与事实直接对应的专业判断和可执行动作。应体现当前项目类型适用的工序、设备或管理对象，避免与相邻字段重复；不得增加未提供的时间、部位、人员、数量、金额、责任认定或法规条款号。`
  }
  return `【${field}】从用户输入、项目资料或可定位附件中原样提取，并按${docType}栏目语气作简洁书面化整理；保留名称、数值、单位和结论含义，信息不足时按字段策略处理，不用通用套话代替事实。`
}

function buildContract(docType, fields, sources) {
  return `【模板字段合同——${docType}】
你的任务是为真实模板字段生成可直接填入的内容，而不是另写一篇文档。每个【字段名】必须与模板占位符同名，禁止自创字段。

【字段逐项规则】
${fields.map(field => `- ${fieldRule(docType, field, sources[field])}`).join('\n')}

【处理顺序】
1. 先判断字段来源：项目资料、系统计算、用户输入或 AI 扩写。
2. 项目资料和系统计算字段只提取，不改写。
3. 用户输入字段先保留事实，再转为监理书面用语。
4. AI 扩写字段必须围绕已知事实展开，扩写不等于补造。
5. 信息不足时保留“数据待核对”，不用套话掩盖缺失。

【输出合同】
只输出【key】value，key 必须来自上述模板字段。不输出 Markdown、解释、自检过程或模板之外的正文。`
}

function makeNewPrompt(docType, fields, sources) {
  const editable = fields.filter(field => !['env', 'computed'].includes(sources[field]))
  return {
    key: docType,
    mode: 'B',
    minWords: /(报告|规划|细则)/.test(docType) ? 800 : 200,
    systemTemplate: buildContract(docType, fields, sources),
    userTemplate: `\${projectContext}\n\n【任务】根据以下资料填写${docType}的模板字段。\n\n【用户资料】\n\${userInput}\n\n只输出模板字段。`,
    fields: editable.map(key => ({ key, required: true })),
    hardConstraints: ['字段名必须与模板占位符一致', '禁止编造时间、人员、部位、金额、比例和条款号', '信息不足时写“数据待核对”', '禁止使用 Markdown'],
    extras: {}, dynamicVars: {},
  }
}

const audit = []
for (const [docType, dirName] of docs) {
  const dir = path.join(root, 'templates/通用', dirName)
  const { fields, sources, file } = actualFields(dir, docType)
  if (!fields.length) {
    if (docType === '监理细则' && config.docTypes['监理规划']) {
      const planning = config.docTypes['监理规划']
      config.docTypes[docType] = {
        ...planning,
        key: docType,
        systemTemplate: planning.systemTemplate.replaceAll('监理规划', '监理细则').replace('【模板字段合同——监理规划】', '【监理细则内容规则】'),
        userTemplate: planning.userTemplate.replaceAll('监理规划', '监理细则'),
      }
      audit.push({ docType, file, status: 'rule-added-template-needs-placeholders', aiFields: config.docTypes[docType].fields.length })
    } else audit.push({ docType, file, status: 'no-placeholders' })
    continue
  }
  const existing = config.docTypes[docType]
  const prompt = existing || makeNewPrompt(docType, fields, sources)
  const oldFields = prompt.fields || []
  prompt.fields = oldFields.filter(item => fields.includes(item.key))
  for (const field of fields.filter(field => !['env', 'computed'].includes(sources[field]))) {
    if (!prompt.fields.some(item => item.key === field) && aiPatterns.test(field)) prompt.fields.push({ key: field, required: true })
  }
  const marker = '【本文种专业规则】\n'
  const previousRules = existing?.systemTemplate?.includes(marker)
    ? existing.systemTemplate.split(marker).slice(1).join(marker)
    : (existing?.systemTemplate || '按模板字段逐项填写，确保数据可核对、结论有依据、措施可执行。')
  prompt.systemTemplate = `${buildContract(docType, fields, sources)}\n\n${marker}${previousRules}`
  config.docTypes[docType] = prompt
  audit.push({ docType, file, status: 'rebuilt', templateFields: fields.length, aiFields: prompt.fields.length })
}

config.version = '1.4.2'
config._comment = '内置通用模板 AI 规则 v1.4.2：逐文种、逐字段明确事实来源、专业写作维度、组织顺序、缺失策略和反编造边界。'
fs.writeFileSync(promptPath, JSON.stringify(config, null, 2) + '\n')
console.log(JSON.stringify(audit, null, 2))

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

function fieldRule(field, source) {
  if (source === 'env') return `【${field}】由项目资料自动填写；AI 不得改写、推测或补造。`
  if (source === 'computed' || /(编号|星期)/.test(field)) return `【${field}】由系统计算或生成；AI 不得伪造。`
  if (numericPatterns.test(field)) return `【${field}】只能从用户输入或项目资料提取；数值、日期、金额和比例必须可核对，缺少时写“数据待核对”。`
  if (/(单位|厂家|姓名|编制人|审核人|批准人|主持人|记录人)/.test(field)) return `【${field}】只提取明确提供的名称或人员；不得根据常识猜测。`
  if (aiPatterns.test(field)) return `【${field}】先提取用户提供的事实，再按“事实—判断—行动”组织专业文本；不得增加未提供的时间、部位、人员、数据、责任归属或条款号。`
  return `【${field}】优先从用户输入和项目资料原样提取；仅可做书面化整理，不得补造事实。`
}

function buildContract(docType, fields, sources) {
  return `【模板字段合同——${docType}】
你的任务是为真实模板字段生成可直接填入的内容，而不是另写一篇文档。每个【字段名】必须与模板占位符同名，禁止自创字段。

【字段逐项规则】
${fields.map(field => `- ${fieldRule(field, sources[field])}`).join('\n')}

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

config.version = '1.3.0'
config._comment = '内置通用模板 AI 规则 v1.3.0：按真实模板占位符重建，明确项目资料/系统计算/用户输入/AI 扩写的边界。'
fs.writeFileSync(promptPath, JSON.stringify(config, null, 2) + '\n')
console.log(JSON.stringify(audit, null, 2))

/**
 * 编号引擎 — 自动生成和管理文档编号
 * 存储在 project.config.json 的 numbering 字段中
 */

import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { getProjectDataPath } from './shared.mjs'

// 项目级写锁，防止 getAndIncrementNumber 的 TOCTOU 竞态
const projectLocks = new Map()

async function withLock(projectName, fn) {
  if (!projectLocks.has(projectName)) {
    projectLocks.set(projectName, Promise.resolve())
  }
  const prev = projectLocks.get(projectName)
  let resolveNext
  const curr = new Promise(resolve => { resolveNext = resolve })
  projectLocks.set(projectName, curr)
  try {
    await prev
    return await fn()
  } finally {
    resolveNext()
  }
}

export function register(ipcMain) {
  // 预览下一个编号（不保存）
  ipcMain.handle('numbering:preview', safeCall((_, docType, projectName) => {
    const num = previewNumber(docType, projectName)
    return { number: num }
  }))

  // 获取并递增编号（保存到配置）
  ipcMain.handle('numbering:next', safeCall(async (_, docType, projectName) => {
    const number = await getAndIncrementNumber(docType, projectName)
    return { number }
  }))

  // 读取当前项目的编号规则
  ipcMain.handle('numbering:getRules', safeCall((_, projectName) => {
    return getEffectiveRules(projectName)
  }))

  // 保存编号规则
  ipcMain.handle('numbering:saveRules', safeCall((_, projectName, numbering) => {
    saveNumberingRules(projectName, numbering)
    return { success: true }
  }))
}

/**
 * 编号规则定义
 * reset: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
 */
export function buildDefaultNumberingConfig() {
  return {
    '整改通知书': { prefix: 'ZX', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '安全通知书': { prefix: 'AQ', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '工程联系单': { prefix: 'LX', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '工程函件': { prefix: 'HG', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '停工令':    { prefix: 'TL', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '会议纪要': { prefix: 'HZ', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '监理周报': { prefix: 'ZB', reset: 'weekly', lastDate: '', lastSeq: 0 },
    '监理月报': { prefix: 'YB', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '监理日志': { prefix: 'RZ', reset: 'daily', lastDate: '', lastSeq: 0 },
    '开工通知': { prefix: 'KG', reset: 'never', lastDate: '', lastSeq: 0 },
    '竣工通知': { prefix: 'JG', reset: 'never', lastDate: '', lastSeq: 0 },
    '工程变更单': { prefix: 'BG', reset: 'never', lastDate: '', lastSeq: 0 },
    '工程款支付证书': { prefix: 'ZF', reset: 'never', lastDate: '', lastSeq: 0 },
    '进度分析报告': { prefix: 'JD', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '开工条件检查表': { prefix: 'JC', reset: 'never', lastDate: '', lastSeq: 0 },
    '承建资格报审表': { prefix: 'ZS', reset: 'never', lastDate: '', lastSeq: 0 },
    '施工组织设计报审表': { prefix: 'SS', reset: 'never', lastDate: '', lastSeq: 0 },
    '总监理工程师任命书': { prefix: 'RM', reset: 'never', lastDate: '', lastSeq: 0 },
    // fix BUG-002：监理规划/细则 共用 GH 会撞号，分开
    '监理规划': { prefix: 'GH', reset: 'never', lastDate: '', lastSeq: 0 },
    '监理细则': { prefix: 'XZ', reset: 'never', lastDate: '', lastSeq: 0 },
    // B3 新增 8 类
    '方案审核意见': { prefix: 'SA', reset: 'never', lastDate: '', lastSeq: 0 },
    // '工程变更单' 已在上面声明（修复 BUG-001 重复）
    '索赔报告': { prefix: 'SP', reset: 'yearly', lastDate: '', lastSeq: 0 },
    '巡视记录': { prefix: 'XS', reset: 'monthly', lastDate: '', lastSeq: 0 },
    // fix BUG-003：安全检查记录(AQJC) 与 开工条件检查表(KGJC) 区分
    '安全检查记录': { prefix: 'AQJC', reset: 'monthly', lastDate: '', lastSeq: 0 },
    '质量评估报告': { prefix: 'PG', reset: 'never', lastDate: '', lastSeq: 0 },
    '付款审核意见': { prefix: 'FK', reset: 'monthly', lastDate: '', lastSeq: 0 },
  }
}

/**
 * 获取日期关键词，用于判断是否需要重置序号
 */
function getPeriodKey(date, reset) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  // 修复 BUG-004：使用 ISO 8601 周序号（周一为周首日）
  const week = getISOWeek(d)

  switch (reset) {
    case 'daily':   return `${y}${m}${day}`
    case 'weekly': return `${y}W${String(week).padStart(2, '0')}`
    case 'monthly': return `${y}${m}`
    case 'yearly':  return `${y}`
    case 'never':   return 'never'
    default:       return `${y}${m}`
  }
}

/**
 * ISO 8601 周序号（周一为首日，包含1月4日的周为第1周）
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

/**
 * 生成下一个编号
 * @param {string} docType - 文档类型
 * @param {object} rule - 该类型的编号规则
 * @param {string} projectName - 项目名称（用于存储）
 * @returns {string} 生成的编号，如 'ZX-202605-001'
 */
export function generateNextNumber(docType, rule, projectName) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  let { prefix = '', reset = 'monthly', lastDate = '', lastSeq = 0 } = rule || {}

  const currentPeriod = getPeriodKey(now, reset)
  const lastPeriod = reset === 'never' ? 'never' : getPeriodKey(new Date(lastDate), reset)

  // 判断是否需要重置
  if (reset === 'never') {
    // never 模式：序号只增不减，忽略日期
    lastSeq = (lastSeq || 0) + 1
  } else if (currentPeriod !== lastPeriod) {
    // 日期/周/月/年变化，重置序号
    lastSeq = 1
    lastDate = now.toISOString()
  } else {
    lastSeq = (lastSeq || 0) + 1
    lastDate = lastDate || now.toISOString()
  }

  const seqStr = String(lastSeq).padStart(3, '0')

  // 组装编号
  let number
  if (reset === 'never') {
    // 从来不重置的，只用序号
    number = `${prefix}-${seqStr}`
  } else {
    number = `${prefix}-${currentPeriod}-${seqStr}`
  }

  return {
    number,
    lastSeq,
    lastDate: lastSeq > 1 || reset === 'never' ? lastDate : now.toISOString(),
  }
}

/**
 * 获取项目的有效编号规则（合并默认配置）
 */
export function getEffectiveRules(projectName) {
  const dataDir = getProjectDataPath(projectName)
  const configPath = path.join(dataDir, 'project.config.json')

  let numbering = {}
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      numbering = config.numbering || {}
    } catch (e) {
      console.warn('[numbering] Failed to read config:', e.message)
    }
  }

  // 合并默认配置（用户自定义规则覆盖默认）
  const defaults = buildDefaultNumberingConfig()
  const merged = { ...defaults }
  for (const [key, rule] of Object.entries(numbering)) {
    if (rule && typeof rule === 'object') {
      merged[key] = { ...defaults[key], ...rule }
    }
  }
  return merged
}

/**
 * 保存编号规则到项目配置
 */
export function saveNumberingRules(projectName, numbering) {
  const dataDir = getProjectDataPath(projectName)
  const configPath = path.join(dataDir, 'project.config.json')

  let config = {}
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      console.warn('[numbering] Failed to parse config:', e.message)
    }
  }

  config.numbering = numbering
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * 获取并更新编号（原子操作：读取→递增→保存）
 * 返回新的编号字符串
 */
export async function getAndIncrementNumber(docType, projectName) {
  return await withLock(projectName, async () => {
    const rules = getEffectiveRules(projectName)
    const rule = rules[docType]

    if (!rule) {
      // 没有配置这个类型，用默认规则生成一个
      const defaultRules = buildDefaultNumberingConfig()
      const defaultRule = defaultRules[docType] || { prefix: docType.slice(0, 2).toUpperCase(), reset: 'monthly', lastDate: '', lastSeq: 0 }
      const result = generateNextNumber(docType, defaultRule, projectName)
      // 同步更新配置
      rules[docType] = { ...defaultRule, lastSeq: result.lastSeq, lastDate: result.lastDate }
      saveNumberingRules(projectName, rules)
      return result.number
    }

    const result = generateNextNumber(docType, rule, projectName)

    // 更新规则状态
    rules[docType] = {
      ...rule,
      lastSeq: result.lastSeq,
      lastDate: result.lastDate,
    }
    saveNumberingRules(projectName, rules)
    return result.number
  })
}

/**
 * 为文档类型生成编号（不持久化，用于预览）
 */
export function previewNumber(docType, projectName) {
  const rules = getEffectiveRules(projectName)
  const rule = rules[docType] || buildDefaultNumberingConfig()[docType] || { prefix: docType.slice(0, 2).toUpperCase(), reset: 'monthly', lastDate: '', lastSeq: 0 }
  return generateNextNumber(docType, rule, projectName).number
}
/**
 * 文件名规则 — 虚竹 v2.0 命名规范
 * 唯一真相源：~/.claude/skills/监理业务/modules/_shared/虚竹文档命名规则.md
 *
 * 文件名结构：{YYYYMMDD}_{文档编码}_{项目码}_{内容摘要}.{扩展名}
 *   日期       YYYYMMDD 8位无分隔符
 *   文档编码   见 DOC_CODE_MAP，22 类标准码
 *   项目码     来自 project.config.json.projectCode（创建项目时自动生成）
 *   内容摘要   AI 提取或用户输入；首次不加版本号，修订走 _V2/_V3
 *
 * 业务编号（写在正文"文件编号"字段，如 ZX-202605-001）继续走 numbering.mjs，
 * 与文件名是两条独立编号体系。
 */

import path from 'path'
import fs from 'fs'
import { getProjectDataPath, ensureDir } from './shared.mjs'

// ===== 22 类文档编码（v2.0 唯一真相源）=====
export const DOC_CODE_MAP = {
  '监理日志': 'JL-RZ',
  '监理周报': 'JL-ZB',
  '监理月报': 'JL-YB',
  '会议纪要': 'HY-JY',
  '现场照片': 'XC-ZP',
  '整改通知书': 'ZG-TZ',
  '安全通知书': 'JL-TZ',
  '工程联系单': 'LX-D',
  '工程函件': 'LX-H',
  '工程变更单': 'LX-H',         // 共享 LX-H 编码（与工程函件同源）
  '往来函件台账': 'LX-TJ',
  '停工令': 'TG-LM',
  '工程款支付证书': 'ZF-ZS',
  '监理规划': 'JL-GH',
  '专项汇报': 'ZX-HB',
  '项目统计表': 'JL-TJ',
  '监理工作总结': 'JL-GZ-ZJ',
  '开工条件检查表': 'KG-JC',
  '承建资格报审表': 'CJ-BS',
  '施工组织设计报审表': 'SG-BS',
  '总监理工程师任命书': 'ZJ-RM',
  '开工通知': 'KG-TZ',
  '竣工通知': 'JG-TZ',
  // 项目里额外有的（AI 助手 B3 8 类）
  '监理细则': 'JL-XZ',          // 虚竹表里没列，补一条（不与监理规划 JL-GH 冲突）
  '方案审核意见': 'FA-SC',
  '索赔报告': 'JL-SP',
  '巡视记录': 'JL-XS',
  '安全检查记录': 'AQ-JC',
  '质量评估报告': 'JL-PG',
  '付款审核意见': 'FK-SC',
  '进度分析报告': 'JD-FX',
  '通用文档': 'DOC',             // 兜底，禁止用作文档类型
}

// ===== 扩展名映射（虚竹规则：.doc / .xlsx 区分） =====
export const DOC_EXT_MAP = {
  '监理日志': '.xlsx',
  '监理月报': '.docx',
  '监理周报': '.docx',
  '会议纪要': '.docx',
  '现场照片': '.jpg',
  '总监理工程师任命书': '.xlsx',
  '工程变更单': '.xlsx',
  '往来函件台账': '.xlsx',
  '项目统计表': '.xlsx',
  '监理规划': '.docx',
}

// 默认扩展名
function defaultExt(docType) {
  return DOC_EXT_MAP[docType] || '.docx'
}

// ===== 项目码 — 来自 project.config.json.projectCode =====
export function getProjectCode(projectName) {
  try {
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (cfg.projectCode && typeof cfg.projectCode === 'string') {
        return sanitizeCode(cfg.projectCode)
      }
    }
  } catch (e) {
    console.warn('[filename] Failed to read projectCode:', e.message)
  }
  // 兜底：从项目名提取
  return generateProjectCodeFromName(projectName)
}

/**
 * 从项目名自动生成项目码
 * 规则：中文名走"PJ"+数字，否则纯字母数字走 slice(0,8)
 * 例：'804' → 'PJ804'，'PJ803_扶绥' → 'PJ803'，'扶绥一期' → 'PROJECT'
 */
export function generateProjectCodeFromName(projectName) {
  if (!projectName) return 'PROJECT'
  // 优先匹配 ^([A-Z0-9]+)_ 形式
  const m = projectName.match(/^([A-Z][A-Z0-9]+)_/)
  if (m) return sanitizeCode(m[1])
  // 含数字：PJ + 数字
  const numMatch = projectName.match(/(\d+)/)
  if (numMatch) return `PJ${numMatch[1]}`
  // 纯字母数字：取前8位
  const alphanum = projectName.slice(0, 8).replace(/[^A-Za-z0-9]/g, '')
  if (alphanum) return alphanum.toUpperCase()
  // 兜底
  return 'PROJECT'
}

function sanitizeCode(code) {
  // 项目码只允许字母数字下划线
  return code.replace(/[^A-Za-z0-9_]/g, '').toUpperCase().slice(0, 16) || 'PROJECT'
}

// ===== 内容摘要 sanitize =====
// 虚竹规则禁用：括号、书名号、单位全称；特殊情况用 _ 替代
const BANNED_CHARS = /[()[\]【】!~！～]/g

export function sanitizeSummary(text) {
  if (!text) return ''
  let s = String(text).trim()
  // 替换禁止字符为 _
  s = s.replace(BANNED_CHARS, '_')
  // 去文件系统不安全字符
  s = s.replace(/[\\/:*?"<>|]/g, '_')
  // 连续 _ 合并
  s = s.replace(/_+/g, '_')
  // 去首尾 _
  s = s.replace(/^_+|_+$/g, '')
  // 截断到 30 字符（避免文件名过长）
  return s.slice(0, 30).trim()
}

// ===== 生成日期（YYYYMMDD）=====
export function ymd(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

// ===== 月报专用：月份摘要 =====
export function monthSummary(docType, date = new Date()) {
  if (docType === '监理月报') {
    const m = String(date.getMonth() + 1).padStart(2, '0')
    return `${m}月份监理月报`
  }
  if (docType === '监理周报') {
    // 周次计算需要 ISO 8601 周号，这里简化用本月第几周
    const startOfYear = new Date(date.getFullYear(), 0, 1)
    const dayOfYear = Math.floor((date - startOfYear) / 86400000)
    const week = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7)
    return `第${week}周监理周报`
  }
  return ''
}

// ===== 核心：生成文件名 =====
// 返回 { fileName, absPath, relativePath, code, projectCode, summary, date, version }
//   customSummary?  自定义摘要（来自 AI 或用户），否则按 docType 给默认
//   version?       修订版号，如 'V2'/'V3'，首次生成不传
export function buildFileName({
  docType,
  projectName,
  customSummary = '',
  version = '',
  date = new Date(),
}) {
  const code = DOC_CODE_MAP[docType] || 'DOC'
  const projectCode = getProjectCode(projectName)
  const dateStr = ymd(date)

  // 摘要优先级：自定义 > docType 默认 > "通用"
  let summary = sanitizeSummary(customSummary)
  if (!summary) {
    summary = monthSummary(docType, date) || defaultSummary(docType)
  }

  const ext = defaultExt(docType)
  const versionSuffix = version ? `_${version}` : ''
  const fileName = `${dateStr}_${code}_${projectCode}_${summary}${versionSuffix}${ext}`

  return {
    fileName,
    code,
    projectCode,
    summary,
    date: dateStr,
    version,
    ext,
  }
}

function defaultSummary(docType) {
  const map = {
    '监理日志': '监理日志',
    '监理周报': '监理周报',
    '监理月报': '监理月报',
    '会议纪要': '会议纪要',
    '整改通知书': '整改通知',
    '安全通知书': '安全通知',
    '工程联系单': '工程联系单',
    '工程函件': '工程函件',
    '工程变更单': '工程变更',
    '停工令': '停工令',
    '工程款支付证书': '支付证书',
    '开工通知': '开工通知',
    '竣工通知': '竣工通知',
    '开工条件检查表': '开工条件检查表',
    '承建资格报审表': '承建资格报审表',
    '施工组织设计报审表': '施工组织设计报审表',
    '总监理工程师任命书': '总监理工程师任命书',
    '监理规划': '监理规划',
    '监理细则': '监理细则',
    '专项汇报': '专项汇报',
    '项目统计表': '项目统计表',
    '方案审核意见': '方案审核意见',
    '索赔报告': '索赔报告',
    '巡视记录': '巡视记录',
    '安全检查记录': '安全检查记录',
    '质量评估报告': '质量评估报告',
    '付款审核意见': '付款审核意见',
    '进度分析报告': '进度分析报告',
  }
  return map[docType] || docType
}

// ===== 路径解析（按虚竹 directory_schema.json） =====
export function getSubDir(docType) {
  const map = {
    '监理日志': '03_实施阶段/01_监理日志',
    '监理周报': '03_实施阶段/02_监理周报',
    '监理月报': '03_实施阶段/03_监理月报',
    '会议纪要': '03_实施阶段/04_会议纪要',
    '整改通知书': '03_实施阶段/06_往来函件/01_监理整改通知书/原始稿',
    '安全通知书': '03_实施阶段/06_往来函件/02_监理安全通知书/原始稿',
    '工程联系单': '03_实施阶段/06_往来函件/03_工程联系单/原始稿',
    '工程函件': '03_实施阶段/06_往来函件/04_工程函件/原始稿',
    '工程变更单': '03_实施阶段/06_往来函件/04_工程函件/原始稿',  // 共享
    '停工令': '03_实施阶段/06_往来函件/05_停工令/原始稿',
    '工程款支付证书': '03_实施阶段/06_往来函件/06_支付证书/原始稿',
    '开工通知': '02_准备阶段/04_开工报审',
    '竣工通知': '04_验收阶段/05_竣工移交',
    '开工条件检查表': '02_准备阶段/04_开工报审/01_开工条件检查表',
    '承建资格报审表': '02_准备阶段/04_开工报审/02_承建资格报审',
    '施工组织设计报审表': '02_准备阶段/04_开工报审/03_施工组织设计报审',
    '总监理工程师任命书': '02_准备阶段/04_开工报审/04_总监任命书',
    '监理规划': '02_准备阶段/02_监理规划',
    '监理细则': '02_准备阶段/03_监理细则',
    '专项汇报': '03_实施阶段/07_专项汇报',
    '项目统计表': '03_实施阶段/08_项目进度',
    '方案审核意见': '03_实施阶段/12_施工方案',
    '索赔报告': '03_实施阶段/10_问题清单',
    '巡视记录': '03_实施阶段/01_监理日志',
    '安全检查记录': '03_实施阶段/05_安全管理/01_隐患台账',
    '质量评估报告': '03_实施阶段/11_审计报告',
    '付款审核意见': '03_实施阶段/08_项目进度',
    '进度分析报告': '03_实施阶段/08_项目进度',
    '现场照片': '03_实施阶段/05_安全管理/02_现场照片',
    '监理工作总结': '04_验收阶段/01_监理总结',
  }
  return map[docType] || '03_实施阶段'
}

// ===== 修订版本号：扫描同 docType 同 summary 的现有文件，返回下一个版本号 =====
export function nextVersion(projectPath, docType, summary) {
  const subDir = getSubDir(docType)
  const dir = path.join(projectPath, subDir)
  if (!fs.existsSync(dir)) return ''
  const code = DOC_CODE_MAP[docType] || 'DOC'

  const files = fs.readdirSync(dir).filter(f => f.includes(`_${code}_`) && f.includes(`_${summary}`))
  if (files.length === 0) return ''  // 首次生成

  // 提取最大版本号
  let maxV = 1
  for (const f of files) {
    const m = f.match(/_V(\d+)\./)
    if (m) {
      const v = parseInt(m[1], 10)
      if (v > maxV) maxV = v
    }
  }
  return `V${maxV + 1}`
}

// ===== IPC 注册 =====
import { safeCall } from './safe.mjs'

export function register(ipcMain) {
  ipcMain.handle('filename:build', safeCall((_, { docType, projectName, customSummary, version, dateMs }) => {
    const date = dateMs ? new Date(dateMs) : new Date()
    const result = buildFileName({ docType, projectName, customSummary, version, date })
    const subDir = getSubDir(docType)
    return { ...result, subDir }
  }))

  ipcMain.handle('filename:nextVersion', safeCall((_, { projectPath, docType, summary }) => {
    return nextVersion(projectPath, docType, summary)
  }))

  ipcMain.handle('filename:codes', safeCall(() => {
    return DOC_CODE_MAP
  }))

  ipcMain.handle('filename:setProjectCode', safeCall((_, { projectName, projectCode }) => {
    const configPath = path.join(getProjectDataPath(projectName), 'project.config.json')
    ensureDir(path.dirname(configPath))
    let cfg = {}
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) {}
    }
    cfg.projectCode = sanitizeCode(projectCode)
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8')
    return { success: true, projectCode: cfg.projectCode }
  }))
}
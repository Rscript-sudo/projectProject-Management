/**
 * 占位符扫描工具 —— 供 doc.mjs（入口）和 templateService.mjs（兜底）共用
 *
 * 反编造铁律 v1.1.0：白名单里的占位符是 AI 主动注入的合法残留
 *   - {{未指定时间}}   — postProcessTimeFields 注入
 *   - {{待补充：XX}}   — postProcessFabricationGuard 注入
 *   - {{CURRENT_DATE}} — 当前日期占位
 * 这些不视为污染，docxtemplater 渲染后允许保留
 *
 * v1.2.3（2026-06-29）：三段划分规则（decision_rectification_expansion.md）
 *   的 🟡 必须人工填字段名也加进白名单，让 AI 在正文中保留 {{监理部联系电话}}
 *   等占位符（不视为污染），老板在预览区手动补充后再保存
 *
 * 抽到独立文件避免 templateService 和 doc.mjs 之间的循环依赖
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIELD_ALIASES_PATH = path.resolve(__dirname, '..', 'src', 'shared', 'field-aliases.json')

let _KNOWN_ALIASES = null
export function getKnownAliases() {
  if (_KNOWN_ALIASES) return _KNOWN_ALIASES
  try {
    const data = JSON.parse(fs.readFileSync(FIELD_ALIASES_PATH, 'utf8'))
    _KNOWN_ALIASES = new Set(Object.values(data).flat())
  } catch {
    _KNOWN_ALIASES = new Set()
  }
  return _KNOWN_ALIASES
}

/**
 * v1.2.3（2026-06-29）：三段划分规则的 🟡 必须人工填字段名白名单
 * 来源：memory/decision_rectification_expansion.md 第 38-44 行
 * 这些字段 AI 必须留 {{字段名}} 占位，由老板/监理工程师在预览区手动补
 */
const MANUAL_FILL_PLACEHOLDERS = new Set([
  '监理部联系电话',
  '项目编号',
  '合同编号',
  '签发人姓名',
  '签发日期',
  '责任人姓名',
  '联系电话',
  '具体时间',
  '具体责任人',
  '具体部位',
  '经济损失金额',
  '伤亡人数',
])

export const EXPECTED_PLACEHOLDER_RE = /^(未指定时间|待补充[:：].{0,40}|CURRENT_DATE)$/

/**
 * 扫描文本中真正"漏替换"的占位符
 * @param {string} text
 * @returns {string[]} 残留占位符（不含白名单和已知别名）
 */
export function scanForLeftoverPlaceholders(text) {
  if (!text || typeof text !== 'string') return []
  const matches = [...text.matchAll(/\{\{([^{}]{1,40})\}\}/g)]
  const all = [...new Set(matches.map(m => m[1].trim()))]
  const known = getKnownAliases()
  return all.filter(s =>
    !EXPECTED_PLACEHOLDER_RE.test(s) &&
    !known.has(s) &&
    !MANUAL_FILL_PLACEHOLDERS.has(s)  // v1.2.3：三段划分必填字段不算污染
  )
}
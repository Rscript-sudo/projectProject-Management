/**
 * 文档保存前置校验工具 —— 供 electron/ipc/doc.mjs 的 saveDoc 入口使用
 *
 * 职责：
 *   1. 字数硬校验：AI 扩写不达标时阻止保存（来源：02_AI扩写型.md 第 81 行 ≥ 800 字）
 *   2. 排除占位符：{{待补充：...}} {{未指定时间}} {{CURRENT_DATE}} 不计入字数
 *
 * 字数表真源在 src/shared/docTypeMinWords.ts，此处通过 JSON 镜像读
 * 与 src/shared/field-aliases.json 同步模式保持一致
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DOC_TYPE_MIN_WORDS_PATH = path.resolve(__dirname, '..', '..', 'src', 'shared', 'doc-type-min-words.json')

let _DOC_TYPE_MIN_WORDS = null
function loadMinWordsTable() {
  if (_DOC_TYPE_MIN_WORDS) return _DOC_TYPE_MIN_WORDS
  try {
    const raw = JSON.parse(fs.readFileSync(DOC_TYPE_MIN_WORDS_PATH, 'utf8'))
    // 过滤掉 _comment/_version/_updated 等元数据键
    _DOC_TYPE_MIN_WORDS = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith('_') && typeof v === 'number') {
        _DOC_TYPE_MIN_WORDS[k] = v
      }
    }
  } catch (e) {
    console.warn('[docValidation] Failed to load min-words table:', e.message)
    _DOC_TYPE_MIN_WORDS = {}
  }
  return _DOC_TYPE_MIN_WORDS
}

/**
 * 取 docType 的字数下限；未知类型返回 0（不强制校验）
 */
export function getMinWordCount(docType) {
  if (!docType) return 0
  const table = loadMinWordsTable()
  return table[docType] || 0
}

/**
 * 排除占位符后的有效字数统计
 *
 * 算法（与 src/shared/docTypeMinWords.ts 同步）：
 *   - 移除所有 {{xxx}} 占位符
 *   - 移除 markdown 标记
 *   - CJK 字符每个计 1
 *   - 英文/数字单词（长度 ≥ 2）每组计 1
 */
export function countEffectiveWords(text) {
  if (!text || typeof text !== 'string') return 0

  const stripped = text.replace(/\{\{[^{}]{1,40}\}\}/g, '')

  const noMd = stripped
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]{0,200}`/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')

  // CJK 字符计数：基本汉字 + 扩展 A 区
  const cjkCount = (noMd.match(/[一-鿿㐀-䶿]/g) || []).length

  // 英文/数字单词计数
  const englishText = noMd.replace(/[一-鿿㐀-䶿]/g, ' ')
  const words = englishText.split(/[^A-Za-z0-9]+/).filter(w => w.length >= 2)
  const englishCount = words.length

  return cjkCount + englishCount
}
/**
 * 文档类型字数下限表 — 单一真相源
 *
 * ⚠️ 新增/调整字数阈值时，必须同步更新 electron/ipc/docValidation.mjs
 *    供 electron 主进程使用（后端无法 import TS）
 *
 * 来源：
 *   - 02_AI扩写型.md 第 81 行（800 字下限，模式 B 三类）
 *   - 01_模板填充型.md 第 41 行（监理日志 A17/A22 字数表）
 *   - 01_模板填充型.md 第 256-269 行（监理月报 7 章字数累加 ≈ 2000）
 *
 * 改动记录：
 *   - v1.0.0（2026-06-26）首次抽离，老板拍板让扩写能力 ≥ 监理业务 SOP
 */

export const DOC_TYPE_MIN_WORDS: Record<string, number> = {
  // 模式 B（AI 扩写型）— SOP 自检清单 #1：≥ 800 字
  '整改通知书': 800,
  '安全通知书': 800,
  '工程联系单': 800,
  '工程变更单': 800,
  '方案审核意见': 1000,
  '索赔报告': 1000,
  '质量评估报告': 800,
  '安全检查记录': 800,
  '监理规划': 1500,

  // 模式 B（较短但仍需扩写）
  '停工令': 600,
  '巡视记录': 600,
  '付款审核意见': 600,
  '会议纪要': 600,

  // 模式 A（模板填充型）— 按章节字数累加
  '监理月报': 2000,
  '监理周报': 1000,

  // 模式 A（短文档）
  '监理日志': 200,
  '通用文档': 200,
}

/**
 * 排除占位符后的有效字数统计
 *
 * 排除范围（反编造铁律白名单）：
 *   - {{待补充：XX}}
 *   - {{未指定时间}}
 *   - {{CURRENT_DATE}}
 *   - {{XXX}} 其他待人工填充占位符
 *
 * 算法：
 *   - 移除所有 {{xxx}} 占位符（含方括号/下划线）
 *   - CJK 字符每个计 1
 *   - 英文/数字单词按空格分隔每组计 1
 *   - 标点符号不计入
 */
export function countEffectiveWords(text: string): number {
  if (!text || typeof text !== 'string') return 0

  // 移除所有 {{...}} 占位符（最宽 1-40 字符的内部内容）
  const stripped = text.replace(/\{\{[^{}]{1,40}\}\}/g, '')

  // 移除 markdown 标记（防御）
  const noMd = stripped
    .replace(/```[\s\S]*?```/g, '')     // 代码块
    .replace(/`[^`]{0,200}`/g, '')        // 行内代码
    .replace(/^\s*[-*+]\s+/gm, '')        // 列表项标记
    .replace(/^\s*#+\s+/gm, '')           // 标题标记
    .replace(/\*\*([^*]+)\*\*/g, '$1')    // 加粗
    .replace(/\*([^*]+)\*/g, '$1')        // 斜体

  // CJK 字符计数：每个汉字/全角符号计 1
  const cjkCount = (noMd.match(/[一-鿿㐀-䶿]/g) || []).length

  // 英文/数字单词计数：按非字母数字字符分隔，每段长度 ≥ 2 计 1 词
  const englishText = noMd.replace(/[一-鿿㐀-䶿]/g, ' ')
  const words = englishText.split(/[^A-Za-z0-9]+/).filter(w => w.length >= 2)
  const englishCount = words.length

  return cjkCount + englishCount
}

/**
 * 取 docType 的字数下限；未知类型返回 0（不强制校验）
 */
export function getMinWordCount(docType: string): number {
  return DOC_TYPE_MIN_WORDS[docType] || 0
}
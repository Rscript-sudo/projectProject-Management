/**
 * 反编造铁律后处理 —— 主进程共享模块
 *
 * 来源：src/services/aiService.ts（v1.2.0 同步迁移）
 *   - postProcessTimeFields
 *   - postProcessFabricationGuard
 *
 * 历史：
 *   - v1.1.0：仅前端 ProjectView.tsx 调用
 *   - v1.2.0（老板 2026-06-27 拍板）：迁移到主进程共享模块，doc.mjs 入口统一调用
 *     避免任何非前端入口（如直接 IPC）绕开反编造铁律
 *
 * 单一真相源：
 *   - 前端 ProjectView.tsx 仍 import aiService 版本（兼容旧调用）
 *   - 主进程 doc.mjs import 此模块
 *   - 两端实现必须保持一致；修改前请同步两端
 */

/**
 * 将 AI 生成内容中的时间占位符替换为当前真实时间
 * v1.2.0：与 aiService.ts 完全同步
 *
 * @param {string} content
 * @returns {string}
 */
export function postProcessTimeFields(content, context = {}) {
  if (!content || typeof content !== 'string') return content
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}年${month}月${day}日`

  // 顺序很重要：必须先杀后补，否则 AI 编造的日期刚被替换又被清空
  let result = content
  const protectedSourceDates = []
  const sourceDateKeys = new Set(
    [...String(context.sourceText || '').matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)]
      .map(match => `${match[1]}-${Number(match[2])}-${Number(match[3])}`)
  )
  if (sourceDateKeys.size) {
    result = result.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (matched, y, m, d) => {
      if (!sourceDateKeys.has(`${y}-${Number(m)}-${Number(d)}`)) return matched
      const token = `__PMS_SOURCE_DATE_${protectedSourceDates.length}__`
      protectedSourceDates.push(matched)
      return token
    })
  }
  // 周报/月报的日期范围是业务周期数据，不是 AI 随机生成的“具体日期”。
  // 先保护它，避免通用日期清洗把完整周期错误压成当天。
  const protectedRanges = []
  result = result.replace(/【日期范围】[^\n]*/g, (matched) => {
    const token = `__PMS_DATE_RANGE_${protectedRanges.length}__`
    protectedRanges.push(matched)
    return token
  })

  // 1a. 拦截具体到分钟的时间（"14时30分"→"{{未指定时间}}"）
  result = result.replace(
    /(?<![\d])\s*(?:上午|下午|凌晨|早上|晚上|傍晚)?\s*\d{1,2}\s*[时点]\s*\d{1,2}\s*分(?![\d年月日时分秒])/g,
    '{{未指定时间}}'
  )
  // 1b. 拦截完整日期时间（"2023年11月15日14时30分"→"{{CURRENT_DATE}}"）
  result = result.replace(
    /\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}\s*[时点]\s*\d{1,2}\s*分?)?/g,
    '{{CURRENT_DATE}}'
  )
  // 1c. 拦截"X月X日"（"11月15日"→"{{CURRENT_DATE}}"）
  result = result.replace(
    /(?<![年月日\d])\d{1,2}月\d{1,2}日(?![\d年月日])/g,
    '{{CURRENT_DATE}}'
  )

  // 2. 把 {{CURRENT_DATE}} 统一替换为真实日期
  result = result.replace(/\{\{CURRENT_DATE\}\}/g, dateStr)

  // 3. 覆盖常见日期 key 的 AI 生成值
  const timeKeys = ['日期', '巡视日期', '检查日期', '签章日期', '报告日期']
  for (const key of timeKeys) {
    const regex = new RegExp(`【${key}】[^】\\n]+`, 'g')
    result = result.replace(regex, `【${key}】${dateStr}`)
  }

  result = result.replace(/__PMS_DATE_RANGE_(\d+)__/g, (_, index) => protectedRanges[Number(index)] || '')
  return result.replace(/__PMS_SOURCE_DATE_(\d+)__/g, (_, index) => protectedSourceDates[Number(index)] || '')
}

/**
 * v1.2.0 反编造守门员 — 检测 AI 编造的具体场景
 *
 * v1.1.2 → v1.2.0 变更（2026-06-27 老板拍板）：
 *   - 删除"编造节假日安排"检测（节假日日期属公开信息，AI 应直接写）
 *   - 保留"虚构法规条款号"检测
 *
 * @param {string} content
 * @returns {{ safe: boolean, warnings: string[], content: string }}
 */
export function postProcessFabricationGuard(content) {
  const warnings = []
  let result = content || ''

  // 1. 检测"经我监理部于..."、"经监理检查..."等模板化编造句
  const fabricationPatterns = [
    { pattern: /经我监理部于[^,，。；;]{0,80}(?:时|分|巡查|检查|巡视)/g, label: '编造监理部行动' },
    { pattern: /经.{0,8}监理.{0,8}(?:检查|巡查|巡视|发现|签发)/g, label: '编造监理行动' },
    { pattern: /于\d{4}年\d{1,2}月\d{1,2}日[^,，。；;\n]{0,40}对[^,，。；;\n]{1,30}(?:进行|开展)?(?:.{0,10})?(?:检查|巡查|巡视|督查)/g, label: '编造具体巡查时间地点' },
    { pattern: /\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}时\s*\d{1,2}分[^,，。；;\n]{0,30}对[^,，。；;\n]{1,30}进行[^,，。；;\n]{1,15}(?:检查|巡查|巡视)/g, label: '编造完整巡查句式' },
  ]
  for (const { pattern, label } of fabricationPatterns) {
    const matches = result.match(pattern)
    if (matches) {
      warnings.push(`${label}（${matches.length}处）`)
      result = result.replace(pattern, '{{待补充：具体巡查时间地点}}')
    }
  }

  // 2. 检测模糊时间词
  const fuzzyTimePatterns = [
    { pattern: /最近|前阵子|前段时间|近期/g, replacement: '本月', label: '模糊时间词' },
  ]
  for (const { pattern, replacement, label } of fuzzyTimePatterns) {
    const matches = result.match(pattern)
    if (matches) {
      warnings.push(`${label}（${matches.length}处）`)
      result = result.replace(pattern, replacement)
    }
  }

  // 3. v1.2.0 仅保留"虚构法规条款号"检测
  const factFabricationPatterns = [
    { pattern: /根据.{0,20}(?:文件|规定|条例|办法|通知|标准|规范).{0,10}(?:第.{0,10}条|第.{0,10}款|规定|要求).{0,30}(?:\d{4}年|\d{1,2}月)/g, label: '编造规范条文引用' },
  ]
  for (const { pattern, label } of factFabricationPatterns) {
    const matches = result.match(pattern)
    if (matches) {
      warnings.push(`${label}（${matches.length}处）`)
      result = result.replace(pattern, '{{待补充：相关规范条款}}')
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
    content: result,
  }
}

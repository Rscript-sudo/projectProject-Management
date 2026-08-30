import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isPathSafe } from '../electron/shared/pathSafety.mjs'
import { resolveAvailableFileName } from '../electron/shared/fileNameCollision.mjs'
import { getDocsFingerprint } from '../electron/shared/searchCache.mjs'
import { countEffectiveWords, getMinWordCount } from '../electron/ipc/docValidation.mjs'
import { postProcessFabricationGuard, postProcessTimeFields } from '../electron/shared/postProcess.mjs'
import { buildPlaceholderData, sanitizeFieldValue, sanitizeLetterStyle } from '../electron/templateService.mjs'
import { computeMonthlyComparison } from '../electron/shared/progressAnalysis.mjs'
import { parseAIJsonObject, stripThinkingContent } from '../src/shared/aiOutput.mjs'

const tempDirs = []
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
})

test('AI 助手隐藏完整和流式未完成的思考内容', () => {
  assert.equal(stripThinkingContent('<think>内部推理</think>最终回答'), '最终回答')
  assert.equal(stripThinkingContent('<analysis>正在分析'), '')
  assert.equal(stripThinkingContent('结论先行\n<think>后续内部推理'), '结论先行\n')
})

test('AI JSON 字符串中的未转义换行和控制字符可容错解析', () => {
  const parsed = parseAIJsonObject('```json\n{"source":"用户输入","requirement":"第一段\n第二段\t要求","minWords":80}\n```')
  assert.equal(parsed.requirement, '第一段\n第二段\t要求')
  assert.equal(parsed.minWords, 80)
})

test('路径校验允许临时目录中的新文件', () => {
  assert.equal(isPathSafe(path.join(makeTempDir(), 'new', 'doc.docx')), true)
})

test('路径校验拒绝系统目录', () => {
  assert.equal(isPathSafe('/etc/passwd'), false)
})

test('路径校验拒绝用户敏感目录', () => {
  assert.equal(isPathSafe(path.join(os.homedir(), '.ssh', 'id_rsa')), false)
})

test('路径校验拒绝经符号链接逃逸到系统目录', () => {
  const dir = makeTempDir()
  const link = path.join(dir, 'escape')
  fs.symlinkSync('/etc', link)
  assert.equal(isPathSafe(path.join(link, 'new.conf')), false)
})

test('照片文件名无冲突时保持原名', () => {
  assert.equal(resolveAvailableFileName(makeTempDir(), '现场.jpg'), '现场.jpg')
})

test('照片文件名首次冲突使用 -1', () => {
  const dir = makeTempDir()
  fs.writeFileSync(path.join(dir, '现场.jpg'), '')
  assert.equal(resolveAvailableFileName(dir, '现场.jpg'), '现场-1.jpg')
})

test('照片文件名连续冲突选择第一个空缺序号', () => {
  const dir = makeTempDir()
  for (const name of ['现场.jpg', '现场-1.jpg', '现场-2.jpg']) fs.writeFileSync(path.join(dir, name), '')
  assert.equal(resolveAvailableFileName(dir, '现场.jpg'), '现场-3.jpg')
})

test('照片文件名保留多段扩展名之前的主名', () => {
  const dir = makeTempDir()
  fs.writeFileSync(path.join(dir, 'a.b.jpg'), '')
  assert.equal(resolveAvailableFileName(dir, 'a.b.jpg'), 'a.b-1.jpg')
})

test('搜索指纹对相同文档稳定', () => {
  const docs = [{ id: '1', mtime: '2026-01-01', fileName: 'a', content: '内容', docType: '文档' }]
  assert.equal(getDocsFingerprint(docs), getDocsFingerprint([{ ...docs[0] }]))
})

test('搜索指纹在正文变化时失效', () => {
  const base = [{ id: '1', mtime: '2026-01-01', fileName: 'a', content: '旧正文', docType: '文档' }]
  const changed = [{ ...base[0], content: '新正文' }]
  assert.notEqual(getDocsFingerprint(base), getDocsFingerprint(changed))
})

test('搜索指纹在修改时间变化时失效', () => {
  const base = [{ id: '1', mtime: '2026-01-01', fileName: 'a', content: '正文', docType: '文档' }]
  assert.notEqual(getDocsFingerprint(base), getDocsFingerprint([{ ...base[0], mtime: '2026-01-02' }]))
})

test('有效字数按中文字符统计', () => {
  assert.equal(countEffectiveWords('工程监理资料'), 6)
})

test('有效字数不计待补充占位符', () => {
  assert.equal(countEffectiveWords('已核实{{待补充：具体时间}}'), 3)
})

test('有效字数统计英文与数字词组', () => {
  assert.equal(countEffectiveWords('AI project 2026 x'), 3)
})

test('已配置文种有明确最低字数', () => {
  assert.ok(getMinWordCount('监理月报') > 0)
})

test('具体日期被替换为当天日期', () => {
  const output = postProcessTimeFields('检查日期为2020年1月2日。')
  assert.ok(!output.includes('2020年1月2日'))
  assert.match(output, /检查日期为\d{4}年\d{2}月\d{2}日。/)
})

test('用户明确提供的日期不会被改写成当天', () => {
  const output = postProcessTimeFields(
    '【收到时间】2026年08月28日\n【送出时间】2026年08月30日',
    { sourceText: '收到时间为2026年8月28日，送出时间为2026年8月30日。' },
  )
  assert.match(output, /【收到时间】2026年08月28日/)
  assert.match(output, /【送出时间】2026年08月30日/)
})

test('周报日期范围保留完整业务周期', () => {
  const input = '【日期范围】2026年8月10日至2026年8月16日\n【周数】33'
  assert.match(postProcessTimeFields(input), /【日期范围】2026年8月10日至2026年8月16日/)
})

test('未经提供的具体时分被替换为待补充', () => {
  assert.match(postProcessTimeFields('于14时30分检查'), /\{\{未指定时间\}\}/)
})

test('反编造守门员标记虚构巡查', () => {
  const result = postProcessFabricationGuard('经我监理部于14时30分巡查发现问题。')
  assert.equal(result.safe, false)
  assert.match(result.content, /\{\{待补充：具体巡查时间地点\}\}/)
})

test('字段清洗移除重复前缀和冒号', () => {
  assert.equal(sanitizeFieldValue('事由：：关于机房整改'), '关于机房整改')
})

// v1.x：禁用术语机制已移除，不再有"信息化项目术语守门员"测试

test('信件语体被标记为待清理', () => {
  const sanitized = sanitizeLetterStyle('尊敬的建设单位：\n请处理。\n此致敬礼')
  assert.equal(sanitized, '请处理。')
  assert.doesNotMatch(sanitized, /\{\{待清理：/)
  assert.equal(sanitizeLetterStyle('请处理。\n{{待清理：信件语体 - 特此通知}}'), '请处理。')
})

test('未知参建单位不会被伪造为默认单位', () => {
  const data = buildPlaceholderData({ docType: '监理日志', projectName: '测试项目' })
  assert.equal(data['建设单位'], '')
  assert.equal(data['施工单位'], '')
  assert.equal(data['监理单位'], '')
  assert.equal(data['总监理工程师'], '')
})

test('月度进度对比能识别以前月份逾期且未完成的节点', () => {
  const result = computeMonthlyComparison([
    { name: '已逾期', plan_start: '2026-05-01', plan_end: '2026-06-30', progress_percent: 80 },
    { name: '本月计划', plan_start: '2026-07-10', plan_end: '2026-08-20', progress_percent: 50 },
    { name: '已完成', plan_start: '2026-05-01', plan_end: '2026-06-30', actual_end: '2026-08-03', progress_percent: 100 },
    { name: '无计划日期', plan_start: '', plan_end: '', progress_percent: 0 },
  ], '2026-08')

  assert.deepEqual(result.plannedNodes, ['本月计划'])
  assert.deepEqual(result.doneNodes, ['已完成'])
  assert.deepEqual(result.overdueNodes, ['已逾期'])
})

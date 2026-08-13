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
import { buildPlaceholderData, sanitizeFieldValue, sanitizeForbiddenTerms, sanitizeLetterStyle } from '../electron/templateService.mjs'

const tempDirs = []
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-test-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
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

test('信息化项目术语守门员标记土建词', () => {
  assert.match(sanitizeForbiddenTerms('现场塔吊作业', '信息化'), /\{\{待替换：塔吊（信息化项目禁用）\}\}/)
})

test('信件语体被标记为待清理', () => {
  assert.match(sanitizeLetterStyle('尊敬的建设单位：\n请处理。\n此致敬礼'), /\{\{待清理：信件语体/)
})

test('未知参建单位不会被伪造为默认单位', () => {
  const data = buildPlaceholderData({ docType: '监理日志', projectName: '测试项目' })
  assert.equal(data['建设单位'], '')
  assert.equal(data['施工单位'], '')
  assert.equal(data['监理单位'], '')
  assert.equal(data['总监理工程师'], '')
})

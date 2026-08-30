import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getDocumentRuleMinWords } from '../src/shared/documentRules.mjs'

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const minimums = read('src/shared/doc-type-min-words.json')
const prompts = read('src/shared/docTypePrompts.default.json').docTypes

test('通用模板提示词、主进程阈值和规则包使用同一篇幅合同', () => {
  const builtin = read('src/shared/builtin-doc-types.json')
  for (const docType of builtin) {
    if (!prompts[docType] || minimums[docType] == null) continue
    assert.equal(prompts[docType].minWords, minimums[docType], `${docType} 提示词与主进程篇幅阈值不一致`)
    const packMinimum = getDocumentRuleMinWords(docType)
    if (packMinimum) assert.equal(packMinimum, minimums[docType], `${docType} 规则包篇幅阈值不一致`)
  }
})

test('所有项目类型和专业 SOP 不得重新定义冲突的核心文种篇幅', () => {
  const core = ['安全通知书', '整改通知书', '监理日志', '监理周报', '监理月报']
  const router = read('src/shared/project-type-router.json')
  const visit = (value, source) => {
    if (!value || typeof value !== 'object') return
    if (value.minWordsByDocType) {
      for (const docType of core) {
        if (value.minWordsByDocType[docType] == null) continue
        assert.equal(value.minWordsByDocType[docType], minimums[docType], `${source}.${docType} 篇幅冲突`)
      }
    }
    for (const child of Object.values(value)) visit(child, source)
  }
  visit(router, 'project-type-router')

  const files = fs.readdirSync('src/shared/sop', { recursive: true })
    .filter(file => file.endsWith('.json'))
  for (const relative of files) {
    const file = path.join('src/shared/sop', relative)
    visit(read(file), file)
  }
})

test('全局 AI 结构规则不再强制任何具体文种或统一字数', () => {
  const source = fs.readFileSync('src/services/aiService.ts', 'utf8')
  const start = source.indexOf('const THREE_SEGMENT_RULES = `')
  const end = source.indexOf('`', start + 'const THREE_SEGMENT_RULES = `'.length)
  const rule = source.slice(start, end)
  assert.match(rule, /全局层不指定文种、段数或统一字数/)
  assert.doesNotMatch(rule, /监理周报|监理月报|整改通知书|≥\s*\d+\s*字/)
})

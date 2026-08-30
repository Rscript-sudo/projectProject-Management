import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'

const center = fs.readFileSync(new URL('../src/components/GlobalRulesCenter.tsx', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../src/components/DocTypePromptEditorV2.tsx', import.meta.url), 'utf8')
const templateCenter = fs.readFileSync(new URL('../src/pages/TemplateCenter.tsx', import.meta.url), 'utf8')
const aiService = fs.readFileSync(new URL('../src/services/aiService.ts', import.meta.url), 'utf8')

test('模板中心提供独立全局规则入口', () => {
  assert.match(templateCenter, />全局规则<\/Button>/)
  assert.match(templateCenter, /<GlobalRulesCenter/)
})

test('文种字段编辑器不再内嵌全文通用约束', () => {
  assert.doesNotMatch(editor, /全文通用约束/)
  assert.doesNotMatch(editor, /globalDraft/)
})

test('全局规则中心区分系统锁定规则与可调规则', () => {
  assert.match(center, /系统安全底线/)
  assert.match(center, /全局文档规则/)
  assert.match(center, /系统锁定/)
  assert.match(center, /base\.locked \|\| base\.scope === 'system'/)
})

test('AI 运行时从共享配置读取全局规则', () => {
  assert.match(aiService, /const DEFAULT_GLOBAL_RULES = getDefaultPrompts\(\)\.globalRules/)
  assert.match(aiService, /defaultGlobalRuleContent\('ANTI_FABRICATION_RULES'\)/)
})

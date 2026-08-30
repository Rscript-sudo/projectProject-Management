import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTemplateRuleEditorUrl } from '../src/shared/templateRuleNavigation.mjs'

test('从 AI 文档助手进入规则页时保留项目、模板、文种和输入', () => {
  const result = buildTemplateRuleEditorUrl({
    pathname: '/project/测试项目',
    search: '?session=abc',
    docType: '工程量统计表',
    templateId: 'tpl_123',
    input: '根据现场已确认数据生成统计表',
  })
  const outer = new URL(result, 'https://local.test')
  assert.equal(outer.pathname, '/template-center')
  assert.equal(outer.searchParams.get('rules'), '工程量统计表')
  assert.equal(outer.searchParams.get('templateId'), 'tpl_123')
  const returnTo = new URL(outer.searchParams.get('returnTo'), 'https://local.test')
  assert.equal(decodeURIComponent(returnTo.pathname), '/project/测试项目')
  assert.equal(returnTo.searchParams.get('session'), 'abc')
  assert.equal(returnTo.searchParams.get('docType'), '工程量统计表')
  assert.equal(returnTo.searchParams.get('generationTemplateId'), 'tpl_123')
  assert.equal(returnTo.searchParams.get('input'), '根据现场已确认数据生成统计表')
})

test('没有模板或输入时不会恢复过期选择', () => {
  const result = buildTemplateRuleEditorUrl({ pathname: '/project/P1', search: '?input=旧内容&generationTemplateId=old', docType: '监理日志' })
  const outer = new URL(result, 'https://local.test')
  const returnTo = new URL(outer.searchParams.get('returnTo'), 'https://local.test')
  assert.equal(returnTo.searchParams.has('input'), false)
  assert.equal(returnTo.searchParams.has('generationTemplateId'), false)
  assert.equal(returnTo.searchParams.get('docType'), '监理日志')
})

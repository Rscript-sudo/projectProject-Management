import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTemplateResourceGroups, matchesCurrentProfessionalTemplate } from '../src/shared/templateResources.mjs'

test('AI 文档助手始终展示完整模板资源分组和当前项目专业空态', () => {
  const groups = buildTemplateResourceGroups([
    { id: 'sys', scope: 'system', docType: '监理日志' },
    { id: 'private', scope: 'personal', docType: '监理日志' },
    { id: 'custom', scope: 'other', docType: '自定义记录' },
  ], '通信工程')

  assert.deepEqual(groups.map(group => group.key), ['builtin', 'professional', 'personal', 'custom', 'site-package'])
  assert.match(groups[1].label, /当前项目专业模板库 · 通信工程/)
  assert.equal(groups[1].items.length, 0)
  assert.match(groups[1].emptyText, /上传并完成 AI 规则分析/)
})

test('专业模板只显示当前项目专业，站点资料包独立分组', () => {
  const templates = [
    { id: 'telecom', scope: 'professional', projectType: 'communication' },
    { id: 'power', scope: 'professional', projectTypeLabel: '电力工程' },
    { id: 'package', scope: 'personal', resourceKind: 'site-package' },
  ]
  const groups = buildTemplateResourceGroups(templates, '通信工程')

  assert.equal(matchesCurrentProfessionalTemplate(templates[0], '通信工程'), true)
  assert.equal(matchesCurrentProfessionalTemplate(templates[1], '通信工程'), false)
  assert.deepEqual(groups.find(group => group.key === 'professional').items.map(item => item.id), ['telecom'])
  assert.deepEqual(groups.find(group => group.key === 'site-package').items.map(item => item.id), ['package'])
})


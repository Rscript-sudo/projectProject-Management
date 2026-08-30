import assert from 'node:assert/strict'
import test from 'node:test'
import { getTemplateStatus, getTemplateStatusBadge, isTemplateReady, TEMPLATE_STATUS } from '../src/shared/templateReadiness.mjs'

test('模板统一按文件、占位符、AI规则顺序判定状态', () => {
  assert.equal(getTemplateStatus({ path: '', fields: [] }), TEMPLATE_STATUS.MISSING_FILE)
  assert.equal(getTemplateStatus({ path: '/tmp/a.docx', fields: [] }), TEMPLATE_STATUS.PENDING_FIELDS)
  assert.equal(getTemplateStatus({ path: '/tmp/a.docx', fields: ['正文'] }), TEMPLATE_STATUS.PENDING_RULES)
  assert.equal(getTemplateStatus({ path: '/tmp/a.docx', fields: ['正文'], aiRuleConfiguredAt: '2026-08-27' }), TEMPLATE_STATUS.READY)
  assert.equal(getTemplateStatus({ path: '/tmp/a.docx', fields: ['正文'], aiRuleConfiguredAt: '2026-08-27', aiRuleNeedsUpdate: true }), TEMPLATE_STATUS.NEEDS_UPDATE)
  assert.equal(getTemplateStatus({ path: '/tmp/a.docx', fields: ['正文'], readOnly: true }), TEMPLATE_STATUS.READY)
  assert.equal(isTemplateReady({ path: '/tmp/a.docx', fields: ['正文'], aiRuleConfiguredAt: '2026-08-27' }), true)
})

test('模板资源角标覆盖系统、就绪、待配置和需更新', () => {
  assert.equal(getTemplateStatusBadge({ path: '/tmp/a.docx', fields: ['正文'], scope: 'system' }).label, '系统规则')
  assert.equal(getTemplateStatusBadge({ path: '/tmp/a.docx', fields: ['正文'], aiRuleConfiguredAt: '2026-08-27' }).label, '已就绪')
  assert.equal(getTemplateStatusBadge({ path: '/tmp/a.docx', fields: ['正文'] }).label, '待配置')
  assert.equal(getTemplateStatusBadge({ path: '/tmp/a.docx', fields: ['正文'], aiRuleConfiguredAt: '2026-08-27', aiRuleNeedsUpdate: true }).label, '需更新')
})

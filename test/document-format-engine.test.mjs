import test from 'node:test'
import assert from 'node:assert/strict'
import { FORMAT_ENGINE_VERSION, FORMAT_SPEC_ID, PAGE, getLayoutLayer, getFormatProfile, detectParagraphRole, formatAuditFromXml } from '../electron/documentFormatEngine.mjs'

test('统一排版引擎按文种路由到正确版式层', () => {
  assert.equal(getLayoutLayer('整改通知书'), 'table_cell_layer')
  assert.equal(getLayoutLayer('监理日志'), 'form_layer')
  assert.equal(getLayoutLayer('监理周报'), 'body_layer')
})

test('统一排版引擎固定 A4、国标页边距和分层字号', () => {
  const report = getFormatProfile('监理月报')
  const notice = getFormatProfile('整改通知书')
  assert.equal(FORMAT_ENGINE_VERSION, '2.0.0')
  assert.equal(FORMAT_SPEC_ID, 'gbt9704-2012-v1')
  assert.deepEqual([PAGE.width, PAGE.height], [11906, 16838])
  assert.deepEqual(PAGE.margin, { top: 2098, bottom: 1984, left: 1587, right: 1474, header: 720, footer: 720 })
  assert.equal(report.styles.body.size, 32)
  assert.equal(report.styles.body.firstLine, 640)
  assert.equal(notice.styles.body.size, 28)
  assert.equal(notice.styles.body.firstLine, 560)
})

test('标题与正文能稳定分类', () => {
  assert.equal(detectParagraphRole('一、工程概况'), 'h1')
  assert.equal(detectParagraphRole('（一）质量控制'), 'h2')
  assert.equal(detectParagraphRole('1. 检查设备安装情况'), 'h3')
  assert.equal(detectParagraphRole('监理单位：测试单位'), 'closing')
  assert.equal(detectParagraphRole('施工单位应于限期内整改。'), 'body')
})

test('格式门禁同时检查纸张、边距、字体和占位内容', () => {
  const okXml = '<w:document><w:t>正文</w:t><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2098" w:bottom="1984" w:left="1587" w:right="1474"/></w:sectPr></w:document>'
  assert.equal(formatAuditFromXml(okXml, '<w:styles>Songti SC</w:styles>', '监理周报').valid, true)
  const failed = formatAuditFromXml('<w:document><w:t>{{正文}}</w:t></w:document>', '', '监理周报')
  assert.equal(failed.valid, false)
  assert.ok(failed.issues.length >= 3)
})

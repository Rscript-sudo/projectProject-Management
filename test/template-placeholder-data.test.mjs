import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlaceholderData } from '../electron/templateService.mjs'

test('无 config 的私人模板按实体占位符解析结构化字段', () => {
  const data = buildPlaceholderData({
    docType: '工程量统计表',
    projectName: '测试项目',
    content: '【编号】待确认\n【工程名称】待确认\n【局点名称】待确认\n【日期】2020年01月01日\n【表格行规格型号】待确认\n【表格行其它情况】设计数量12公里，实际数量10公里。\n【施工单位签名】\n【监理单位签名】\n【签名日期】',
    config: {},
    templateFields: ['工程名称', '局点名称', '日期', '表格行规格型号', '表格行其它情况', '施工单位签名', '监理单位签名', '签名日期'],
  })
  assert.equal(data['工程名称'], '测试项目')
  assert.notEqual(data['编号'], '待确认')
  assert.notEqual(data['日期'], '2020年01月01日')
  assert.equal(data['局点名称'], '')
  assert.equal(data['表格行规格型号'], '')
  assert.equal(data['表格行其它情况'], '设计数量12公里，实际数量10公里。')
  assert.equal(data['施工单位签名'], '')
  assert.equal(data['监理单位签名'], '')
})

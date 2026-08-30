import test from 'node:test'
import assert from 'node:assert/strict'
import { getTemplateInputPlaceholder } from '../src/shared/templateInputGuidance.mjs'

test('小输入框为常用模板提供简短事实引导', () => {
  assert.equal(getTemplateInputPlaceholder('工程量统计表'), '粘贴工程量明细，或上传 Excel')
  assert.equal(getTemplateInputPlaceholder('监理日志'), '描述当天已确认的现场情况')
  assert.equal(getTemplateInputPlaceholder('整改通知书'), '描述问题、位置及整改要求')
  assert.equal(getTemplateInputPlaceholder('会议纪要'), '粘贴会议记录，或填写议题与结论')
})

test('未知模板使用通用短提示且不预设生成命令', () => {
  const text = getTemplateInputPlaceholder('自定义验收记录')
  assert.equal(text, '输入已确认事实，或上传相关资料')
  assert.equal(text.includes('生成一份'), false)
})

test('表格和报告类自定义文种按名称获得合适引导', () => {
  assert.equal(getTemplateInputPlaceholder('设备明细表'), '粘贴已确认数据，或上传表格')
  assert.equal(getTemplateInputPlaceholder('专项评估报告'), '填写已确认的事实、数据和要求')
})

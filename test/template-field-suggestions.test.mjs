import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeTemplateAnalysisFields, normalizeTemplateFieldSuggestions, resolveReloadedTemplateFields, suggestPlaceholderNames } from '../src/shared/templateFieldSuggestions.mjs'

test('固定明细表表头不会被识别为 AI 占位符', () => {
  const result = normalizeTemplateFieldSuggestions([
    { name: '项目', mode: 'ai', reason: '固定表头栏目名' },
    { name: '设计数量', mode: 'keep', reason: '表头' },
    { name: '工程量明细行', mode: 'ai', reason: '表头下方空白数据行' },
    { name: '工程名称', mode: 'project', reason: '需要填写的基础信息栏' },
  ])
  assert.deepEqual(result.map(item => item.name), ['工程量明细行', '工程名称'])
})

test('重复候选字段只保留一个', () => {
  const result = normalizeTemplateFieldSuggestions([
    { name: '备注说明', mode: 'ai', reason: '空白填写栏' },
    { name: '备注说明', mode: 'ai', reason: '重复建议' },
  ])
  assert.equal(result.length, 1)
})

test('模板解析得到的字段级规则随建议结果保留', () => {
  const rule = {
    source: '用户输入', requirement: '只提取明确数值', required: false,
    minWords: 0, maxWords: 40, antiFabrication: true, missingInfoPolicy: '留空',
  }
  const result = normalizeTemplateFieldSuggestions([{ name: '完成数量', mode: 'ai', reason: '数据行空白', rule }])
  assert.deepEqual(result[0].rule, rule)
})

test('业务事件时间不能被当作系统当前时间自动填充', () => {
  const result = normalizeTemplateFieldSuggestions([{
    name: '收到时间', mode: 'system', reason: '表格值栏',
    rule: { source: '系统', requirement: '填写当前日期', required: false, minWords: 0, maxWords: 20, antiFabrication: true, missingInfoPolicy: '留空' },
  }])
  assert.equal(result[0].mode, 'ai')
  assert.match(result[0].rule.requirement, /不得使用当前系统时间代替/)
})

test('项目主数据没有的人员字段不能伪装成自动填充字段', () => {
  const result = normalizeTemplateFieldSuggestions([{
    name: '监理工程师', mode: 'project', reason: '人员值栏',
    rule: { source: '项目资料', requirement: '读取姓名', required: false, minWords: 0, maxWords: 20, antiFabrication: true, missingInfoPolicy: '留空' },
  }])
  assert.equal(result[0].mode, 'ai')
  assert.match(result[0].rule.requirement, /不得从相似岗位或单位推测/)
})

test('重新分析必须保留模型漏报的已有占位符并采用最新规则', () => {
  const result = mergeTemplateAnalysisFields(
    ['项目名称', '形象进度总体说明', '进度部分情况'],
    [{ name: '形象进度总体说明', mode: 'ai', rule: { requirement: '按本周事实归纳' } }, { name: '新增空白栏', mode: 'ai' }],
    name => ({ name, mode: name === '项目名称' ? 'project' : 'ai', rule: { requirement: `保留${name}` } }),
  )
  assert.deepEqual(result.map(item => item.name), ['项目名称', '形象进度总体说明', '进度部分情况', '新增空白栏'])
  assert.equal(result[1].rule.requirement, '按本周事实归纳')
  assert.equal(result[2].rule.requirement, '保留进度部分情况')
  assert.equal(result[3].existing, false)
})

test('源文件重新载入后删除和改名的旧字段不得从登记快照复活', () => {
  assert.deepEqual(
    resolveReloadedTemplateFields(true, ['项目名称', '新字段'], ['项目名称', '旧字段', '已删除字段']),
    ['项目名称', '新字段'],
  )
  assert.deepEqual(resolveReloadedTemplateFields(false, [], ['项目名称', '旧字段']), ['项目名称', '旧字段'])
})

test('点击模板位置后提供可选择的建议占位符且过滤已有字段', () => {
  assert.deepEqual(
    suggestPlaceholderNames('一、项目概况及本周综述', ['项目名称'], [{ name: '新增建议字段' }]),
    ['形象进度总体说明', '新增建议字段', '项目概况及本周综述'],
  )
  assert.deepEqual(suggestPlaceholderNames('（一）进度部分', ['进度部分情况']), ['进度部分'])
})

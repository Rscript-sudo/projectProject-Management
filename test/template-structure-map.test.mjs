import assert from 'node:assert/strict'
import test from 'node:test'
import { extractTemplateTableStructure, buildTemplateStructureMap, deriveTemplateFieldSuggestions, reconcileTemplateFieldPlacements } from '../src/shared/templateStructureMap.mjs'

test('表格标签与右侧空白值单元格保留为不同坐标', () => {
  const html = '<table><tr><td><p>项目经理</p></td><td><p></p></td></tr></table>'
  const tables = extractTemplateTableStructure(html)
  assert.equal(tables[0].rows[0].cells[0].text, '项目经理')
  assert.equal(tables[0].rows[0].cells[0].empty, false)
  assert.equal(tables[0].rows[0].cells[1].empty, true)
  assert.match(buildTemplateStructureMap(html), /字段定位必须指向目标填值区域/)
})

test('AI 把标签单元格当目标时自动迁移到右侧空白单元格', () => {
  const html = '<table><tr><td>项目经理</td><td></td></tr></table>'
  const [field] = reconcileTemplateFieldPlacements([{ name: '项目经理', label: '项目经理', anchorText: '项目经理', tableIndex: 0, rowIndex: 0, cellIndex: 0 }], html)
  assert.equal(field.cellIndex, 1)
})

test('同一单元格标签后有独立空白段落时保留该单元格作为值区', () => {
  const html = '<table><tr><td><p>工程名称</p><p></p></td></tr></table>'
  const cell = extractTemplateTableStructure(html)[0].rows[0].cells[0]
  assert.equal(cell.fillable, true)
  const [field] = reconcileTemplateFieldPlacements([{ name: '工程名称', anchorText: '工程名称', tableIndex: 0, rowIndex: 0, cellIndex: 0 }], html)
  assert.equal(field.cellIndex, 0)
})

test('表头行不会因下方空白数据区丢失自身文字属性', () => {
  const html = '<table><tr><th>项目</th><th>规格型号</th><th>数量</th></tr><tr><td></td><td></td><td></td></tr></table>'
  const cells = extractTemplateTableStructure(html)[0].rows
  assert.deepEqual(cells[0].cells.map(cell => cell.empty), [false, false, false])
  assert.deepEqual(cells[1].cells.map(cell => cell.empty), [true, true, true])
})

test('明细表列标题合并为一个明细行字段', () => {
  const html = '<table><tr><td>项目</td><td>规格型号</td><td>单位</td><td>数量</td><td>备注</td></tr><tr><td></td><td></td><td></td><td></td><td></td></tr></table>'
  const fields = deriveTemplateFieldSuggestions('', html)
  assert.deepEqual(fields.map(field => field.name), ['工程量明细行'])
})

test('检查表示例答案不会成为字段名', () => {
  const html = '<table><tr><td>是否符合要求</td><td>符合要求</td><td></td></tr><tr><td>检查结果</td><td>正常</td><td></td></tr></table>'
  const fields = deriveTemplateFieldSuggestions('', html)
  assert.equal(fields.some(field => ['符合要求', '正常'].includes(field.name)), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { extractTemplateTableStructure, buildTemplateStructureMap, deriveTemplateFieldSuggestions, inferTemplateDocumentType, reconcileTemplateFieldPlacements } from '../src/shared/templateStructureMap.mjs'

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

test('明细表按列映射到对应空白单元格', () => {
  const html = '<table><tr><td>材料名称</td><td>规格型号</td><td>单位</td><td>数量</td><td>检查方法</td></tr><tr><td></td><td></td><td></td><td></td><td></td></tr></table>'
  const fields = deriveTemplateFieldSuggestions('', html)
  assert.deepEqual(fields.map(field => field.name), ['表格行材料名称', '表格行规格型号', '表格行单位', '表格行数量', '表格行检查方法'])
  assert.deepEqual(fields.map(field => field.cellIndex), [0, 1, 2, 3, 4])
})

test('固定样例项目值会被识别为替换字段', () => {
  const html = '<table><tr><td>工程名称</td><td>2023年旧项目</td></tr><tr><td>施工单位</td><td>旧施工公司</td></tr></table>'
  const fields = deriveTemplateFieldSuggestions('', html)
  assert.deepEqual(fields.map(field => [field.name, field.cellIndex, field.insertPosition]), [
    ['工程名称', 1, 'replace'],
    ['施工单位', 1, 'replace'],
  ])
  assert.equal(reconcileTemplateFieldPlacements(fields, html).length, 2)
})

test('检查表示例答案不会成为字段名', () => {
  const html = '<table><tr><td>是否符合要求</td><td>符合要求</td><td></td></tr><tr><td>检查结果</td><td>正常</td><td></td></tr></table>'
  const fields = deriveTemplateFieldSuggestions('', html)
  assert.equal(fields.some(field => ['符合要求', '正常'].includes(field.name)), false)
})

test('固定检查标准后的空段落不会被误判为填写区', () => {
  const html = '<table><tr><td><p>光缆敷设应顺直，弯曲半径及预留长度符合设计要求。</p><p></p></td></tr></table>'
  const cell = extractTemplateTableStructure(html)[0].rows[0].cells[0]
  assert.equal(cell.hasEmptyBlock, true)
  assert.equal(cell.fillable, false)
  assert.equal(deriveTemplateFieldSuggestions('', html).length, 0)
})

test('同一单元格中的短标签和叙述栏目不会在坐标复核时被误删', () => {
  const html = `
    <table>
      <tr><td><p>日期：</p></td><td><p>天气：</p></td></tr>
      <tr><td colspan="2"><p>施工当日完成主要工作量</p></td></tr>
      <tr><td colspan="2"><p>工程质量检查、试验情况及施工重点、关键部位旁站记录</p></td></tr>
    </table>`
  const reconciled = reconcileTemplateFieldPlacements(deriveTemplateFieldSuggestions('', html), html)
  assert.deepEqual(reconciled.map(item => item.name), [
    '日期',
    '天气',
    '施工当日完成主要工作量',
    '工程质量检查、试验情况及施工重点、关键部位旁站记录',
  ])
})

test('冒号后的固定检查标准不会被识别成字段，并列空签字栏仍可识别', () => {
  const content = '埋深及沟底处理：普通土≥1.2m，沟底应平整\n施工单位负责人：    监理工程师：'
  const fields = deriveTemplateFieldSuggestions(content, '')
  assert.equal(fields.some(item => item.name === '埋深及沟底处理'), false)
  assert.deepEqual(fields.map(item => item.name), ['施工单位负责人', '监理工程师'])
})

test('复合资料包不再截断二十个字段且共享字段保留全部位置', () => {
  const rows = Array.from({ length: 25 }, (_, index) => `<tr><td>记录${index + 1}</td><td></td></tr>`).join('')
  const shared = '<tr><td>工程名称</td><td>旧项目一</td></tr><tr><td>工程名称</td><td>旧项目二</td></tr>'
  const fields = deriveTemplateFieldSuggestions('', `<table>${shared}${rows}</table>`)
  assert.ok(fields.length > 20)
  const project = fields.find(field => field.name === '工程名称')
  assert.equal(project.placements.length, 2)
})

test('自动识别复合站点资料包和单一文种', () => {
  const compound = inferTemplateDocumentType('监理日志\n进场材料检查表\n旁站监理记录表', '监理日志模板.docx', { sitePackage: true })
  assert.equal(compound.docType, '站点综合资料包')
  assert.equal(compound.compound, true)
  assert.deepEqual(compound.forms, ['监理日志', '进场材料检查表', '旁站监理记录表'])
  assert.equal(inferTemplateDocumentType('监理周报', '任意.docx').docType, '监理周报')
})

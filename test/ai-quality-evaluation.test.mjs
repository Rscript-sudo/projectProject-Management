import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateAiDraft } from '../src/shared/aiQualityEvaluation.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fixtures = [
  ['civil', '土建', '模板支撑稳定，钢筋规格间距已复核。[来源:E1]'],
  ['municipal', '市政', '沟槽支护及排水正常，交通围挡完整。[来源:E1]'],
  ['building', '房建', '主体结构实体质量已复核，防水节点符合要求。[来源:E1]'],
  ['landscape', '园林', '苗木长势正常，灌溉排水系统运行正常。[来源:E1]'],
  ['steel', '钢结构', '焊缝外观已检查，高强螺栓终拧已复核。[来源:E1]'],
  ['decoration', '装饰', '吊顶龙骨连接牢固，墙地砖空鼓抽检合格。[来源:E1]'],
  ['communication', '通信', '光缆规格和到货数量已按材料清单核对。[来源:E1]'],
  ['power', '电力', '电力电缆规格和到货数量已按材料清单核对。[来源:E1]'],
]

for (const [code, label, content] of fixtures) {
  test(`${label} SOP 固定样本无跨专业污染`, () => {
    const sop = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/sop', code, 'safety-notice.json'), 'utf8'))
    const result = evaluateAiDraft({ content: `【检查结论】${content}`, sop, requiredFields: ['【检查结论】'] })
    assert.equal(result.passed, true)
    assert.equal(result.metrics.crossSpecialtyCount, 0)
    assert.equal(result.metrics.placeholderCount, 0)
    assert.equal(result.metrics.evidenceMarkerCount, 1)
  })
}

test('固定反例可识别缺字段、跨专业术语、占位符和无来源数字', () => {
  const sop = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/sop/civil/safety-notice.json'), 'utf8'))
  const result = evaluateAiDraft({ content: '苗木成活率为 99%，资料待核对。', sop, requiredFields: ['【检查结论】'], knownFacts: ['98%'] })
  assert.equal(result.passed, false)
  assert.equal(result.metrics.missingFieldCount, 1)
  assert.equal(result.metrics.crossSpecialtyCount, 1)
  assert.equal(result.metrics.placeholderCount, 1)
  assert.equal(result.metrics.fabricationCount, 1)
})

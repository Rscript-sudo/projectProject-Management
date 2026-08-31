import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import {
  buildFactPool,
  buildFieldConfigsFromPrompt,
  buildFieldContract,
  buildFieldResolutionPlan,
  formatResolutionContext,
  getPendingFieldPlan,
  mergeResolvedFields,
  setStructuredFieldValue,
  updateFieldPlanValue,
} from '../src/shared/fieldResolution.mjs'
import { buildLocationCandidates, resolveBusinessDate } from '../electron/fieldResolvers.mjs'

test('少量施工事实形成事实池并原样保留工程量', () => {
  const pool = buildFactPool('今天布放20公里光缆，安装15个交接箱')
  assert.deepEqual(pool.quantities.map(item => [item.value, item.unit]), [[20, '公里'], [15, '个']])
  assert.match(pool.rawInput, /20公里光缆/)
  assert.match(pool.rawInput, /15个交接箱/)
})

test('普通模板字段缺失不阻断，叙述字段进入安全扩写计划', () => {
  const fields = ['施工部位', '参与人员', '今日内容', '核心工作落实', '协调解决情况', '其他事项']
  const pool = buildFactPool('今天布放20公里光缆，安装15个交接箱', { project: { projectType: '通信工程' } })
  const plan = buildFieldResolutionPlan(fields, { factPool: pool })
  assert.equal(plan.some(item => item.contract.requiredForGeneration), false)
  assert.equal(plan.find(item => item.field === '参与人员')?.status, 'unresolved')
  assert.equal(plan.find(item => item.field === '今日内容')?.status, 'expand')
  assert.equal(plan.find(item => item.field === '核心工作落实')?.contract.expansionLevel, 'contextual')
  const prompt = formatResolutionContext(pool, plan)
  assert.match(prompt, /不得因普通字段缺失而反问后停止或拒绝生成/)
  assert.match(prompt, /把建议或后续关注点写成已经发生的事实/)
})

test('确定性自动字段覆盖未记录占位值且保留来源', () => {
  const pool = buildFactPool('今天施工', {
    autoValues: { 天气: '多云', 气温: '26～33℃' },
    provenance: { 天气: { source: 'weather-test' }, 气温: { source: 'weather-test' } },
  })
  const plan = buildFieldResolutionPlan(['天气', '气温', '今日内容'], { factPool: pool })
  const merged = mergeResolvedFields('【今日内容】开展现场作业。\n【天气】大雪\n【气温】99℃', plan)
  assert.match(merged, /【天气】多云/)
  assert.match(merged, /【气温】26～33℃/)
  assert.equal(plan.find(item => item.field === '天气')?.provenance?.source, 'weather-test')
})

test('用户提供叙述字段时仍进入扩写，确定字段才由程序覆盖', () => {
  const pool = buildFactPool('【今日内容】布放20公里光缆。\n【天气情况】晴')
  const plan = buildFieldResolutionPlan(['今日内容', '天气情况'], { factPool: pool })
  assert.equal(plan.find(item => item.field === '今日内容')?.status, 'expand')
  assert.equal(plan.find(item => item.field === '今日内容')?.value, '布放20公里光缆。')
  const merged = mergeResolvedFields('【今日内容】已完成全部通信工程并验收合格。\n【天气情况】阴', plan)
  assert.match(merged, /【今日内容】已完成全部通信工程并验收合格。/)
  assert.match(merged, /【天气情况】晴/)
})

test('人工审批字段永不交给 AI，项目类型只约束叙述字段', () => {
  const approval = buildFieldContract('审批意见')
  const narrative = buildFieldContract('协调解决情况')
  assert.equal(approval.fillMode, 'manual')
  assert.equal(approval.expansionLevel, 'none')
  assert.equal(narrative.fillMode, 'ai-expansion')
  assert.equal(narrative.projectTypeConstraint, true)
})

test('全部内置模板可从保留的文种规则生成结构化字段合同', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../src/shared/docTypePrompts.default.json', import.meta.url), 'utf8'))
  for (const [docType, prompt] of Object.entries(config.docTypes)) {
    const fields = (prompt.fields || []).map(field => field.key)
    const fieldConfigs = buildFieldConfigsFromPrompt(prompt, fields)
    assert.equal(Object.keys(fieldConfigs).length, fields.length, `${docType} 字段合同数量不一致`)
    for (const field of fields) {
      assert.ok(fieldConfigs[field].semanticType, `${docType}.${field} 缺少语义类型`)
      assert.ok(fieldConfigs[field].fillMode, `${docType}.${field} 缺少取数方式`)
      assert.equal(fieldConfigs[field].requiredForGeneration, false, `${docType}.${field} 不应默认阻断生成`)
    }
  }
})

test('业务日期支持明确日期和相对日期，不把随机时间写入模板', () => {
  assert.equal(resolveBusinessDate('2026年8月20日完成施工'), '2026-08-20')
  assert.match(resolveBusinessDate('今天完成施工'), /^20\d{2}-\d{2}-\d{2}$/)
})

test('中文完整行政区可降级为城市名用于外部数据查询', () => {
  const candidates = buildLocationCandidates('广西壮族自治区南宁市青秀区')
  assert.ok(candidates.includes('南宁'))
  assert.ok(candidates.includes('青秀'))
  assert.equal(candidates[0], '广西壮族自治区南宁市青秀区')
})

test('待补充字段可写回结构化正文并同步更新字段状态', () => {
  const plan = buildFieldResolutionPlan(['施工部位', '参与人员', '今日内容'], { factPool: buildFactPool('布放20公里光缆') })
  assert.deepEqual(getPendingFieldPlan(plan).map(item => item.field), ['施工部位', '参与人员'])
  const content = setStructuredFieldValue('【今日内容】布放20公里光缆。', '施工部位', '民族大道通信管道段')
  assert.match(content, /【施工部位】民族大道通信管道段/)
  const updated = updateFieldPlanValue(plan, '施工部位', '民族大道通信管道段')
  assert.equal(updated.find(item => item.field === '施工部位')?.status, 'resolved')
  assert.deepEqual(getPendingFieldPlan(updated).map(item => item.field), ['参与人员'])
})

test('重复补充同一字段只替换当前字段，不覆盖相邻正文', () => {
  const source = '【施工部位】A段\n【今日内容】布放20公里光缆。\n【其他事项】无'
  const updated = setStructuredFieldValue(source, '施工部位', 'B段')
  assert.match(updated, /^【施工部位】B段\n【今日内容】布放20公里光缆。/)
  assert.match(updated, /【其他事项】无$/)
})

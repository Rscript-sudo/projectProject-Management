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
  sanitizeGeneratedFieldsByPlan,
  retainTemplateFields,
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

test('自然语言标签一次解析到复合资料包及表格字段', () => {
  const pool = buildFactPool('检查地点：南宁市青秀区测试路段；施工单位：润建股份有限公司；段落名称：A段；进场材料：GYTA-48B1.3光缆2000米，外观检查合格；当日完成：光缆敷设与接续准备工作。')
  assert.equal(pool.structured.检查地点, '南宁市青秀区测试路段')
  assert.equal(pool.structured.施工地点, '南宁市青秀区测试路段')
  assert.equal(pool.structured.段落名称, 'A段')
  assert.equal(pool.structured.施工单位, '润建股份有限公司')
  assert.equal(pool.structured['表格行设备/材料'], 'GYTA-48B1.3光缆')
  assert.equal(pool.structured['表格行数量'], '2000米')
  assert.equal(pool.structured['表格行检查方式'], '外观检查')
  assert.equal(pool.structured['表格行检查意见'], '合格')
  assert.equal(pool.structured.施工当日完成主要工作量, '光缆敷设与接续准备工作')
})

test('实体模板只保留登记字段并丢弃模型额外编造段落', () => {
  const content = '【施工单位】润建股份有限公司\n【检查地点】南宁市青秀区测试路段\n【今日检查情况】盘具无破损，标签一致\n【明日计划】开盘测试'
  assert.equal(
    retainTemplateFields(content, ['施工单位', '检查地点']),
    '【施工单位】润建股份有限公司\n【检查地点】南宁市青秀区测试路段',
  )
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

test('事实提取型日期天气不接受自动查询值，缺失字段清空模型猜测', () => {
  const pool = buildFactPool('未提供具体日期、天气', {
    autoValues: { 日期: '2026年09月01日', 天气: '小雨' },
  })
  const configs = {
    日期: { mode: 'ai', semanticType: 'date', fillMode: 'fact-extraction' },
    天气: { mode: 'ai', semanticType: 'weather', fillMode: 'fact-extraction' },
  }
  const plan = buildFieldResolutionPlan(['日期', '天气'], { factPool: pool, fieldConfigs: configs })
  assert.deepEqual(plan.map(item => item.status), ['unresolved', 'unresolved'])
  assert.equal(mergeResolvedFields('【日期】2026年09月01日\n【天气】强毛毛雨', plan), '【日期】\n【天气】')
})

test('复合模板字段守门清除无来源的现场动作和结论并保留可核验事实', () => {
  const input = '进场材料：GYTA-48B1.3光缆2000米，外观检查合格；当日完成光缆敷设与接续准备工作。未提供具体日期、天气、人员姓名及其他检查事实。'
  const fields = ['材料进出场情况', '施工情况', '施工过程中存在的问题及汇报处理情况', '发现情况', '处理意见', '监理工程师签名']
  const plan = buildFieldResolutionPlan(fields, { factPool: buildFactPool(input) })
  const model = [
    '【材料进出场情况】本次进场GYTA-48B1.3光缆2000米。包装完整，缆身完好，标识清晰，端头封堵可靠。',
    '【施工情况】当日完成光缆敷设与接续准备工作。施工组织有序，监理人员进行了巡视。',
    '【施工过程中存在的问题及汇报处理情况】未发现异常情况，无需专项汇报。',
    '【发现情况】现场安全防护到位，未发现安全隐患。',
    '【处理意见】建议继续推进。',
    '【监理工程师签名】张三',
  ].join('\n')
  const safe = sanitizeGeneratedFieldsByPlan(model, plan, input)
  assert.match(safe, /【材料进出场情况】本次进场GYTA-48B1\.3光缆2000米。/)
  assert.doesNotMatch(safe, /包装完整|缆身完好|标识清晰|端头封堵|施工组织有序|巡视|未发现|安全防护|建议继续|张三/)
  assert.match(safe, /【施工过程中存在的问题及汇报处理情况】\n/)
  assert.match(safe, /【监理工程师签名】$/)
})

test('字段计划缺失时仍执行用户明确的事实边界', () => {
  const input = '进场材料：GYTA-48B1.3光缆2000米，外观检查合格。未提供具体日期、天气、人员姓名及其他检查事实。'
  const model = `【日期】2026年09月01日
【天气】小雨
【材料进出场情况】GYTA-48B1.3光缆2000米，经外观检查，缆体完好，标识清晰。
【监理工作总结】型号及数量符合报验记录；现场施工作业按计划推进，暂无异常情况；后续应继续关注材料使用与施工质量。`
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.match(safe, /【日期】\s*(?:\n|$)/)
  assert.match(safe, /【天气】\s*(?:\n|$)/)
  assert.match(safe, /GYTA-48B1\.3光缆2000米/)
  assert.doesNotMatch(safe, /缆体完好|标识清晰|报验记录|按计划推进|暂无异常/)
  assert.match(safe, /后续应继续关注材料使用与施工质量/)
})

test('接续准备不能被扩写成已经实施的具体工序', () => {
  const input = '检查地点：南宁市青秀区测试路段；进场材料：GYTA-48B1.3光缆2000米，外观检查合格；当日完成光缆敷设与接续准备工作。'
  const model = `【施工情况】本段施工内容为A段光缆敷设与接续准备工作。光缆路由位于南宁市青秀区测试路段，施工单位按工艺要求组织敷设作业，同步开展接续准备工作，包括光缆开剥、纤芯预留、接头盒定位等前期操作。
【综合评价及意见】施工单位按设计要求完成敷设与接续准备工作，材料质量合格。后续应持续关注接续质量。`
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.match(safe, /本段施工内容为A段光缆敷设与接续准备工作/)
  assert.doesNotMatch(safe, /路由位于|按工艺要求|光缆开剥|纤芯预留|接头盒定位|按设计要求|材料质量合格/)
  assert.match(safe, /后续应持续关注接续质量/)
})

test('未提供路由和工艺依据时清除设计路由及工艺流程表述', () => {
  const input = '段落名称：A段；当日完成光缆敷设与接续准备工作。'
  const model = '【施工情况】A段进行光缆敷设与接续准备工作。光缆沿设计路由布放，施工单位按工艺流程开展敷设作业，同步进行接续准备工作。'
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.match(safe, /A段进行光缆敷设与接续准备工作/)
  assert.doesNotMatch(safe, /沿设计路由|按工艺流程/)
})

test('合格事实不能泛化为报验相符或未见异常', () => {
  const input = '进场材料：GYTA-48B1.3光缆2000米，外观检查合格。'
  const model = '【综合评价及意见】本次进场光缆规格、数量与报验资料相符，外观检查未见异常。后续施工应继续关注材料使用情况。'
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.doesNotMatch(safe, /报验|相符|未见异常/)
  assert.match(safe, /后续施工应继续关注材料使用情况/)
})

test('未提供施工单位自检事实时清除自检动作并修复悬空标点', () => {
  const input = '进场材料：GYTA-48B1.3光缆2000米，外观检查合格；当日完成光缆敷设与接续准备工作。'
  const model = '【施工情况】本段当日完成光缆敷设与接续准备工作。光缆已由施工单位自检进场，外观检查合格，'
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.doesNotMatch(safe, /自检/)
  assert.match(safe, /外观检查合格。$/)
})

test('明确无其他检查事实时高风险栏目只保留未来建议', () => {
  const input = '进场材料：GYTA-48B1.3光缆2000米，外观检查合格。未提供其他检查事实。'
  const model = '【综合评价及意见】经检查未见缆皮破损、端头密封完好、印字清晰，工序推进处于可控状态。监理将持续关注后续接续质量。\n【发现情况】现场未见异常。'
  const safe = sanitizeGeneratedFieldsByPlan(model, [], input)
  assert.doesNotMatch(safe, /缆皮破损|端头密封|印字清晰|可控状态|未见异常/)
  assert.match(safe, /【综合评价及意见】监理将持续关注后续接续质量/)
  assert.match(safe, /【发现情况】\s*$/)
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

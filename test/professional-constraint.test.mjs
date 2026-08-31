import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfessionalScopeConstraint } from '../src/shared/professionalConstraint.mjs'
import { findProfessionalForbiddenTerms } from '../electron/shared/professionalTerms.mjs'

test('所有模板来源共享当前项目专业强制约束', () => {
  const constraint = buildProfessionalScopeConstraint({
    projectTypeCode: 'communication',
    projectTags: ['光缆', '传输'],
    projectFeatures: '线路与设备安装',
  })
  assert.match(constraint, /当前项目专业：通信工程/)
  for (const source of ['内置通用模板', '当前项目专业模板', '私人模板', '用户自定义模板', '站点资料包']) {
    assert.match(constraint, new RegExp(source))
  }
  assert.match(constraint, /优先级高于模板来源/)
})

test('通信和电力正式件均启用跨专业术语门禁', () => {
  assert.deepEqual(findProfessionalForbiddenTerms('communication', '现场完成钢筋绑扎和光缆敷设'), ['钢筋绑扎'])
  assert.deepEqual(findProfessionalForbiddenTerms('power', '完成光纤接续和电缆敷设'), ['光纤接续'])
})


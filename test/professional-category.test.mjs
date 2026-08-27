import test from 'node:test'
import assert from 'node:assert/strict'
import { removeProfessionalCategoryFromSettings } from '../electron/professionalCategory.mjs'

test('删除自定义专业时同步移除专业配置', () => {
  const settings = {
    customProjectTypes: [
      { code: 'specialty_123', label: '123' },
      { code: 'specialty_water', label: '水利工程' },
    ],
    hiddenProfessionalTemplateTypes: [],
  }
  const result = removeProfessionalCategoryFromSettings(settings, {
    projectType: '123',
    projectTypeCode: 'specialty_123',
  })
  assert.deepEqual(result.customProjectTypes, [{ code: 'specialty_water', label: '水利工程' }])
  assert.deepEqual(result.hiddenProfessionalTemplateTypes, [])
})

test('删除内置专业时写入隐藏列表且不产生重复项', () => {
  const settings = {
    customProjectTypes: [],
    hiddenProfessionalTemplateTypes: ['communication'],
  }
  const result = removeProfessionalCategoryFromSettings(settings, {
    projectType: '通信工程',
    projectTypeCode: 'communication',
  })
  assert.deepEqual(result.hiddenProfessionalTemplateTypes, ['communication'])
})

test('自定义专业代码不一致时仍可按名称清理历史残留', () => {
  const settings = {
    customProjectTypes: [{ code: 'specialty_old', label: '123' }],
  }
  const result = removeProfessionalCategoryFromSettings(settings, {
    projectType: '123',
    projectTypeCode: 'specialty_new',
  })
  assert.deepEqual(result.customProjectTypes, [])
})

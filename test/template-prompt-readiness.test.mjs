import assert from 'node:assert/strict'
import test from 'node:test'
import { hasUsablePromptConfig } from '../src/shared/promptReadiness.mjs'

test('内置文种无需用户覆盖也具备可执行扩写规则', () => {
  assert.equal(hasUsablePromptConfig({ systemTemplate: '系统默认规则', userTemplate: '用户默认规则' }, null), true)
})

test('自定义文种必须保存完整扩写规则后才能生成', () => {
  assert.equal(hasUsablePromptConfig(undefined, null), false)
  assert.equal(hasUsablePromptConfig(undefined, {
    systemTemplate: '按模板字段生成', userTemplate: '根据用户事实扩写',
  }), true)
  assert.equal(hasUsablePromptConfig(undefined, {
    systemTemplate: '只有系统规则', userTemplate: '',
  }), false)
})

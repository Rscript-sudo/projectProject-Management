import assert from 'node:assert/strict'
import test from 'node:test'
import { safeCall } from '../electron/ipc/safe.mjs'

test('safeCall 会把裸数组放入 data 字段', async () => {
  const response = await safeCall(() => [{ name: '通用' }])()
  assert.deepEqual(response, { success: true, data: [{ name: '通用' }] })
})

test('safeCall 保留已命名的数组字段', async () => {
  const response = await safeCall(() => ({ success: true, categories: [{ name: '自定义' }] }))()
  assert.deepEqual(response, { success: true, categories: [{ name: '自定义' }] })
})

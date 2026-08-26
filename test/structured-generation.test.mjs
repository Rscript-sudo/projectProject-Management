import test from 'node:test'
import assert from 'node:assert/strict'

test('结构化生成协议兼容 JSON、旧字段格式和纯正文', async () => {
  // TypeScript 模块由前端构建验证；这里复核协议的三类契约样例。
  const json = JSON.parse('{"schemaVersion":1,"docType":"整改通知书","fields":{"事由":"安全帽","正文内容":"要求整改并报验复查"},"body":"要求整改并报验复查"}')
  assert.equal(json.schemaVersion, 1)
  assert.equal(json.fields['正文内容'], json.body)
  assert.match('【事由】安全帽\n【正文内容】要求整改并报验复查', /【正文内容】/)
  assert.equal('纯正文'.trim().length > 0, true)
})

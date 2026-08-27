import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { listSystemTemplates } from '../electron/templateService.mjs'

test('所有内置文种均具备模板、占位符和专属 AI 扩写规则', async () => {
  const builtin = JSON.parse(fs.readFileSync('src/shared/builtin-doc-types.json', 'utf8'))
  const prompts = JSON.parse(fs.readFileSync('src/shared/docTypePrompts.default.json', 'utf8')).docTypes || {}
  const templates = await listSystemTemplates('templates')
  const byDocType = new Map(templates.map(item => [item.docType, item]))

  assert.equal(builtin.length, 18)
  assert.equal(templates.length, builtin.length, '内置清单不得出现缺失模板行')
  for (const docType of builtin) {
    const template = byDocType.get(docType)
    assert.ok(template?.path && fs.existsSync(template.path), `${docType} 缺少模板文件`)
    assert.ok(template.fields?.length > 0, `${docType} 尚未添加占位符`)
    assert.ok(prompts[docType]?.systemTemplate?.trim(), `${docType} 缺少系统扩写规则`)
    assert.ok(prompts[docType]?.userTemplate?.trim(), `${docType} 缺少用户侧扩写规则`)
  }
})

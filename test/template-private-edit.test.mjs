import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getTemplatePlaceholders, saveDocxTemplatePlaceholders } from '../electron/templateService.mjs'
import { importTemplateToLibrary, resolveLibraryTemplate } from '../electron/templateRegistry.mjs'

test('模板占位符可新增、删除并真实写回 DOCX', async t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-edit-'))
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))
  const target = path.join(runtimeDir, 'editable.docx')
  fs.copyFileSync(path.resolve('templates/通用/01_监理日志/监理日志模版.docx'), target)

  const original = await getTemplatePlaceholders(target)
  assert.ok(original.includes('天气'))
  const fields = await saveDocxTemplatePlaceholders(target, {
    addFields: ['自定义验收结论', '现场负责人'],
    removeFields: ['天气'],
    placements: [{ field: '现场负责人', anchor: '施工部位：', position: 'after' }],
  })

  assert.ok(fields.includes('自定义验收结论'))
  assert.ok(fields.includes('现场负责人'))
  assert.ok(!fields.includes('天气'))
  assert.deepEqual(await getTemplatePlaceholders(target), fields)
  const { default: PizZip } = await import('pizzip')
  const xml = new PizZip(fs.readFileSync(target)).file('word/document.xml').asText()
  assert.match(xml, /施工部位：\{\{现场负责人\}\}/, '点选位置新增的占位符应写在锚点后，而不是文末')
})

test('私人模板优先于专业和通用模板参与生成解析', async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-private-template-'))
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模版.docx')

  await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'global', projectType: '通用', name: '通用版本' })
  const personal = await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'personal', projectType: '通用', name: '我的私人版本' })
  const resolved = resolveLibraryTemplate(userDataPath, { docType: '监理日志', projectType: '土建工程' })

  assert.equal(resolved.id, personal.id)
  assert.equal(resolved.scope, 'personal')
})

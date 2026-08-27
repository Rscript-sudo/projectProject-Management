import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getTemplatePlaceholders, saveDocxTemplatePlaceholders } from '../electron/templateService.mjs'
import { deleteProfessionalCategory, deleteTemplateFromLibrary, importTemplateToLibrary, listTemplateLibrary, markTemplateRuleConfigured, resolveLibraryTemplate, updateTemplateInLibrary } from '../electron/templateRegistry.mjs'

test('模板占位符可新增、删除并真实写回 DOCX', async t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-edit-'))
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))
  const target = path.join(runtimeDir, 'editable.docx')
  fs.copyFileSync(path.resolve('templates/通用/01_监理日志/监理日志模板.docx'), target)

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

test('空白表格单元格可按表格坐标写入占位符', async t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-cell-edit-'))
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))
  const target = path.join(runtimeDir, 'cell-editable.docx')
  fs.copyFileSync(path.resolve('templates/通用/01_监理日志/监理日志模板.docx'), target)

  await saveDocxTemplatePlaceholders(target, {
    addFields: ['空白单元格字段'],
    placements: [{ field: '空白单元格字段', position: 'after', tableIndex: 0, rowIndex: 0, cellIndex: 0 }],
  })

  const { default: PizZip } = await import('pizzip')
  const xml = new PizZip(fs.readFileSync(target)).file('word/document.xml').asText()
  const firstTable = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/)?.[0] || ''
  const firstCell = firstTable.match(/<w:tc\b[\s\S]*?<\/w:tc>/)?.[0] || ''
  assert.match(firstCell, /\{\{空白单元格字段\}\}/)
})

test('私人模板优先于专业和通用模板参与生成解析', async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-private-template-'))
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模板.docx')

  const global = await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'global', projectType: '通用', name: '通用版本' })
  const personal = await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'personal', projectType: '通用', name: '我的私人版本' })
  markTemplateRuleConfigured(userDataPath, global.id)
  markTemplateRuleConfigured(userDataPath, personal.id)
  const resolved = resolveLibraryTemplate(userDataPath, { docType: '监理日志', projectType: '土建工程' })

  assert.equal(resolved.id, personal.id)
  assert.equal(resolved.scope, 'personal')
})

test('用户模板独立记录规则完成状态，替换源文件后自动失效', async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-rule-state-'))
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模板.docx')
  const replacementPath = path.resolve('templates/通用/02_监理周报/监理周报模板.docx')
  const entry = await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'personal', projectType: '通用', name: '规则状态模板' })

  assert.equal(entry.aiRuleConfiguredAt, undefined)
  const marked = markTemplateRuleConfigured(userDataPath, entry.id)
  assert.equal(marked.ok, true)
  assert.ok(marked.template.aiRuleConfiguredAt)

  const replaced = await updateTemplateInLibrary(userDataPath, entry.id, { sourcePath: replacementPath })
  assert.equal(replaced.ok, true)
  assert.equal(replaced.template.aiRuleConfiguredAt, undefined)
})

test('删除用户模板先移到系统废纸篓，成功后才移除登记', async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-trash-'))
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模板.docx')
  const entry = await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'personal', projectType: '通用', name: '待删除模板' })
  markTemplateRuleConfigured(userDataPath, entry.id)
  let trashedPath = ''

  const failed = await deleteTemplateFromLibrary(userDataPath, entry.id, {
    trashItem: async () => { throw new Error('模拟废纸篓不可用') },
  })
  assert.equal(failed.ok, false)
  assert.equal(resolveLibraryTemplate(userDataPath, { docType: '监理日志', projectType: '通用', selectedTemplateId: entry.id })?.id, entry.id, '移入废纸篓失败时不得先删登记')

  const result = await deleteTemplateFromLibrary(userDataPath, entry.id, {
    trashItem: async filePath => { trashedPath = filePath; fs.renameSync(filePath, `${filePath}.trash`) },
  })

  assert.equal(result.ok, true)
  assert.equal(trashedPath, entry.path)
  assert.equal(resolveLibraryTemplate(userDataPath, { docType: '监理日志', projectType: '通用', selectedTemplateId: entry.id }), null)
})

test('删除专业会整体移走目录并清除该专业全部模板登记', async t => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-professional-trash-'))
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))
  const sourcePath = path.resolve('templates/通用/01_监理日志/监理日志模板.docx')
  await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理日志', scope: 'professional', projectType: '通信工程' })
  await importTemplateToLibrary({ userDataPath, sourcePath, docType: '监理周报', scope: 'professional', projectType: '通信工程' })
  let trashedDirectory = ''

  const result = await deleteProfessionalCategory(userDataPath, '通信工程', {
    trashItem: async directory => { trashedDirectory = directory; fs.renameSync(directory, `${directory}.trash`) },
  })

  assert.equal(result.ok, true)
  assert.equal(result.removedTemplates, 2)
  assert.match(trashedDirectory, /专业模板[/\\]通信工程$/)
  assert.equal(listTemplateLibrary(userDataPath).filter(item => item.scope === 'professional').length, 0)
})

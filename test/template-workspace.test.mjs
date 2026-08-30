import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanTemplateDocType, deleteTemplateCategory, listTemplateLibrary, normalizeTemplateLibrary } from '../electron/templateRegistry.mjs'
import { archiveLegacyTemplateLibrary, archiveUnapprovedGeneralTemplates, configureTemplateWorkspace, ensureTemplateCategory, listTemplateCategories } from '../electron/templateWorkspace.mjs'

test('安装后模板统一迁移到用户文档目录并使用中文分类和正式文件名', t => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-workspace-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  const userDataPath = path.join(runtime, 'user-data')
  const documentsPath = path.join(runtime, 'Documents')
  const legacyDir = path.join(userDataPath, 'template-library', 'personal', '通用', '监理日志')
  fs.mkdirSync(legacyDir, { recursive: true })
  const legacyTemplate = path.join(legacyDir, 'tpl_english_监理日志模版.docx')
  fs.copyFileSync(path.resolve('templates/通用/01_监理日志/监理日志模板.docx'), legacyTemplate)
  fs.writeFileSync(path.join(userDataPath, 'template-library', 'template-registry.json'), JSON.stringify({
    version: 1,
    templates: [{ id: 'tpl_legacy', name: '我的变体', docType: '监理日志', scope: 'personal', projectType: 'unclassified', projectTypeLabel: '通用', path: legacyTemplate, sourceName: path.basename(legacyTemplate), updatedAt: '2026-08-27T00:00:00.000Z' }],
  }))

  const workspace = configureTemplateWorkspace({ userDataPath, documentsPath, bundledTemplatesDir: path.resolve('templates') })
  normalizeTemplateLibrary(userDataPath)
  const archived = archiveLegacyTemplateLibrary()
  const [entry] = listTemplateLibrary(userDataPath)

  assert.equal(workspace.root, path.join(documentsPath, '项目文档管理系统', '模板库'))
  assert.ok(fs.existsSync(path.join(workspace.root, '内置模板', '通用', '01_监理日志', '监理日志模板.docx')))
  assert.equal(path.basename(entry.path), '监理日志模板.docx')
  assert.match(entry.path, /私人模板[/\\]通用[/\\]监理日志/)
  assert.deepEqual(fs.readdirSync(path.dirname(entry.path)).filter(name => /\.(docx|xlsx)$/i.test(name)), ['监理日志模板.docx'])
  assert.equal(archived.archived, true)
  assert.ok(fs.existsSync(archived.target))
})

test('模板文种名称会清除迁移尾码、重复词和错别字', () => {
  assert.equal(cleanTemplateDocType('电源工程现场勘察记录DYk'), '电源工程现场勘察记录')
  assert.equal(cleanTemplateDocType('工程安装质量检查检查表'), '工程安装质量检查表')
  assert.equal(cleanTemplateDocType('软件安装调试纪录'), '软件安装调试记录')
  assert.equal(cleanTemplateDocType('BIM检查表'), 'BIM检查表')
})

test('通用目录把未验收重复底稿移入清理归档，同时保留用户登记模板', t => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-cleanup-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  const userDataPath = path.join(runtime, 'user-data')
  const documentsPath = path.join(runtime, 'Documents')
  const bundledTemplatesDir = path.join(runtime, 'bundled')
  const bundledGeneral = path.join(bundledTemplatesDir, '通用', '01_监理日志')
  fs.mkdirSync(bundledGeneral, { recursive: true })
  const approved = path.join(bundledGeneral, '监理日志模板.docx')
  const duplicate = path.join(bundledGeneral, '监理日志模板.xlsx')
  fs.writeFileSync(approved, 'approved')
  fs.writeFileSync(duplicate, 'duplicate')
  const workspace = configureTemplateWorkspace({ userDataPath, documentsPath, bundledTemplatesDir })
  const userTemplate = path.join(workspace.root, '内置模板', '通用', '用户模板', '自定义模板.docx')
  fs.mkdirSync(path.dirname(userTemplate), { recursive: true })
  fs.writeFileSync(userTemplate, 'user')

  const result = archiveUnapprovedGeneralTemplates({ approvedPaths: [approved], protectedPaths: [userTemplate] })
  assert.equal(result.archived, 1)
  assert.ok(fs.existsSync(path.join(workspace.root, '内置模板', '通用', '01_监理日志', '监理日志模板.docx')))
  assert.ok(fs.existsSync(userTemplate))
  assert.ok(result.targets[0].includes('清理归档'))
})

test('自定义模板文件夹可创建、列出并安全移到废纸篓', async t => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-template-category-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  const userDataPath = path.join(runtime, 'user-data')
  const documentsPath = path.join(runtime, 'Documents')
  configureTemplateWorkspace({ userDataPath, documentsPath, bundledTemplatesDir: path.resolve('templates') })

  const created = ensureTemplateCategory(userDataPath, 'other', '水利专用表单')
  assert.ok(fs.existsSync(created.directory))
  assert.deepEqual(listTemplateCategories(userDataPath, 'other').map(item => item.name), ['水利专用表单'])

  const trashDir = path.join(runtime, 'trash')
  const deleted = await deleteTemplateCategory(userDataPath, 'other', '水利专用表单', {
    trashItem: async target => fs.renameSync(target, trashDir),
  })
  assert.equal(deleted.ok, true)
  assert.ok(fs.existsSync(trashDir))
  assert.deepEqual(listTemplateCategories(userDataPath, 'other'), [])
})

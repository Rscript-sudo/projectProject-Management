import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import path from 'node:path'
import { listSystemTemplates, renderTemplate, renderXlsxTemplate } from '../electron/templateService.mjs'
import { loadXlsx } from '../electron/xlsxRuntime.mjs'

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

    const configPath = path.join(path.dirname(template.path), 'config.json')
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}
    const promptText = `${prompts[docType].systemTemplate}\n${prompts[docType].userTemplate}`
    for (const field of template.fields) {
      const source = config.placeholders?.[`{{${field}}}`]?.source
      const hasNonAiSource = source === 'env' || source === 'computed'
      assert.ok(hasNonAiSource || promptText.includes(`【${field}】`), `${docType}.${field} 缺少数据来源或 AI 扩写规则`)
    }
  }
})

test('通用模板不得用默认值补造用户未提供的业务事实', async () => {
  const templates = await listSystemTemplates('templates')
  for (const template of templates) {
    const configPath = path.join(path.dirname(template.path), 'config.json')
    if (!fs.existsSync(configPath)) continue
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    for (const [placeholder, rule] of Object.entries(config.placeholders || {})) {
      if (!rule?.default) continue
      assert.equal(
        rule.default,
        'TODAY',
        `${template.docType}.${placeholder} 存在会补造事实的默认值：${rule.default}`,
      )
    }
  }
})

test('所有通用模板都能按实体文件完成占位符渲染', async () => {
  const templates = await listSystemTemplates('templates')
  for (const template of templates) {
    const data = Object.fromEntries(template.fields.map(field => [field, `${field}测试值`]))
    if (template.path.endsWith('.xlsx')) {
      const config = JSON.parse(fs.readFileSync(path.join(path.dirname(template.path), 'config.json'), 'utf8'))
      const names = Object.keys(config.placeholders || {}).map(key => key.replace(/^\{\{|\}\}$/g, '').trim())
      const mappings = (config.placeholder_cells || []).map((cell, index) => ({ cell, field: names[index] }))
      const buffer = await renderXlsxTemplate(template.path, data, mappings)
      assert.ok(buffer?.length > 0, `${template.docType} 未生成 XLSX`)
      const XLSX = await loadXlsx()
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      for (const { cell, field } of mappings) {
        assert.equal(String(worksheet[cell]?.v || ''), `${field}测试值`, `${template.docType}.${field} 未写入 ${cell}`)
      }
    } else {
      const buffer = await renderTemplate(template.path, data)
      assert.ok(buffer?.length > 0, `${template.docType} 未生成 DOCX`)
      const PizZip = (await import('pizzip')).default
      const xml = new PizZip(buffer).file('word/document.xml')?.asText() || ''
      assert.doesNotMatch(xml, /\{\{[^}]+\}\}/, `${template.docType} 生成后仍残留占位符`)
    }
  }
})

test('XLSX 字段没有事实时也会清除对应模板占位符', async () => {
  const template = (await listSystemTemplates('templates')).find(item => item.docType === '工程变更单')
  const config = JSON.parse(fs.readFileSync(path.join(path.dirname(template.path), 'config.json'), 'utf8'))
  const names = Object.keys(config.placeholders || {}).map(key => key.replace(/^\{\{|\}\}$/g, '').trim())
  const mappings = config.placeholder_cells.map((cell, index) => ({ cell, field: names[index] }))
  const buffer = await renderXlsxTemplate(template.path, { 项目名称: '空字段清理测试', 致单位: '测试单位' }, mappings)
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  for (const worksheet of Object.values(workbook.Sheets)) {
    for (const [cellRef, cell] of Object.entries(worksheet)) {
      if (cellRef.startsWith('!')) continue
      assert.doesNotMatch(String(cell?.v || ''), /\{\{[^{}]+\}\}/, `${cellRef} 不得残留占位符`)
    }
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import PizZip from 'pizzip'
import { renderTemplate } from '../electron/templateService.mjs'
import {
  extractTemplateLayoutContract,
  getTemplateLayoutContractPath,
  loadOrCreateTemplateLayoutContract,
  resetTemplateLayoutContract,
  saveTemplateLayoutContract,
  validateRenderedTemplateAssets,
} from '../electron/templateLayoutContract.mjs'

const sourceTemplate = path.resolve('templates/通用/06_工程联系单/工程联系单模板.docx')

test('导入 DOCX 时自动提取版式合同、字段格式和受保护资产', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-layout-contract-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const templatePath = path.join(tempDir, '联系单模板.docx')
  fs.copyFileSync(sourceTemplate, templatePath)
  const contract = await extractTemplateLayoutContract(templatePath, { docType: '工程联系单', write: true })
  assert.equal(contract.schemaVersion, 1)
  assert.equal(contract.docType, '工程联系单')
  assert.ok(contract.templateHash)
  assert.ok(contract.fields['正文内容'])
  assert.equal(contract.fields['正文内容'].mode, 'inherit')
  assert.ok(Object.keys(contract.protectedAssets).some(name => name.startsWith('word/media/')))
  assert.ok(fs.existsSync(getTemplateLayoutContractPath(templatePath)))
})

test('模板文件变化后旧版式合同自动失效并重新提取', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-layout-refresh-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const templatePath = path.join(tempDir, '联系单模板.docx')
  fs.copyFileSync(sourceTemplate, templatePath)
  const first = await loadOrCreateTemplateLayoutContract(templatePath, { docType: '工程联系单', write: true })
  const zip = new PizZip(fs.readFileSync(templatePath))
  zip.file('docProps/custom.xml', '<changed/>')
  fs.writeFileSync(templatePath, zip.generate({ type: 'nodebuffer' }))
  const second = await loadOrCreateTemplateLayoutContract(templatePath, { docType: '工程联系单', write: true })
  assert.notEqual(first.contract.templateHash, second.contract.templateHash)
  assert.equal(second.status, 'regenerated')
})

test('正式渲染必须保持页眉页脚和 Logo 资产不变', async () => {
  const contract = await extractTemplateLayoutContract(sourceTemplate, { docType: '工程联系单', write: false })
  const rendered = await renderTemplate(sourceTemplate, { 项目名称: '测试项目', 文件编号: 'LX-001', 致单位: '测试单位', 事由: '测试', 正文内容: '第一段。\n第二段。' })
  assert.deepEqual(await validateRenderedTemplateAssets(rendered, contract), { valid: true, missing: [], changed: [] })

  const zip = new PizZip(rendered)
  const mediaName = Object.keys(contract.protectedAssets).find(name => name.startsWith('word/media/'))
  zip.file(mediaName, Buffer.from('tampered'))
  const invalid = await validateRenderedTemplateAssets(zip.generate({ type: 'nodebuffer' }), contract)
  assert.equal(invalid.valid, false)
  assert.ok(invalid.changed.includes(mediaName))
})

test('版式合同覆盖项进入 DOCX 渲染且不改变受保护资产', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-layout-override-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const templatePath = path.join(tempDir, '联系单模板.docx')
  fs.copyFileSync(sourceTemplate, templatePath)
  const original = await extractTemplateLayoutContract(templatePath, { docType: '工程联系单', write: true })
  const saved = await saveTemplateLayoutContract(templatePath, {
    fields: {
      正文内容: {
        mode: 'contract',
        collapseBlankLines: true,
        override: {
          font: '宋体', fontSize: 13, bold: true, alignment: 'both',
          lineSpacing: 22, lineRule: 'exact', firstLineIndent: 26,
        },
      },
    },
  })
  assert.equal(saved.fields['正文内容'].mode, 'contract')
  const rendered = await renderTemplate(templatePath, {
    项目名称: '测试项目', 文件编号: 'LX-002', 致单位: '测试单位', 事由: '测试', 正文内容: '覆盖后的正文。',
  }, { layoutContract: saved })
  assert.deepEqual(await validateRenderedTemplateAssets(rendered, original), { valid: true, missing: [], changed: [] })
  const xml = new PizZip(rendered).file('word/document.xml').asText()
  assert.match(xml, /w:eastAsia="宋体"/)
  assert.match(xml, /<w:sz w:val="26"\/?>/)
  assert.match(xml, /<w:jc w:val="both"\/?>/)
  assert.match(xml, /<w:spacing[^>]*w:line="440"[^>]*w:lineRule="exact"/)
  assert.match(xml, /<w:ind[^>]*w:firstLine="520"/)
  assert.match(xml, /<w:b\/>/)

  const reset = await resetTemplateLayoutContract(templatePath, { docType: '工程联系单' })
  assert.equal(reset.fields['正文内容'].mode, 'inherit')
})

test('手工填写字段不被 AI 或默认值自动写入', async () => {
  const contract = await extractTemplateLayoutContract(sourceTemplate, { docType: '工程联系单', write: false })
  contract.fields['正文内容'].mode = 'manual'
  const rendered = await renderTemplate(sourceTemplate, {
    项目名称: '测试项目', 文件编号: 'LX-003', 致单位: '测试单位', 事由: '测试', 正文内容: '这段文字不应写入。',
  }, { layoutContract: contract })
  const xml = new PizZip(rendered).file('word/document.xml').asText()
  assert.doesNotMatch(xml, /这段文字不应写入/)
})

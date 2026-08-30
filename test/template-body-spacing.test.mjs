import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import PizZip from 'pizzip'
import { renderTemplate, sanitizeBodyContent } from '../electron/templateService.mjs'

test('实体模板正文替换前折叠连续空行，避免 docxtemplater 生成双软回车', () => {
  const source = '第一段正文。\n\n   \n第二段正文。\r\n\r\n三、报送要求\n\n具体要求。'
  const normalized = sanitizeBodyContent(source, '信息化')
  assert.equal(normalized, '第一段正文。\n第二段正文。\n三、报送要求\n具体要求。')
  assert.doesNotMatch(normalized, /\n{2,}/)
})

test('实体模板正文保留单换行和段内普通空格', () => {
  const normalized = sanitizeBodyContent('一、事项\n请提交 A 类资料。', '信息化')
  assert.equal(normalized, '一、事项\n请提交 A 类资料。')
})

test('占位符实际渲染后不产生连续软回车空白行', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-body-spacing-'))
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  const templatePath = path.join(tempDir, 'template.docx')
  const template = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('{{正文内容}}')] })] }] })
  fs.writeFileSync(templatePath, await Packer.toBuffer(template))

  const value = sanitizeBodyContent('第一段。\n\n第二段。\n\n\n第三段。', '信息化')
  const rendered = await renderTemplate(templatePath, { 正文内容: value })
  const xml = new PizZip(rendered).file('word/document.xml')?.asText() || ''
  assert.doesNotMatch(xml, /<w:br\/><w:br\/>/)
  assert.equal((xml.match(/<w:br\/>/g) || []).length, 2)
})

test('实体模板替换占位符后完整保留页眉页脚和媒体资产', async () => {
  const templatePath = path.resolve('templates/通用/06_工程联系单/工程联系单模板.docx')
  const sourceZip = new PizZip(fs.readFileSync(templatePath))
  const rendered = await renderTemplate(templatePath, {
    项目名称: '模板资产回归测试项目',
    文件编号: 'TEST-LX-001',
    致单位: '测试施工单位',
    事由: '模板资产回归测试',
    正文内容: sanitizeBodyContent('第一段。\n\n第二段。', '信息化'),
  })
  const resultZip = new PizZip(rendered)
  const assetNames = Object.keys(sourceZip.files).filter(name => /^word\/(?:header\d+\.xml|footer\d+\.xml|media\/)/.test(name))
  assert.ok(assetNames.length > 0, '联系单模板应包含页眉、页脚或 Logo 资产')
  for (const name of assetNames) {
    assert.ok(resultZip.file(name), `渲染后丢失模板资产：${name}`)
    assert.deepEqual(resultZip.file(name).asUint8Array(), sourceZip.file(name).asUint8Array(), `渲染时改写了模板资产：${name}`)
  }
})

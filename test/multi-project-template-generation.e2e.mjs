import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-multi-project-doc-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

async function makeVariantTemplate(sourcePath, targetPath, fieldName) {
  const { default: PizZip } = await import('pizzip')
  const zip = new PizZip(fs.readFileSync(sourcePath))
  const xml = zip.file('word/document.xml').asText().replaceAll('集采部分内容', fieldName)
  zip.file('word/document.xml', xml)
  fs.writeFileSync(targetPath, zip.generate({ type: 'nodebuffer' }))
}

function weeklyContent(specialField, specialValue) {
  const entries = {
    日期范围: '2026年8月10日至2026年8月16日', 周数: '第33周', 形象进度说明: '本周完成现场检查与资料核验。',
    [specialField]: specialValue, 非集采部分内容: '非集采内容已按计划核验。', 到货安装统计: '到货及安装数据已登记。',
    安全质量描述: '现场安全质量情况正常。', 存在问题: '资料签认时间待建设单位确认。', 下周计划: '继续开展验收准备与资料复核。',
    周进度详情: '本周已完成设备安装抽检、功能测试见证和资料复核。',
    监理建议: '建议施工单位按计划提交完整验收资料。', 图1路径: '', 图1说明: '',
    图2路径: '', 图2说明: '', 图3路径: '', 图3说明: '',
    图4路径: '', 图4说明: '',
  }
  // 满足周报最低字数校验，同时保持每个字段可独立验证。
  return Object.entries(entries).map(([key, value]) => `【${key}】${value}`).join('\n').repeat(10)
}

async function xmlOf(filePath) {
  const { default: PizZip } = await import('pizzip')
  return new PizZip(fs.readFileSync(filePath)).file('word/document.xml').asText()
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const root = path.join(runtimeDir, 'projects')
  const docType = '监理周报'
  const base = path.resolve('templates/通用/02_监理周报/监理周报模板.docx')
  const variants = [
    { name: '企业通用周报', scope: 'global', projectType: '通用', field: '通用重点事项', value: '通用项目周报内容已写入' },
    { name: '通信工程周报', scope: 'professional', projectType: '通信工程', field: '通信专业事项', value: '通信项目设备联调内容已写入' },
    { name: '信息化工程周报', scope: 'professional', projectType: '信息化工程', field: '信息化专业事项', value: '信息化项目系统测试内容已写入' },
  ]

  for (const variant of variants) {
    variant.path = path.join(runtimeDir, `${variant.name}.docx`)
    await makeVariantTemplate(base, variant.path, variant.field)
    variant.result = await call('fs:importTemplateToLibrary', { sourcePath: variant.path, docType, scope: variant.scope, projectType: variant.projectType, name: variant.name })
    assert.equal(variant.result.success, true)
    assert.ok(variant.result.template.fields.includes(variant.field), `${variant.name} 应识别其特有字段`)
  }

  const projects = [
    { name: '通信多模板测试项目', type: '通信工程', field: '通信专业事项', value: variants[1].value, template: variants[1] },
    { name: '信息化多模板测试项目', type: '信息化工程', field: '信息化专业事项', value: variants[2].value, template: variants[2] },
    { name: '通用多模板测试项目', type: '通用', field: '通用重点事项', value: variants[0].value, template: variants[0] },
  ]
  for (const project of projects) {
    const created = await call('fs:createProject', root, project.name, project.type)
    assert.equal(created.success, true)
    project.path = created.path
    const contract = await call('fs:getProjectTemplateContract', project.path, docType)
    assert.equal(contract.templateId, project.template.result.template.id, `${project.type} 应自动匹配正确模板`)
    const saved = await call('fs:saveDoc', { projectPath: project.path, projectName: project.name, docType, userInput: '多模板生成验证', customSummary: '多模板生成验证', content: weeklyContent(project.field, project.value) })
    assert.equal(saved.success, true, saved.error)
    const xml = await xmlOf(saved.path)
    assert.ok(xml.includes(project.value), `${project.name} 生成文件应写入对应模板字段`)
    assert.equal(xml.includes('{{'), false, `${project.name} 生成文件不得残留占位符`)
  }

  // 再验证：单个通信项目上传独立模板后，不改变信息化与通用项目的模板选择或生成内容。
  const telecom = projects[0]
  const specialPath = path.join(runtimeDir, '通信项目专属周报.docx')
  await makeVariantTemplate(base, specialPath, '通信项目专属事项')
  const assigned = await call('fs:assignProjectTemplate', telecom.path, docType, specialPath)
  assert.equal(assigned.success, true)
  const telecomContract = await call('fs:getProjectTemplateContract', telecom.path, docType)
  assert.equal(telecomContract.source, 'project')
  assert.ok(telecomContract.fields.includes('通信项目专属事项'))
  const specialSaved = await call('fs:saveDoc', { projectPath: telecom.path, projectName: telecom.name, docType, userInput: '项目专属模板验证', customSummary: '项目专属模板验证', content: weeklyContent('通信项目专属事项', '仅通信项目使用的专属周报内容') })
  assert.equal(specialSaved.success, true, specialSaved.error)
  assert.ok((await xmlOf(specialSaved.path)).includes('仅通信项目使用的专属周报内容'))
  const otherContract = await call('fs:getProjectTemplateContract', projects[1].path, docType)
  assert.equal(otherContract.templateId, variants[2].result.template.id, '通信项目专属模板不得影响信息化项目')

  closeDb()
  console.log('MULTI-PROJECT TEMPLATE GENERATION E2E PASS: 3 types / 3 variants / auto + override + DOCX output')
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  if (process.env.KEEP_TEST_OUTPUT) console.log('KEPT TEST OUTPUT:', runtimeDir)
  else fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

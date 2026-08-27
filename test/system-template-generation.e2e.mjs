import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-system-template-generation-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

function documentBody(docType, minimum) {
  const seed = `本次信息化文档验收以项目实际资料为准。监理机构依据现行规范、设计文件、合同约定和已报审资料，对质量、进度、安全、资料及协调事项实施全过程控制。施工单位应落实责任人、完成时限和复核记录；涉及现场事实、工程量、日期及签字盖章的信息，均须由项目人员核实后签发。`
  const repeat = Math.ceil((minimum + 120) / seed.length)
  return seed.repeat(repeat)
}

function structuredContent(docType, minimum, fields) {
  const values = {
    '项目名称': '信息化文档生成验收项目',
    '建设单位': '测试建设单位',
    '施工单位': '测试施工单位',
    '监理单位': '测试监理单位',
    '总监理工程师': '测试总监',
    '日期': '2026年08月13日',
    '文件编号': 'TEST-202608-001',
    '事由': `${docType}信息化生成验收`,
    '主题': `${docType}信息化生成验收`,
    '正文内容': documentBody(docType, minimum),
    '内容': documentBody(docType, minimum),
    // AI 规则可能包含项目资料字段之外的扩写字段，测试输入统一覆盖常用字段。
    '施工部位': '信息化机房及网络设备区',
    '参与人员': '总监理工程师、专业监理工程师、施工单位项目负责人',
    '今日内容': documentBody(docType, minimum),
    '核心工作落实': documentBody(docType, minimum),
    '协调解决情况': documentBody(docType, minimum),
    '其他事项': documentBody(docType, minimum),
    '日期范围': '2026年08月10日至2026年08月16日',
    '周数': '第33周',
    '形象进度说明': documentBody(docType, minimum),
    '周进度详情': documentBody(docType, minimum),
    '安全质量描述': documentBody(docType, minimum),
    '存在问题': '本期未发现需签发整改通知的事项。',
    '下周计划': documentBody(docType, minimum),
    '监理建议': documentBody(docType, minimum),
    '月份': '2026年08月',
    '本月进度详情': documentBody(docType, minimum),
    '本月质量描述': documentBody(docType, minimum),
    '本月安全描述': documentBody(docType, minimum),
    '监理履职情况': documentBody(docType, minimum),
    '报告期': '2026年08月',
    '总体进度': '以已确认的项目进度台账为准。',
    '进度偏差': '本期未发现已确认的进度偏差。',
    '偏差原因': '无。',
    '风险提示': '持续关注设备到货和接口联调计划。',
    '建议措施': documentBody(docType, minimum),
  }
  for (const field of fields) {
    if (!values[field]) values[field] = `${field}：已按项目资料填写。`
  }
  return Object.entries(values).map(([key, value]) => `【${key}】${value}`).join('\n')
}

async function docxXml(filePath) {
  const { default: PizZip } = await import('pizzip')
  const zip = new PizZip(fs.readFileSync(filePath))
  return zip.file('word/document.xml')?.asText() || ''
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  const { getSubDir } = await import('../electron/ipc/filename.mjs')
  const { getMinWordCount } = await import('../electron/ipc/docValidation.mjs')
  registerAll(ipcMain, null)

  const root = path.join(runtimeDir, 'projects')
  const projectName = '信息化文档全量验收项目'
  const created = await call('fs:createProject', root, projectName, '信息化工程', { projectTags: ['机房', '网络'], projectFeatures: '通用信息化模板验收' })
  assert.equal(created.success, true, created.error)
  await call('fs:writeProjectConfig', created.path, {
    projectType: '信息化工程', projectTypeCode: 'information', projectTags: ['机房', '网络'], projectFeatures: '通用信息化模板验收', projectCode: 'QA202608', ownerUnit: '测试建设单位', contractor: '测试施工单位',
    supervisorUnit: '测试监理单位', chiefEngineer: '测试总监',
  })

  const templates = await call('fs:listSystemTemplates')
  assert.ok(templates.length >= 15, `应发现不少于 15 个系统模板，实际 ${templates.length}`)
  const generated = []
  for (const template of templates) {
    const minimum = getMinWordCount(template.docType)
    const content = structuredContent(template.docType, minimum, template.fields)
    const saved = await call('fs:saveDoc', {
      projectPath: created.path,
      projectName,
      docType: template.docType,
      userInput: `${template.docType}信息化验收`,
      customSummary: `${template.docType}信息化验收`,
      content,
    })
    assert.equal(saved.success, true, `${template.docType}: ${saved.error || '保存失败'}`)
    assert.ok(fs.existsSync(saved.path), `${template.docType} 应已实际落盘`)
    assert.equal(path.extname(saved.path).toLowerCase(), path.extname(template.path).toLowerCase(), `${template.docType} 输出类型应与模板一致`)
    assert.ok(path.relative(created.path, saved.path).startsWith(getSubDir(template.docType)), `${template.docType} 应写入对应项目目录：${saved.path}`)
    if (path.extname(saved.path).toLowerCase() === '.docx') {
      const xml = await docxXml(saved.path)
      assert.equal(xml.includes('{{'), false, `${template.docType} 不得残留模板占位符`)
      // 个别规范长文模板没有项目名称占位符；该类模板仍须保证可渲染且无残留占位符。
      if (template.fields.includes('项目名称')) {
        assert.ok(xml.includes('信息化文档生成验收项目'), `${template.docType} 应写入项目名称`)
      }
      // 字体、表头和表格样式由实体模板自身决定；保存链路已通过模板版式验收。
    } else {
      const xlsxModule = await import('xlsx')
      const xlsx = xlsxModule.default || xlsxModule
      const workbook = xlsx.readFile(saved.path)
      assert.ok(workbook.SheetNames.length > 0, `${template.docType} Excel 应包含工作表`)
    }
    generated.push({ docType: template.docType, path: saved.path, extension: path.extname(saved.path).toLowerCase() })
  }

  closeDb()
  console.log(`SYSTEM TEMPLATE GENERATION E2E PASS: ${generated.length} templates`)
  for (const item of generated) console.log(`${item.docType}\t${item.path}`)
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  if (process.env.KEEP_TEST_OUTPUT) console.log('KEPT TEST OUTPUT:', runtimeDir)
  else fs.rmSync(runtimeDir, { recursive: true, force: true })
  // Electron 42.9+ 在批量打开 Office 文档后可能残留框架事件循环。
  // 测试资源已在 main 中关闭，直接结束隔离测试进程，避免 app.exit 停止兜底定时器后假性挂起。
  process.exit(process.exitCode || 0)
})

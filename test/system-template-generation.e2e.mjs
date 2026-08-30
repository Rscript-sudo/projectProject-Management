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

function structuredContent(docType, _minimum, fields) {
  const fullBody = `2026年8月13日，监理人员在信息化机房核对网络设备到货清单和安装记录。已到场设备12台，型号及数量与清单一致；其中2处设备标签与清单编号不一致，施工单位现场完成标签更正并提交复核记录。后续按照已确认的接口联调计划继续检查设备连线和记录完整性。`
  const values = {
    '项目名称': '信息化文档全量验收项目',
    '建设单位': '测试建设单位',
    '施工单位': '测试施工单位',
    '监理单位': '测试监理单位',
    '总监理工程师': '测试总监',
    '日期': '2026年08月13日',
    '文件编号': 'TEST-202608-001',
    '事由': `${docType}信息化生成验收`,
    '主题': `${docType}信息化生成验收`,
    '正文内容': fullBody,
    '内容': fullBody,
    // AI 规则可能包含项目资料字段之外的扩写字段，测试输入统一覆盖常用字段。
    '施工部位': '信息化机房及网络设备区',
    '参与人员': '总监理工程师、专业监理工程师、施工单位项目负责人',
    '今日内容': '完成12台网络设备到货清单、型号和安装位置核对，并检查设备标签。',
    '核心工作落实': '核对结果显示设备型号及数量与到货清单一致；2处标签编号不一致事项已更正并复核。',
    '协调解决情况': '施工单位现场完成2处设备标签更正，并提交对应复核记录。',
    '其他事项': '后续按照已确认的接口联调计划检查设备连线和记录完整性。',
    '日期范围': '2026年08月10日至2026年08月16日',
    '周数': '第33周',
    '形象进度说明': '本期完成12台网络设备到场核对和安装位置检查，设备标签问题已完成更正。',
    '周进度详情': '网络设备到货12台；已完成清单、型号、安装位置和标签核对。',
    '集采部分内容': '本期已核验的集采设备为网络设备12台，型号及数量与到货清单一致。',
    '非集采部分内容': '',
    '到货安装统计': '网络设备到货12台，已完成12台清单和安装位置核对。',
    '安全质量描述': '检查设备安装位置及标签，发现2处标签编号与清单不一致，现场更正后完成复核。',
    '存在问题': '发现2处设备标签编号与到货清单不一致，已现场更正并完成复核。',
    '下周计划': '按照已确认的接口联调计划检查设备连线和联调记录。',
    '监理建议': '联调时同步保留接口检查和问题复核记录。',
    '月份': '2026年08月',
    '本月进度详情': '本月完成12台网络设备到场核对和安装位置检查，2处标签问题已更正并复核。',
    '本月完成工程量': '网络设备到货及核对12台。',
    '累计完成情况': '本次测试资料仅确认本月12台设备数据，未提供项目累计工程量。',
    '本月投资情况': '',
    '本月质量描述': '设备型号及数量与清单一致；2处标签编号问题已更正并复核。',
    '本月安全描述': '本次资料未记录新增安全问题。',
    '监理履职情况': '完成到货清单、设备型号、安装位置及标签检查，并复核2处更正记录。',
    '报告期': '2026年08月',
    '总体进度': '以已确认的项目进度台账为准。',
    '进度偏差': '本期未发现已确认的进度偏差。',
    '偏差原因': '无。',
    '风险提示': '持续关注设备到货和接口联调计划。',
    '建议措施': '联调阶段同步核对设备连线和接口记录。',
    '项目概况': '本项目为信息化工程，本次验收范围为信息化机房网络设备到货、安装位置及标签记录核对。',
  }
  for (const field of fields) {
    if (!(field in values)) values[field] = ''
  }
  return fields.map(field => `【${field}】${values[field]}`).join('\n')
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
        assert.ok(xml.includes(projectName), `${template.docType} 应写入项目正式名称`)
      }
      // 字体、表头和表格样式由实体模板自身决定；保存链路已通过模板版式验收。
    } else {
      const xlsxModule = await import('xlsx')
      const xlsx = xlsxModule.default || xlsxModule
      const workbook = xlsx.readFile(saved.path)
      assert.ok(workbook.SheetNames.length > 0, `${template.docType} Excel 应包含工作表`)
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName]
        for (const [cellRef, cell] of Object.entries(worksheet)) {
          if (cellRef.startsWith('!')) continue
          assert.doesNotMatch(String(cell?.v || ''), /\{\{[^{}]+\}\}/, `${template.docType}.${sheetName}!${cellRef} 不得残留占位符`)
        }
      }
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

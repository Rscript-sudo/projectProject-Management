import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-civil-full-chain-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))
const handlers = new Map()
const ipcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
const call = async (channel, ...args) => handlers.get(channel)({}, ...args)

const projectName = '滨江花园住宅项目土建验收'
const profile = {
  projectTags: ['地基基础', '主体结构', '防水'],
  projectFeatures: '3栋18层住宅及地下1层车库，当前处于主体结构施工阶段；本周完成3号楼五层梁板钢筋绑扎、模板安装及混凝土浇筑。',
  projectPhase: '主体结构施工阶段',
}
const unitData = {
  projectCode: 'BJHY2026', ownerUnit: '滨江城市建设有限公司', contractor: '华建建筑工程有限公司', supervisorUnit: '公诚项目管理咨询有限公司', chiefEngineer: '王工',
}

const long = (text, minimum) => text.repeat(Math.ceil(minimum / text.length) + 1)
const docs = [
  ['监理日志', '日志', `【施工部位】3号楼五层梁板
【参与人员】监理2名，钢筋班组18人、木工班组14人、混凝土班组12人
【今日内容】上午完成五层梁板钢筋绑扎复核，下午完成模板安装检查并对梁板混凝土浇筑实施旁站。
【核心工作落实】核对梁板钢筋规格、间距、保护层垫块和箍筋加密区设置；检查模板支撑体系、拼缝和清扫口，混凝土浇筑过程中见证坍落度检测并巡视振捣及施工缝留置情况，发现问题已要求现场修正后复核。
【协调解决情况】施工单位已补齐局部保护层垫块并加固一处模板拼缝，经复核符合方案及设计要求。
【其他事项】安全巡视：检查临边防护、泵送作业区域和临时用电，未发现危及安全的情形。\n明日计划：复核五层混凝土养护和六层墙柱钢筋定位。`, 200],
  ['监理周报', '周报', `【周数】第33周
【日期范围】2026年08月10日至2026年08月16日
【形象进度说明】3号楼主体结构施工至五层梁板；地下车库完成局部顶板防水基层处理。
【周进度详情】${long('3号楼五层墙柱钢筋绑扎、模板安装、梁板钢筋绑扎和混凝土浇筑均按批准施工方案组织实施；地下车库顶板完成基层清理和阴阳角处理。', 260)}
【集采部分内容】${long('钢筋、水泥和商品混凝土进场资料齐全，已完成见证取样及外观检查，规格型号与报验资料一致。', 160)}
【非集采部分内容】${long('模板支撑材料、防水卷材及辅材按施工计划进场，施工单位已提交材料报验资料并完成现场验收。', 160)}
【到货安装统计】本周钢筋进场86吨、商品混凝土浇筑420立方米；上述数量来自施工单位日报，监理已复核报验单和浇筑记录。
【安全质量描述】${long('本周组织主体结构安全质量巡视4次、梁板钢筋隐蔽验收1次、混凝土浇筑旁站1次。重点核查临边防护、模板支撑、钢筋保护层和混凝土振捣，发现的局部垫块不足和模板拼缝问题均已整改复核。', 200)}
【存在问题】3号楼五层局部梁底保护层垫块设置不足，已于本周整改并复核；地下车库顶板防水基层局部浮灰已清理。
【下周计划】计划完成3号楼六层墙柱钢筋、模板及混凝土施工，持续开展混凝土养护和地下车库顶板防水施工旁站。
【监理建议】施工单位应继续落实模板支撑体系验收、钢筋隐蔽验收和混凝土浇筑旁站程序，防水施工前应完成基层验收记录。`, 1000],
  ['监理月报', '月报', `【月份】2026年08月
【日期范围】2026年08月01日至2026年08月31日
【形象进度说明】本月3号楼主体结构由四层推进至五层梁板，地下车库完成局部顶板防水基层处理。
【本月进度详情】${long('本月施工单位按进度计划完成3号楼四层至五层墙柱、梁板钢筋、模板和混凝土施工；地下车库组织顶板防水基层清理与阴阳角处理。监理机构对施工组织、材料报验、隐蔽验收和旁站记录实施跟踪。', 360)}
【本月完成工程量】本月完成钢筋绑扎约168吨、混凝土浇筑约860立方米；数据来自施工日报及浇筑记录，签发前由项目资料员复核。
【累计完成情况】累计完成至3号楼五层梁板，地下车库顶板防水施工准备完成。
【到货安装统计】钢筋、水泥、商品混凝土、防水卷材均已按批次报验；见证取样资料和合格证明已归档。
【本月投资情况】本月投资数据由建设单位和施工单位按合同计量资料核定，监理机构未对未报审金额作出确认。
【本月质量描述】${long('本月实施钢筋隐蔽验收、模板支撑检查、混凝土旁站和防水基层验收。对保护层垫块不足、模板拼缝不严和基层浮灰等问题签发口头指令并完成复核，相关记录已归档。', 260)}
【本月安全描述】${long('本月开展临边防护、临时用电、模板支撑和混凝土泵送作业巡视，要求施工单位落实班前安全交底和作业区警戒。未发生生产安全事故。', 220)}
【存在问题】局部钢筋保护层垫块和模板拼缝问题已整改；防水基层施工前仍须严格执行隐蔽验收。
【监理履职情况】监理机构完成旁站、巡视、平行检验、材料见证取样和资料核查，记录与报验资料同步归档。
【监理建议】建议施工单位保持主体结构施工节奏，防水卷材施工应加强基层验收、搭接宽度和成品保护控制。
【下月计划】${long('计划完成3号楼六层至七层主体结构施工，推进地下车库顶板防水和回填土施工；监理机构将继续执行材料报验、隐蔽验收、混凝土旁站和安全巡视，确保施工记录、试验资料、影像资料与现场进度同步。', 650)}`, 2000],
  ['进度分析报告', '汇报材料', `【项目代码】BJHY2026
【报告期】2026年08月
【总体进度】3号楼主体结构已完成至五层梁板，地下车库顶板防水基层处理完成局部工作面。
【进度偏差】与月度计划相比，3号楼五层混凝土浇筑按计划完成；地下车库防水基层处理受雨后基层含水率影响顺延1天。
【偏差原因】雨后基层未达到防水施工条件，施工单位按方案进行通风和含水率复核后恢复施工。
【风险提示】后续主体结构与防水工序交叉施工，应统筹材料进场、作业面移交和雨天施工安排。
【建议措施】监理机构建议施工单位动态更新周计划，防水施工前完成基层验收，主体混凝土浇筑前落实模板支撑和钢筋隐蔽验收。
【下月计划】完成3号楼六层至七层主体结构，推进地下车库顶板防水和回填土施工。`, 600],
  ['整改通知书', '整改通知', `【事由】五层梁板支撑整改
【致单位】华建建筑工程有限公司
【正文内容】一、检查情况
【依据：现场巡视记录】
监理人员在3号楼五层梁板模板支撑检查中发现，局部立杆底部垫板设置不连续，部分水平杆连接扣件紧固不足。

二、整改要求
1. 立即停止该局部区域后续混凝土浇筑准备作业，补齐立杆垫板并按专项方案复核水平杆、扫地杆和剪刀撑设置。
2. 对全部扣件逐点复紧，形成自检记录；整改完成后报项目监理机构复查。
3. 未经监理复查确认，不得进入下一道工序。

三、整改期限
请于2026年08月14日17时前完成整改并提交复查申请。${long('本通知所列问题涉及模板支撑体系稳定性，施工单位应由项目技术负责人、安全管理人员和施工班组共同复核。复核应覆盖立杆基础、扫地杆、水平杆、剪刀撑、扣件紧固和作业平台防护等内容；发现与专项方案不一致的部位应逐项整改并形成影像和书面记录。整改过程中应设置警戒区域，严禁无关人员进入。整改完成后，施工单位应提交自检记录、整改前后对比照片及复查申请；监理机构将依据专项施工方案、现场实测情况和相关验收记录组织复核。复核未通过前，不得进行混凝土浇筑或拆改支撑体系。', 650)}`, 800],
  ['安全通知书', '节假日通知', `【事由】国庆节前安全通知
【节日名称】国庆节
【放假日期】2026年10月01日至2026年10月07日
【正文内容】一、节前安全检查
施工单位应在节前组织模板支撑、脚手架、临边防护、临时用电、消防器材和材料堆放专项检查，形成检查记录并落实责任人。

二、值班与应急管理
节日期间落实项目负责人带班和值班制度，保持应急联络畅通；遇强降雨、大风等情况及时检查基坑排水、临边防护和临时设施。

三、复工要求
节后复工前完成安全教育、机械设备检查和作业条件确认，经自检合格后报监理机构复核。${long('施工单位应对节日期间留守区域、临时用电、材料堆放、消防通道、基坑排水和脚手架连接节点进行全面检查。项目负责人应明确节假日值班人员、巡查频次和紧急联络方式；值班记录应如实反映现场状况。对检查发现的问题，应明确责任人、整改措施和完成时限，未经整改验收不得复工。监理机构将结合节前检查、节中巡视和节后复工条件，对安全管理资料和现场实体进行复核。', 560)}`, 800],
  ['工程联系单', '联系单', `【主题】地下车库顶板防水基层验收安排
【致单位】滨江城市建设有限公司、华建建筑工程有限公司
【正文内容】${long('地下车库顶板防水施工前，施工单位已完成局部基层清理、阴阳角处理和排水坡度检查。为保证后续卷材施工质量，请建设单位、施工单位和监理机构于2026年08月15日上午共同进行基层验收；验收内容包括基层平整度、含水率、阴阳角处理、节点附加层和成品保护条件。验收时应核对基层表面是否平整、坚实、干燥，排水坡度是否满足设计要求，阴阳角是否做成圆弧或钝角，穿墙管和落水口等节点是否已完成附加层处理。施工单位应提交基层隐蔽验收记录、材料合格证明和施工方案交底记录；监理机构将对资料与现场实体进行核对。验收合格后方可进行下一道防水卷材施工，施工期间应避免交叉作业损坏基层和已完成防水层。', 680)}`, 800],
]

async function xml(filePath) {
  const { default: PizZip } = await import('pizzip')
  return new PizZip(fs.readFileSync(filePath)).file('word/document.xml')?.asText() || ''
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)
  const root = path.join(runtimeDir, 'projects')
  const created = await call('fs:createProject', root, projectName, '土建工程', profile)
  assert.equal(created.success, true, created.error)
  await call('fs:writeProjectConfig', created.path, { projectType: '土建工程', ...profile, ...unitData })
  const config = await call('fs:readProjectConfig', created.path)
  assert.equal(config.projectTypeCode, 'civil')
  assert.deepEqual(config.projectTags, profile.projectTags)

  // 实际进度表 → 本地解析 → 用户确认入账 → 实时数据源，覆盖周报/月报的可追溯链路。
  const xlsxModule = await import('xlsx')
  const XLSX = xlsxModule.default || xlsxModule
  const progressFile = path.join(runtimeDir, '八月施工进度表.xlsx')
  const progressBook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(progressBook, XLSX.utils.aoa_to_sheet([
    ['任务名称', '计划开始', '计划结束', '实际开始', '实际结束', '完成率', '权重'],
    ['3号楼五层梁板', '2026-08-01', '2026-08-15', '2026-08-02', '2026-08-16', '100%', 2],
    ['地下车库顶板防水', '2026-08-10', '2026-08-28', '2026-08-11', '', '40%', 1],
  ]), '八月计划')
  XLSX.writeFile(progressBook, progressFile)
  const parsedProgress = await call('material:parse', { filePath: progressFile })
  assert.equal(parsedProgress.success, true, parsedProgress.error)
  assert.equal(parsedProgress.progressCandidates.length, 2)
  assert.equal(parsedProgress.progressCandidates[1].source, '八月施工进度表.xlsx｜八月计划!3')
  assert.equal(parsedProgress.progressCandidates[1].sourceSheet, '八月计划')
  assert.equal(parsedProgress.progressCandidates[1].sourceRow, 3)
  const importedProgress = await call('material:importProgress', { projectPath: created.path, nodes: parsedProgress.progressCandidates, sourceFile: progressFile })
  assert.equal(importedProgress.success, true, importedProgress.error)
  assert.equal(importedProgress.count, 2)
  const progressData = await call('data:query', { projectName, toolIds: ['progress_summary'] })
  assert.equal(progressData.progress_summary.总节点数, 2)
  assert.equal(progressData.progress_summary.节点详情[1].进度, '40%')

  const results = []
  for (const [docType, label, content, min] of docs) {
    const saved = await call('fs:saveDoc', { projectPath: created.path, projectName, docType, userInput: label, customSummary: label, content })
    assert.equal(saved.success, true, `${docType}: ${saved.error}`)
    assert.ok(fs.existsSync(saved.path), `${docType} 未落盘`)
    if (saved.path.endsWith('.docx')) {
      const body = await xml(saved.path)
      assert.equal(/undefined|null|数据待核对|签发前请核对|项目类型校准声明|━━━━━━━━|\{\{/.test(body), false, `${docType} 交付文件含脏文本`)
      if (docType === '整改通知书') {
        assert.ok(body.includes('依据：现场巡视记录'), '整改通知书正文中的依据小标题不得被模板字段解析截断')
        assert.ok(body.includes('整改期限'), '整改通知书完整正文应写入 Word')
      }
    }
    results.push({ docType, path: saved.path, ext: path.extname(saved.path) })
  }
  const ledgers = await call('fs:getProjectLedgers', created.path)
  assert.ok(ledgers.log.items.length >= 3, `日志台账应至少含日志/周报/月报，实际 ${ledgers.log.items.length}`)
  assert.ok(ledgers.correspondence.items.length >= 3, `往来函件台账应至少含整改/安全/联系单，实际 ${ledgers.correspondence.items.length}`)
  console.log('CIVIL FULL CHAIN E2E PASS')
  for (const result of results) console.log(`${result.docType}\t${result.path}`)
  console.log(`LEDGER log=${ledgers.log.items.length} correspondence=${ledgers.correspondence.items.length}`)
  closeDb()
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 }).finally(() => {
  if (process.env.KEEP_TEST_OUTPUT) console.log('KEPT TEST OUTPUT:', runtimeDir)
  else fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

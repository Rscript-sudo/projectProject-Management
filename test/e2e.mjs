import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-e2e-'))
app.setPath('userData', path.join(runtimeDir, 'user-data'))

const handlers = new Map()
const ipcMain = {
  handle(channel, handler) {
    if (handlers.has(channel)) throw new Error(`重复注册 IPC：${channel}`)
    handlers.set(channel, handler)
  },
}
const call = async (channel, ...args) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册 IPC：${channel}`)
  return handler({}, ...args)
}
const resultData = result => {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.data)) return result.data
  if (result && typeof result === 'object' && 'success' in result) {
    const { success, ...data } = result
    return data
  }
  return result
}

async function main() {
  await app.whenReady()
  const { registerAll } = await import('../electron/ipc/register.mjs')
  const { closeDb } = await import('../electron/db/database.mjs')
  registerAll(ipcMain, null)

  const projectRoot = path.join(runtimeDir, 'projects')
  fs.mkdirSync(projectRoot, { recursive: true })
  const projectName = 'E2E测试项目803'
  const created = await call('fs:createProject', projectRoot, projectName, '信息化工程')
  assert.equal(created.success, true)
  const projectPath = created.path
  assert.ok(fs.existsSync(path.join(projectPath, '03_实施阶段', '01_监理日志')))

  const config = await call('fs:readProjectConfig', projectPath)
  assert.equal(config.projectType, '信息化工程')
  const written = await call('fs:writeProjectConfig', projectPath, {
    ...config, ownerUnit: '测试建设单位', contractor: '测试承建单位', supervisorUnit: '测试监理单位', chiefEngineer: '测试总监', contractAmount: 100000,
  })
  assert.equal(written.success, true)

  const participant = await call('db:saveMasterData', projectName, 'participant', {
    organization_type: '施工单位', organization_name: '原施工单位', contact_name: '张三', effective_from: '2026-08-01',
  })
  assert.equal(participant.success, true)
  assert.equal((await call('db:saveMasterData', projectName, 'member', { member_name: '测试总监', role: '总监理工程师', effective_from: '2026-08-01' })).success, true)
  assert.equal((await call('db:saveMasterData', projectName, 'structure', { structure_type: '单位工程', name: '机房工程', effective_from: '2026-08-01' })).success, true)
  assert.equal((await call('db:setProjectPhase', projectName, '实施阶段', '端到端验收', '2026-08-01')).success, true)

  const content = '项目资料已核对。'.repeat(30)
  const saved = await call('fs:saveDoc', {
    projectPath, subDir: '03_实施阶段/01_监理日志', docType: '通用文档', projectName,
    fileName: '用户输入污染文件名.docx', content, customSummary: '端到端测试', userInput: '生成测试文档', meta: { subject: '端到端测试' },
  })
  assert.equal(saved.success, true, saved.error)
  assert.ok(fs.existsSync(saved.path))
  assert.match(saved.fileName, /_DOC_PJ803_通用文档\.docx$/)
  assert.doesNotMatch(saved.fileName, /端到端测试/)
  const savedSnapshot = await call('db:getDocumentMasterSnapshot', saved.path)
  assert.equal(savedSnapshot.master_data.participants[0].organization_name, '原施工单位')
  const replacedParticipant = await call('db:saveMasterData', projectName, 'participant', {
    organization_type: '施工单位', organization_name: '新施工单位', contact_name: '李四', effective_from: '2026-08-15',
  }, participant.item.id)
  assert.equal(replacedParticipant.success, true)
  const activeParticipants = resultData(await call('db:listMasterData', projectName, 'participant'))
  assert.deepEqual(activeParticipants.map(item => item.organization_name), ['新施工单位'])
  const currentConfigFromMaster = await call('fs:readProjectConfig', projectPath)
  assert.equal(currentConfigFromMaster.contractor, '新施工单位')
  assert.equal(currentConfigFromMaster.chiefEngineer, '测试总监')
  assert.equal(currentConfigFromMaster.projectPhase, '实施阶段')
  const participantHistory = resultData(await call('db:listMasterData', projectName, 'participant', { includeHistory: true }))
  assert.equal(participantHistory.length, 2)
  const immutableSnapshot = await call('db:getDocumentMasterSnapshot', saved.path)
  assert.equal(immutableSnapshot.master_data.participants[0].organization_name, '原施工单位')
  assert.ok(resultData(await call('db:listMasterChanges', projectName, 20)).length >= 5)

  const templateContent = `【施工部位】机房设备区
【参与人员】总监理工程师、专业监理工程师、施工单位现场负责人
【今日内容】现场设备安装情况已核查，施工过程符合已报审资料要求。
【核心工作落实】复核设备安装质量、线缆标识和报验资料，已向施工单位提出完善要求。
【协调解决情况】施工单位确认当日补齐设备报验附件，监理机构后续复核。
【其他事项】次日继续复核机房设备安装及资料签认情况。`.repeat(3)
  const templated = await call('fs:saveDoc', {
    projectPath, docType: '监理日志', projectName,
    content: templateContent, customSummary: '模板渲染验证', userInput: '生成监理日志', meta: { subject: '模板渲染验证' },
  })
  assert.equal(templated.success, true, templated.error)
  assert.match(templated.fileName, /_JL-RZ_PJ803_监理日志\.docx$/)
  assert.doesNotMatch(templated.fileName, /模板渲染验证/)
  assert.ok(fs.existsSync(templated.path))

  const rebuilt = await call('search:rebuild')
  assert.equal(rebuilt.success, true)
  assert.ok(rebuilt.docCount >= 1)
  const searchResults = resultData(await call('search:query', '项目资料已核对'))
  assert.ok(searchResults.some(item => item.fileName.includes('通用文档')))

  const inspection = await call('inspection:save', {
    projectPath,
    record: { date: '2026-08-13', location: '机房', issues: [{ found: true, dimKey: 'electrical', dimensionName: '临电安全', label: '漏电保护器有效', description: '测试隐患', severity: '一般' }] },
  })
  assert.equal(inspection.success, true)
  assert.equal(inspection.hazardCount, 1)
  assert.ok(inspection.inspectionId)
  const inspectionRelations = resultData(await call('db:listBusinessRelations', projectName, 'inspection', inspection.inspectionId))
  assert.equal(inspectionRelations.length, 1)
  assert.equal(inspectionRelations[0].relation_type, 'inspection_finding')
  assert.equal(resultData(await call('inspection:list', { projectPath })).length, 1)
  assert.equal((await call('inspection:closeHazard', { hazardId: inspection.hazardIds[0] })).success, true)
  const overdueHazard = await call('db:insertHazard', { project_name: projectName, description: '逾期验收隐患', deadline: '2020-01-01', status: '待整改' })
  const completenessWithOverdue = await call('fs:scanProjectCompleteness', projectPath)
  assert.ok(completenessWithOverdue.issues.some(item => item.code === 'HAZARD_OVERDUE' && item.entityId === String(overdueHazard.id)))
  for (const mode of ['project', 'delivery', 'monthly']) {
    const exported = await call('fs:exportCompletenessReport', projectPath, mode)
    assert.equal(exported.success, true)
    assert.ok(fs.existsSync(exported.path))
    assert.match(fs.readFileSync(exported.path, 'utf8'), /E2E测试项目803/)
  }
  assert.equal((await call('db:updateHazardStatus', overdueHazard.id, '已关闭')).success, true)
  const completenessAfterRepair = await call('fs:scanProjectCompleteness', projectPath)
  assert.equal(completenessAfterRepair.issues.some(item => item.code === 'HAZARD_OVERDUE' && item.entityId === String(overdueHazard.id)), false)

  const progress = await call('progress:add', { projectPath, node: { name: '设备安装', plan_start: '2026-08-01', plan_end: '2026-08-31', progress_percent: 50 } })
  assert.equal(progress.success, true)
  assert.equal(resultData(await call('progress:list', projectPath)).length, 1)
  assert.equal(resultData(await call('progress:gantt', { projectPath, yearMonth: '2026-08' })).nodes.length, 1)

  const payment = await call('payment:add', { projectPath, payment: { period: '2026-08', amount: 1000, status: '审批中', approval_stage: '监理员', description: '端到端付款申请', related_nodes: [progress.id] } })
  assert.equal(payment.success, true)
  const paymentRelations = resultData(await call('db:listBusinessRelations', projectName, 'payment_request', payment.id))
  assert.equal(paymentRelations.length, 1)
  assert.equal(paymentRelations[0].target_id, String(progress.id))
  const protectedDelete = await call('progress:delete', { id: progress.id })
  assert.equal(protectedDelete.success, false)
  assert.equal(resultData(await call('payment:list', projectPath)).length, 1)
  for (let i = 0; i < 4; i++) assert.equal((await call('payment:advance', { id: payment.id, person: '测试人', opinion: '同意' })).success, true)
  assert.equal((await call('payment:summary', projectPath)).approvedAmount, 1000)

  const contract = await call('contract:add', { projectPath, contract: { contract_name: '测试合同', amount: 100000, status: '执行中', end_date: '2026-12-31' } })
  assert.equal(contract.success, true)
  assert.equal((await call('contract:dashboard', projectPath)).contractCount, 1)
  const change = await call('change:add', { projectPath, change: { subject: '测试变更', contract_id: contract.id, amount_change: 500 } })
  assert.equal(change.success, true)
  const changeRelations = resultData(await call('db:listBusinessRelations', projectName, 'change_order', change.id))
  assert.equal(changeRelations.length, 1)
  assert.equal(changeRelations[0].relation_type, 'contract_change')
  const contractPayment = await call('payment:add', { projectPath, payment: { period: '2026-09', amount: 500, contract_id: contract.id, description: '合同关联付款' } })
  assert.equal(contractPayment.success, true)
  const contractRelations = resultData(await call('db:listBusinessRelations', projectName, 'contract', contract.id))
  assert.equal(contractRelations.filter(item => item.relation_type === 'contract_change').length, 1)
  assert.equal(contractRelations.filter(item => item.relation_type === 'contract_payment').length, 1)

  const sourcePhoto = path.join(runtimeDir, 'source.jpg')
  fs.writeFileSync(sourcePhoto, 'not-a-real-photo-but-a-file')
  const photo = await call('photo:archive', { projectPath, srcPath: sourcePhoto, shootDate: '2026-08-13', location: '机房', description: '测试照片' })
  assert.equal(photo.success, true)
  assert.ok(fs.existsSync(photo.destPath))
  assert.equal((await call('photo:update', { id: photo.id, updates: { linked_hazard_id: inspection.hazardIds[0] } })).success, true)
  const photoRelations = resultData(await call('db:listBusinessRelations', projectName, 'photo', photo.id))
  assert.equal(photoRelations.length, 1)
  assert.equal(photoRelations[0].relation_type, 'hazard_evidence')
  const protectedPhotoDelete = await call('photo:delete', { id: photo.id })
  assert.equal(protectedPhotoDelete.success, false)
  const removedPhotoRelation = await call('db:deleteBusinessRelation', projectName, photoRelations[0].id)
  assert.equal(removedPhotoRelation.success, true)
  assert.equal(removedPhotoRelation.deleted, true)
  assert.equal((await call('photo:delete', { id: photo.id })).success, true)
  assert.equal(resultData(await call('photo:list', { projectPath, limit: 20 })).length, 0)

  const secondProject = await call('fs:createProject', projectRoot, '另一项目', '信息化工程')
  assert.equal(secondProject.success, true)
  const secondProgress = await call('progress:add', { projectPath: secondProject.path, node: { name: '跨项目节点' } })
  const rejectedCrossProject = await call('db:createBusinessRelation', {
    project_name: projectName,
    source_type: 'payment_request', source_id: payment.id,
    target_type: 'progress_node', target_id: secondProgress.id,
    relation_type: 'payment_progress',
  })
  assert.equal(rejectedCrossProject.success, false)

  closeDb()
  console.log('E2E PASS: 项目、文档、检索、巡检、进度、支付、合同、照片归档')
}

main().catch(error => {
  console.error('E2E FAIL:', error.stack || error)
  process.exitCode = 1
}).finally(() => {
  fs.rmSync(runtimeDir, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})

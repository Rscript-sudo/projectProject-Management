/**
 * 数据库 IPC — 给前端调用的统一入口
 * 前端拿到的数据是 plain object（better-sqlite3 已自动转换）
 */

import { dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { safeCall } from './safe.mjs'
import { getDb, closeDb } from '../db/database.mjs'
import * as repo from '../db/repo.mjs'

export function register(ipcMain, mainWindow) {
  // ============ 项目主数据中心 ============
  ipcMain.handle('db:listMasterData', safeCall((_, projectName, entityType, options) => repo.listMasterData(projectName, entityType, options || {})))
  ipcMain.handle('db:saveMasterData', safeCall((_, projectName, entityType, data, replacingId) => ({
    success: true, item: repo.saveMasterData(projectName, entityType, data, replacingId || null),
  })))
  ipcMain.handle('db:retireMasterData', safeCall((_, projectName, entityType, id) => ({
    success: true, retired: repo.retireMasterData(projectName, entityType, id),
  })))
  ipcMain.handle('db:setProjectPhase', safeCall((_, projectName, phase, note, effectiveFrom) => ({
    success: true, phase: repo.setProjectPhase(projectName, phase, note, effectiveFrom),
  })))
  ipcMain.handle('db:getProjectPhaseHistory', safeCall((_, projectName) => repo.getProjectPhaseHistory(projectName)))
  ipcMain.handle('db:listMasterChanges', safeCall((_, projectName, limit) => repo.listMasterChanges(projectName, limit)))
  ipcMain.handle('db:getCurrentMasterSnapshot', safeCall((_, projectName) => repo.getCurrentMasterSnapshot(projectName)))
  ipcMain.handle('db:getDocumentMasterSnapshot', safeCall((_, filePath) => repo.getDocumentMasterSnapshot(filePath)))

  // ============ 统一业务关系 ============
  ipcMain.handle('db:createBusinessRelation', safeCall((_, relation) => {
    const item = repo.createBusinessRelation(relation)
    repo.logAudit(relation.project_name, 'relation.create', 'business_relation', item.id, relation)
    return { success: true, relation: item }
  }))
  ipcMain.handle('db:listBusinessRelations', safeCall((_, projectName, entityType, entityId) =>
    repo.listBusinessRelations(projectName, entityType, entityId)))
  ipcMain.handle('db:deleteBusinessRelation', safeCall((_, projectName, relationId) => {
    const deleted = repo.deleteBusinessRelation(projectName, relationId)
    if (deleted) repo.logAudit(projectName, 'relation.delete', 'business_relation', relationId, {})
    return { success: true, deleted }
  }))
  ipcMain.handle('db:countBusinessRelations', safeCall((_, projectName, entityType, entityId) => ({
    success: true, count: repo.countBusinessRelations(projectName, entityType, entityId),
  })))

  // ============ AI 事实证据 ============
  ipcMain.handle('db:createEvidenceItem', safeCall((_, item) => ({ success: true, item: repo.createEvidenceItem(item) })))
  ipcMain.handle('db:listEvidenceItems', safeCall((_, projectName, options) => repo.listEvidenceItems(projectName, options || {})))
  ipcMain.handle('db:updateEvidenceStatus', safeCall((_, projectName, id, status, confirmedBy) => ({
    success: true, updated: repo.updateEvidenceStatus(projectName, id, status, confirmedBy),
  })))
  ipcMain.handle('db:validateDocumentEvidence', safeCall((_, projectName, evidenceIds) => repo.validateDocumentEvidence(projectName, evidenceIds || [])))

  // ============ 项目元数据 ============
  ipcMain.handle('db:getProjectMeta', safeCall((_, name) => repo.getProjectMeta(name)))
  ipcMain.handle('db:upsertProjectMeta', safeCall((_, meta) => {
    repo.upsertProjectMeta(meta)
    return { success: true }
  }))
  ipcMain.handle('db:listProjects', safeCall(() => repo.listProjects()))
  ipcMain.handle('db:deleteProjectMeta', safeCall((_, name) => {
    repo.deleteProjectMeta(name)
    return { success: true }
  }))

  // ============ 函件 ============
  ipcMain.handle('db:listCorrespondence', safeCall((_, name, opts) => repo.listCorrespondence(name, opts || {})))
  ipcMain.handle('db:getCorrespondence', safeCall((_, id) => repo.getCorrespondence(id)))
  ipcMain.handle('db:insertCorrespondence', safeCall((_, c) => {
    const id = repo.insertCorrespondence(c)
    return { success: true, id }
  }))
  ipcMain.handle('db:updateCorrespondenceStatus', safeCall((_, id, status, extra) => {
    repo.updateCorrespondenceStatus(id, status, extra || {})
    return { success: true }
  }))

  // ============ 隐患 ============
  ipcMain.handle('db:listHazard', safeCall((_, name, opts) => repo.listHazard(name, opts || {})))
  ipcMain.handle('db:insertHazard', safeCall((_, h) => {
    const id = repo.insertHazard(h)
    return { success: true, id }
  }))
  ipcMain.handle('db:updateHazardStatus', safeCall((_, id, status) => {
    repo.updateHazardStatus(id, status)
    return { success: true }
  }))
  ipcMain.handle('db:linkHazardToRectification', safeCall((_, hazardId, correspondenceId) => {
    repo.linkHazardToRectification(hazardId, correspondenceId)
    return { success: true }
  }))

  // ============ 进度节点 ============
  ipcMain.handle('db:listProgressNodes', safeCall((_, name) => repo.listProgressNodes(name)))
  ipcMain.handle('db:insertProgressNode', safeCall((_, n) => {
    const id = repo.insertProgressNode(n)
    return { success: true, id }
  }))
  ipcMain.handle('db:updateProgressNode', safeCall((_, id, updates) => {
    repo.updateProgressNode(id, updates)
    return { success: true }
  }))
  ipcMain.handle('db:deleteProgressNode', safeCall((_, id) => {
    repo.deleteProgressNode(id)
    return { success: true }
  }))

  // ============ 付款 ============
  ipcMain.handle('db:listPaymentRequests', safeCall((_, name) => repo.listPaymentRequests(name)))
  ipcMain.handle('db:getPaymentRequest', safeCall((_, id) => repo.getPaymentRequest(id)))
  ipcMain.handle('db:insertPaymentRequest', safeCall((_, p) => {
    const id = repo.insertPaymentRequest(p)
    return { success: true, id }
  }))
  ipcMain.handle('db:updatePaymentStage', safeCall((_, id, stage, history) => {
    repo.updatePaymentStage(id, stage, history)
    return { success: true }
  }))
  ipcMain.handle('db:updatePaymentStatus', safeCall((_, id, status) => {
    repo.updatePaymentStatus(id, status)
    return { success: true }
  }))

  // ============ 合同 ============
  ipcMain.handle('db:listContracts', safeCall((_, name) => repo.listContracts(name)))
  ipcMain.handle('db:insertContract', safeCall((_, c) => {
    const id = repo.insertContract(c)
    return { success: true, id }
  }))

  // ============ 变更单 ============
  ipcMain.handle('db:listChangeOrders', safeCall((_, name) => repo.listChangeOrders(name)))
  ipcMain.handle('db:insertChangeOrder', safeCall((_, c) => {
    const id = repo.insertChangeOrder(c)
    return { success: true, id }
  }))

  // ============ 索赔 ============
  ipcMain.handle('db:listClaims', safeCall((_, name) => repo.listClaims(name)))
  ipcMain.handle('db:insertClaim', safeCall((_, c) => {
    const id = repo.insertClaim(c)
    return { success: true, id }
  }))

  // ============ 照片 ============
  ipcMain.handle('db:listPhotos', safeCall((_, name, opts) => repo.listPhotos(name, opts || {})))
  ipcMain.handle('db:insertPhoto', safeCall((_, p) => {
    const id = repo.insertPhoto(p)
    return { success: true, id }
  }))

  // ============ 简易台账（合同/会议/方案/日志 走 ledger_simple）============
  ipcMain.handle('db:listSimpleLedger', safeCall((_, name, type) => repo.listSimpleLedger(name, type)))
  ipcMain.handle('db:insertSimpleLedger', safeCall((_, name, type, item) => {
    const id = repo.insertSimpleLedger(name, type, item)
    return { success: true, id }
  }))

  // ============ 审计日志 ============
  ipcMain.handle('db:logAudit', safeCall((_, projectName, action, entityType, entityId, detail) => {
    repo.logAudit(projectName, action, entityType, entityId, detail)
    return { success: true }
  }))

  // ============ 数据库导出（备份）============
  // 把 SQLite 主库（含 WAL）checkpoint 后拷到用户选的位置
  // 注意：只导出 SQLite，JSON 文件（项目文件夹）由用户单独备份
  ipcMain.handle('db:export', safeCall(async (_, mainWindow) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出数据库备份',
      defaultPath: `项目管理系统-备份-${new Date().toISOString().slice(0, 10)}.sqlite`,
      filters: [
        { name: 'SQLite 数据库', extensions: ['sqlite'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return { success: false, error: '用户取消' }

    // 先把 WAL 刷回主库（必须在 closeDb 之前，因为 close 后 _db 为 null）
    const db = getDb()
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (e) {
      // checkpoint 失败不致命，继续导出
      console.warn('[db:export] checkpoint 失败:', e.message)
    }

    // 用 better-sqlite3 的 backup API（原子且一致）
    const targetPath = result.filePath
    try {
      await db.backup(targetPath)
      const stats = fs.statSync(targetPath)
      return {
        success: true,
        path: targetPath,
        size: stats.size,
        exportedAt: new Date().toISOString(),
      }
    } catch (e) {
      return { success: false, error: '导出失败：' + e.message }
    }
  }))
}

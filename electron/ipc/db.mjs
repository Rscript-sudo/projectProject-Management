/**
 * 数据库 IPC — 给前端调用的统一入口
 * 前端拿到的数据是 plain object（better-sqlite3 已自动转换）
 */

import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'

export function register(ipcMain) {
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
}
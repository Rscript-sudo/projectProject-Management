/**
 * 合同管理 IPC — 合同台账 + 变更单 + 索赔登记
 * 数据源：SQLite contract / change_order / claim 表（B1 已建）
 */

import path from 'path'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'

// 合同类型
export const CONTRACT_TYPES = [
  { key: '施工', label: '施工合同' },
  { key: '设计', label: '设计合同' },
  { key: '监理', label: '监理合同' },
  { key: '采购', label: '采购合同' },
  { key: '其他', label: '其他合同' },
]

// 变更状态
export const CHANGE_STATUS = ['草稿', '审批中', '已批准', '已驳回']
// 索赔状态
export const CLAIM_STATUS = ['草稿', '提交中', '审批中', '已批准', '已驳回']

export function register(ipcMain) {
  // ===== 合同 =====
  ipcMain.handle('contract:list', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    const list = repo.listContracts(projectName)
    // 到期提醒
    return list.map(c => ({ ...c, expiring_soon: isExpiringSoon(c.end_date) }))
  }))

  ipcMain.handle('contract:add', safeCall((_, { projectPath, contract }) => {
    const projectName = path.basename(projectPath)
    const id = repo.insertContract({ project_name: projectName, ...contract })
    repo.logAudit(projectName, 'contract.add', 'contract', id, { name: contract.contract_name })
    return { success: true, id }
  }))

  ipcMain.handle('contract:terminate', safeCall((_, { id }) => {
    repo.updateContractStatus(id, '已终止')
    return { success: true }
  }))

  // ===== 变更单 =====
  ipcMain.handle('change:list', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    return repo.listChangeOrders(projectName)
  }))

  ipcMain.handle('change:add', safeCall((_, { projectPath, change }) => {
    const projectName = path.basename(projectPath)
    const id = repo.insertChangeOrder({ project_name: projectName, ...change })
    repo.logAudit(projectName, 'change.add', 'change_order', id, { subject: change.subject })
    return { success: true, id }
  }))

  // ===== 索赔 =====
  ipcMain.handle('claim:list', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    return repo.listClaims(projectName)
  }))

  ipcMain.handle('claim:add', safeCall((_, { projectPath, claim }) => {
    const projectName = path.basename(projectPath)
    const id = repo.insertClaim({ project_name: projectName, ...claim })
    repo.logAudit(projectName, 'claim.add', 'claim', id, { subject: claim.subject })
    return { success: true, id }
  }))

  // ===== 综合看板 =====
  ipcMain.handle('contract:dashboard', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    const contracts = repo.listContracts(projectName)
    const changes = repo.listChangeOrders(projectName)
    const claims = repo.listClaims(projectName)
    return {
      contractCount: contracts.length,
      totalAmount: contracts.reduce((s, c) => s + (c.amount || 0), 0),
      expiringCount: contracts.filter(c => isExpiringSoon(c.end_date)).length,
      changeCount: changes.length,
      changeAmount: changes.reduce((s, c) => s + (c.amount_change || 0), 0),
      claimCount: claims.length,
      claimAmount: claims.reduce((s, c) => s + (c.amount || 0), 0),
    }
  }))
}

function isExpiringSoon(endDate) {
  if (!endDate) return false
  const end = new Date(endDate)
  if (isNaN(end.getTime())) return false
  const days = Math.ceil((end - Date.now()) / 86400000)
  return days >= 0 && days <= 30
}
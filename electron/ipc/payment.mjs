/**
 * 投资控制 IPC — 5 级付款审批流 + 工程计量 + 累计金额统计
 * 数据源：SQLite payment_request 表（B1 已建）
 *
 * 5 级审批：监理员 → 专业监理工程师 → 总监理工程师 → 业主审批 → 已完成
 */

import path from 'path'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'

// 5 级审批定义
export const APPROVAL_STAGES = [
  { key: '监理员', order: 1, desc: '现场计量初核' },
  { key: '专业监理工程师', order: 2, desc: '专业复核' },
  { key: '总监理工程师', order: 3, desc: '总监签认' },
  { key: '业主', order: 4, desc: '业主审批' },
  { key: '已完成', order: 5, desc: '款项已支付' },
]

export function register(ipcMain) {
  // 列表（含累计金额）
  ipcMain.handle('payment:list', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    return repo.listPaymentRequests(projectName).map(enrichPayment)
  }))

  // 新增付款申请
  ipcMain.handle('payment:add', safeCall((_, { projectPath, payment }) => {
    const projectName = path.basename(projectPath)
    const contract = repo.getProjectMeta(projectName)
    const cumulative = computeCumulative(projectName, payment.amount, parseFloat(contract?.contract_amount || 0))
    const id = repo.insertPaymentRequest({
      project_name: projectName,
      ...payment,
      cumulative_amount: cumulative.cumulative_amount,
      cumulative_percent: cumulative.cumulative_percent,
      approval_history: '[]',
    })
    repo.logAudit(projectName, 'payment.add', 'payment_request', id, { amount: payment.amount })
    return { success: true, id, ...cumulative }
  }))

  // 更新审批阶段（流转）
  ipcMain.handle('payment:advance', safeCall((_, { id, person, opinion }) => {
    const current = repo.getPaymentRequest(id)
    if (!current) return { success: false, error: '记录不存在' }

    const history = safeJsonParse(current.approval_history, [])
    const currentStage = current.approval_stage
    const currentIdx = APPROVAL_STAGES.findIndex(s => s.key === currentStage)
    if (currentIdx < 0 || currentIdx >= APPROVAL_STAGES.length - 1) {
      return { success: false, error: '已到最后阶段' }
    }

    const nextStage = APPROVAL_STAGES[currentIdx + 1].key
    history.push({
      stage: currentStage,
      person: person || '',
      opinion: opinion || '',
      time: new Date().toISOString(),
    })

    // 最后一级流转时更新 status
    if (nextStage === '已完成') {
      repo.updatePaymentStatus(id, '已支付')
    }

    repo.updatePaymentStage(id, nextStage, history)
    repo.logAudit(current.project_name, 'payment.advance', 'payment_request', id, {
      from: currentStage, to: nextStage,
    })
    return { success: true, nextStage }
  }))

  // 驳回
  ipcMain.handle('payment:reject', safeCall((_, { id, person, opinion }) => {
    const current = repo.getPaymentRequest(id)
    if (!current) return { success: false, error: '记录不存在' }
    const history = safeJsonParse(current.approval_history, [])
    history.push({
      stage: current.approval_stage,
      person: person || '',
      opinion: opinion || '驳回',
      time: new Date().toISOString(),
      action: 'reject',
    })
    repo.updatePaymentStatus(id, '已驳回')
    repo.updatePaymentStage(id, current.approval_stage, history)
    repo.logAudit(current.project_name, 'payment.reject', 'payment_request', id, { opinion })
    return { success: true }
  }))

  // 累计金额统计（项目维度）
  ipcMain.handle('payment:summary', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    const list = repo.listPaymentRequests(projectName)
    const contract = repo.getProjectMeta(projectName)
    const contractAmount = parseFloat(contract?.contract_amount || 0)

    const approved = list.filter(p => p.status === '已支付' || p.status === '已通过')
    const pending = list.filter(p => p.status === '审批中')
    const rejected = list.filter(p => p.status === '已驳回')

    return {
      contractAmount,
      approvedAmount: approved.reduce((s, p) => s + (p.amount || 0), 0),
      approvedPercent: contractAmount ? Math.round(approved.reduce((s, p) => s + (p.amount || 0), 0) / contractAmount * 1000) / 10 : 0,
      pendingAmount: pending.reduce((s, p) => s + (p.amount || 0), 0),
      rejectedAmount: rejected.reduce((s, p) => s + (p.amount || 0), 0),
      totalCount: list.length,
      approvedCount: approved.length,
      pendingCount: pending.length,
      rejectedCount: rejected.length,
    }
  }))
}

/**
 * 累计金额计算
 */
function computeCumulative(projectName, newAmount, contractAmount) {
  const list = repo.listPaymentRequests(projectName)
  const prevPaid = list
    .filter(p => p.status === '已支付' || p.status === '已通过')
    .reduce((s, p) => s + (p.amount || 0), 0)
  const cumulative_amount = prevPaid + (newAmount || 0)
  const cumulative_percent = contractAmount > 0
    ? Math.round((cumulative_amount / contractAmount) * 1000) / 10
    : 0
  return { cumulative_amount, cumulative_percent }
}

function enrichPayment(p) {
  const history = safeJsonParse(p.approval_history, [])
  const currentIdx = APPROVAL_STAGES.findIndex(s => s.key === p.approval_stage)
  return {
    ...p,
    history,
    approval_progress: currentIdx >= 0 ? Math.round((currentIdx + 1) / APPROVAL_STAGES.length * 100) : 0,
  }
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}
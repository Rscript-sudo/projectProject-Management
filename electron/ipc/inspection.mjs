/**
 * 现场巡视 IPC — 5 大维度检查清单 + 巡视记录归档
 * 数据落盘：B1 之后改用 SQLite（hazard 表），旧 JSON 保留作只读副本
 */

import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { getProjectDataPath } from './shared.mjs'
import * as repo from '../db/repo.mjs'

// 5 大检查维度
export const SAFETY_DIMENSIONS = [
  { key: 'electrical', name: '临电安全', icon: '⚡', desc: '临时配电箱漏电保护、接线规范性' },
  { key: 'height', name: '高空安全', icon: '⛰️', desc: '安全带佩戴、作业平台稳固性' },
  { key: 'edge', name: '临边洞口', icon: '⚠️', desc: '临边防护、洞口盖板设置' },
  { key: 'hotwork', name: '动火安全', icon: '🔥', desc: '动火审批、消防器材配备' },
  { key: 'fire', name: '消防安全', icon: '🧯', desc: '材料存放区灭火器配备' },
]

/**
 * 5 维度的检查项 — 每条带默认描述 + 整改建议模板
 */
export const CHECK_ITEMS = {
  electrical: [
    { id: 'e1', label: '临时配电箱漏电保护器有效', defaultIssue: '漏电保护器失效或未按规范配置' },
    { id: 'e2', label: '配电箱接线规范无裸露', defaultIssue: '接线不规范，存在裸露线头' },
    { id: 'e3', label: '用电设备PE保护接地可靠', defaultIssue: 'PE保护接地缺失或不可靠' },
    { id: 'e4', label: '临时电缆架空或埋地防护到位', defaultIssue: '临时电缆拖地无防护' },
  ],
  height: [
    { id: 'h1', label: '高处作业人员安全带佩戴', defaultIssue: '高处作业人员未佩戴安全带' },
    { id: 'h2', label: '作业平台稳固性', defaultIssue: '作业平台未经验收或稳定性不足' },
    { id: 'h3', label: '安全网/防坠网设置', defaultIssue: '安全网缺失或破损' },
    { id: 'h4', label: '作业下方警戒区设置', defaultIssue: '未设置警戒区和警示标识' },
  ],
  edge: [
    { id: 'g1', label: '临边防护栏设置', defaultIssue: '临边防护栏缺失或不符合规范' },
    { id: 'g2', label: '洞口盖板/防护设置', defaultIssue: '洞口未设置盖板或防护' },
    { id: 'g3', label: '夜间警示灯设置', defaultIssue: '夜间警示灯缺失或失效' },
  ],
  hotwork: [
    { id: 'w1', label: '动火作业审批手续', defaultIssue: '动火作业未经审批' },
    { id: 'w2', label: '现场消防器材配备', defaultIssue: '动火点未配备消防器材' },
    { id: 'w3', label: '动火作业看火人到位', defaultIssue: '动火作业未设看火人' },
  ],
  fire: [
    { id: 'f1', label: '材料堆放区灭火器配备', defaultIssue: '材料堆放区灭火器缺失或过期' },
    { id: 'f2', label: '消防通道畅通', defaultIssue: '消防通道被占用或堵塞' },
    { id: 'f3', label: '易燃物单独存放', defaultIssue: '易燃物未单独隔离存放' },
  ],
}

export function register(ipcMain) {
  // 保存巡视记录
  ipcMain.handle('inspection:save', safeCall(async (_, { projectPath, record }) => {
    const projectName = path.basename(projectPath)
    if (!projectName) return { success: false, error: '项目名无效' }

    const date = record.date || new Date().toISOString().split('T')[0]
    const recordDir = path.join(projectPath, '03_实施阶段', '10_问题清单')
    fs.mkdirSync(recordDir, { recursive: true })

    const fileName = `巡检记录_${record.date || date}.json`
    const filePath = path.join(recordDir, fileName)

    // 追加 or 新建
    let existing = { records: [] }
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (!Array.isArray(existing.records)) existing = { records: [] }
      } catch {
        existing = { records: [] }
      }
    }
    existing.records.push(record)
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8')

    // 联动写入隐患表（B1 之后统一走 SQLite）
    const issues = record.issues || []
    const today = new Date().toISOString().split('T')[0]
    const hazardIds = []
    for (const issue of issues) {
      if (!issue.found) continue
      const hid = repo.insertHazard({
        project_name: projectName,
        dimension: issue.dimKey,
        dimension_name: issue.dimensionName,
        location: issue.location || record.location || '',
        description: issue.description || issue.label,
        severity: issue.severity || '一般',
        status: '待整改',
        source: '巡检',
      })
      hazardIds.push(hid)
    }

    // 审计日志
    repo.logAudit(projectName, 'inspection.save', 'inspection', null, {
      date: record.date, foundCount: hazardIds.length,
    })

    return { success: true, recordPath: filePath, hazardIds, hazardCount: hazardIds.length }
  }))

  // 状态流转：标记整改中（生成整改通知后调用）
  ipcMain.handle('inspection:linkHazard', safeCall((_, { hazardId, correspondenceId }) => {
    repo.linkHazardToRectification(hazardId, correspondenceId)
    repo.updateHazardStatus(hazardId, '整改中')
    return { success: true }
  }))

  // 标记已复查
  ipcMain.handle('inspection:markReview', safeCall((_, { hazardId, reviewDate }) => {
    repo.updateHazardStatus(hazardId, '已复查')
    return { success: true }
  }))

  // 关闭隐患
  ipcMain.handle('inspection:closeHazard', safeCall((_, { hazardId }) => {
    repo.updateHazardStatus(hazardId, '已关闭')
    return { success: true }
  }))

  // 读取历史巡视记录
  ipcMain.handle('inspection:list', safeCall(async (_, { projectPath }) => {
    const projectName = path.basename(projectPath)
    if (!projectName) return []

    const recordDir = path.join(projectPath, '03_实施阶段', '10_问题清单')
    if (!fs.existsSync(recordDir)) return []

    const files = fs.readdirSync(recordDir).filter(f => f.startsWith('巡检记录_') && f.endsWith('.json'))
    const records = []
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(recordDir, f), 'utf8'))
        const items = Array.isArray(data.records) ? data.records : []
        for (const r of items) {
          records.push({ ...r, _file: f })
        }
      } catch {
        // 跳过损坏文件
      }
    }
    return records.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }))
}
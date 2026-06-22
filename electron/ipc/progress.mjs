/**
 * 进度控制 IPC — 横道图、计划台账、月度对比、偏差分析
 * 数据源：SQLite progress_node 表（B1 已建）
 */

import path from 'path'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'

export function register(ipcMain) {
  // 列表（含偏差字段计算）
  ipcMain.handle('progress:list', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    return repo.listProgressNodes(projectName).map(enrichNode)
  }))

  // 新增
  ipcMain.handle('progress:add', safeCall((_, { projectPath, node }) => {
    const projectName = path.basename(projectPath)
    const id = repo.insertProgressNode({
      project_name: projectName,
      ...node,
    })
    repo.logAudit(projectName, 'progress.add', 'progress_node', id, { name: node.name })
    return { success: true, id }
  }))

  // 更新
  ipcMain.handle('progress:update', safeCall((_, { id, updates }) => {
    repo.updateProgressNode(id, updates)
    return { success: true }
  }))

  // 删除
  ipcMain.handle('progress:delete', safeCall((_, { id }) => {
    repo.deleteProgressNode(id)
    return { success: true }
  }))

  // 横道图数据（时间轴坐标）
  ipcMain.handle('progress:gantt', safeCall((_, { projectPath, yearMonth }) => {
    const projectName = path.basename(projectPath)
    const all = repo.listProgressNodes(projectName).map(enrichNode)
    let filtered = all
    if (yearMonth) {
      // 过滤包含该月的节点
      const ym = yearMonth.replace('-', '')
      filtered = all.filter(n => {
        const ps = (n.plan_start || '').replace(/-/g, '').slice(0, 6)
        const pe = (n.plan_end || '').replace(/-/g, '').slice(0, 6)
        return ps <= ym && pe >= ym
      })
    }
    return computeGanttLayout(filtered)
  }))

  // 月度对比：本月计划 vs 实际完成
  ipcMain.handle('progress:monthlyCompare', safeCall((_, { projectPath, yearMonth }) => {
    const projectName = path.basename(projectPath)
    const all = repo.listProgressNodes(projectName)
    const ym = (yearMonth || new Date().toISOString().slice(0, 7)).replace('-', '')

    // 本月计划节点（plan 跨越该月）
    const planInMonth = all.filter(n => {
      const ps = (n.plan_start || '').replace(/-/g, '').slice(0, 6)
      const pe = (n.plan_end || '').replace(/-/g, '').slice(0, 6)
      return ps <= ym && pe >= ym
    })

    // 本月实际完成节点
    const actualDone = all.filter(n => {
      const ae = (n.actual_end || '').replace(/-/g, '').slice(0, 6)
      return ae === ym
    })

    return {
      yearMonth,
      plannedCount: planInMonth.length,
      plannedNodes: planInMonth.map(n => n.name),
      doneCount: actualDone.length,
      doneNodes: actualDone.map(n => n.name),
      overdueNodes: planInMonth.filter(n =>
        (n.plan_end || '').replace(/-/g, '').slice(0, 6) < ym && n.progress_percent < 100
      ).map(n => n.name),
    }
  }))

  // 偏差分析
  ipcMain.handle('progress:deviation', safeCall((_, { projectPath }) => {
    const projectName = path.basename(projectPath)
    const nodes = repo.listProgressNodes(projectName).map(enrichNode)
    return computeDeviation(nodes)
  }))
}

/**
 * 给节点补充偏差字段（不改 DB，运行时计算）
 */
function enrichNode(n) {
  const enriched = { ...n }
  const planStart = n.plan_start ? new Date(n.plan_start) : null
  const planEnd = n.plan_end ? new Date(n.plan_end) : null
  const actualStart = n.actual_start ? new Date(n.actual_start) : null
  const actualEnd = n.actual_end ? new Date(n.actual_end) : null
  const today = new Date()

  // 计划工期
  if (planStart && planEnd) {
    enriched.plan_days = Math.ceil((planEnd - planStart) / 86400000)
  }
  // 实际工期
  if (actualStart && actualEnd) {
    enriched.actual_days = Math.ceil((actualEnd - actualStart) / 86400000)
  }
  // 工期偏差 = 实际 - 计划
  if (enriched.plan_days && enriched.actual_days) {
    enriched.schedule_variance_days = enriched.actual_days - enriched.plan_days
  }
  // 进度状态
  if (n.progress_percent >= 100) {
    enriched.status = '已完成'
  } else if (planEnd && today > planEnd) {
    enriched.status = '超期'
  } else if (n.progress_percent > 0) {
    enriched.status = '进行中'
  } else if (planStart && today < planStart) {
    enriched.status = '未开始'
  } else {
    enriched.status = '进行中'
  }
  return enriched
}

/**
 * 横道图布局计算 — 把日期映射到像素坐标
 * 输入：节点列表（含 plan_start/plan_end/actual_start/actual_end/progress_percent）
 * 输出：{ minDate, maxDate, totalDays, nodes: [{...原始, x, width, actualX, actualWidth, progressWidth}] }
 */
function computeGanttLayout(nodes) {
  if (!nodes.length) {
    return { minDate: '', maxDate: '', totalDays: 0, nodes: [] }
  }
  let minDate = null, maxDate = null
  for (const n of nodes) {
    for (const d of [n.plan_start, n.plan_end, n.actual_start, n.actual_end]) {
      if (!d) continue
      const t = new Date(d).getTime()
      if (minDate === null || t < minDate) minDate = t
      if (maxDate === null || t > maxDate) maxDate = t
    }
  }
  if (minDate === null) {
    return { minDate: '', maxDate: '', totalDays: 0, nodes: [] }
  }
  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000))
  const dayPx = 8 // 每天 8px
  const layoutNodes = nodes.map(n => {
    const out = { ...n }
    if (n.plan_start && n.plan_end) {
      const ps = new Date(n.plan_start).getTime()
      const pe = new Date(n.plan_end).getTime()
      out.x = Math.round(((ps - minDate) / 86400000) * dayPx)
      out.width = Math.max(8, Math.round(((pe - ps) / 86400000) * dayPx))
    }
    if (n.actual_start && n.actual_end) {
      const as = new Date(n.actual_start).getTime()
      const ae = new Date(n.actual_end).getTime()
      out.actualX = Math.round(((as - minDate) / 86400000) * dayPx)
      out.actualWidth = Math.max(8, Math.round(((ae - as) / 86400000) * dayPx))
      out.progressWidth = Math.round(out.actualWidth * (n.progress_percent || 0) / 100)
    } else if (n.actual_start && n.plan_end) {
      // 进行中：只画到今天
      const as = new Date(n.actual_start).getTime()
      const today = Math.min(Date.now(), new Date(n.plan_end).getTime())
      out.actualX = Math.round(((as - minDate) / 86400000) * dayPx)
      out.actualWidth = Math.max(8, Math.round(((today - as) / 86400000) * dayPx))
      out.progressWidth = Math.round(out.actualWidth * (n.progress_percent || 0) / 100)
    }
    return out
  })
  return {
    minDate: new Date(minDate).toISOString().slice(0, 10),
    maxDate: new Date(maxDate).toISOString().slice(0, 10),
    totalDays,
    dayPx,
    nodes: layoutNodes,
  }
}

/**
 * 偏差分析：综合工期偏差 + 进度完成度
 */
function computeDeviation(nodes) {
  const total = nodes.length
  if (!total) {
    return {
      totalNodes: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0,
      overallProgress: 0, weightedProgress: 0, onTimeRate: 0,
    }
  }
  const completed = nodes.filter(n => n.progress_percent >= 100).length
  const overdue = nodes.filter(n => n.status === '超期').length
  const inProgress = nodes.filter(n => n.status === '进行中').length
  const notStarted = nodes.filter(n => n.status === '未开始').length
  // 加权进度
  const totalWeight = nodes.reduce((s, n) => s + (n.weight || 1), 0)
  const weightedProgress = nodes.reduce((s, n) => s + (n.progress_percent || 0) * (n.weight || 1), 0) / (totalWeight || 1)
  // 平均进度（简单平均）
  const overallProgress = nodes.reduce((s, n) => s + (n.progress_percent || 0), 0) / total
  // 准时率：已完成节点中无工期偏差的比例
  const completedNodes = nodes.filter(n => n.progress_percent >= 100)
  const onTimeCount = completedNodes.filter(n => (n.schedule_variance_days || 0) <= 0).length
  const onTimeRate = completedNodes.length ? Math.round((onTimeCount / completedNodes.length) * 100) : null

  return {
    totalNodes: total, completed, inProgress, notStarted, overdue,
    overallProgress: Math.round(overallProgress),
    weightedProgress: Math.round(weightedProgress * 10) / 10,
    onTimeRate,
  }
}
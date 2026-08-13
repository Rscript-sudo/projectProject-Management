/**
 * 计算指定月份的计划、完成与逾期节点。
 * 逾期节点必须从全部节点中选取：其计划结束月早于报告月，因此不可能同时属于“跨越本月”的计划集合。
 */
export function computeMonthlyComparison(nodes, yearMonth) {
  const resolvedYearMonth = yearMonth || new Date().toISOString().slice(0, 7)
  const ym = resolvedYearMonth.replace(/-/g, '').slice(0, 6)
  const monthOf = value => (value || '').replace(/-/g, '').slice(0, 6)

  const planInMonth = nodes.filter(n => {
    const ps = monthOf(n.plan_start)
    const pe = monthOf(n.plan_end)
    return ps.length === 6 && pe.length === 6 && ps <= ym && pe >= ym
  })
  const actualDone = nodes.filter(n => monthOf(n.actual_end) === ym)
  const overdue = nodes.filter(n => {
    const pe = monthOf(n.plan_end)
    return pe.length === 6 && pe < ym && Number(n.progress_percent || 0) < 100
  })

  return {
    yearMonth: resolvedYearMonth,
    plannedCount: planInMonth.length,
    plannedNodes: planInMonth.map(n => n.name),
    doneCount: actualDone.length,
    doneNodes: actualDone.map(n => n.name),
    overdueNodes: overdue.map(n => n.name),
  }
}

import rules from '../src/shared/completeness-rules.json' with { type: 'json' }

const RULES = new Map(rules.map(rule => [rule.code, rule]))
const OPEN_HAZARD = new Set(['待整改', '整改中', '已复查', '超期'])
const OPEN_CORRESPONDENCE = new Set(['已发出', '待发', '待回复', '超期未回复'])

function issue(code, message, entityType, entityId, detail = {}) {
  const rule = RULES.get(code)
  if (!rule) throw new Error(`未知完整性规则：${code}`)
  return { ...rule, message, entityType, entityId: entityId == null ? '' : String(entityId), detail }
}

function invalidRange(start, end) {
  if (!start || !end) return false
  const a = new Date(start).getTime(); const b = new Date(end).getTime()
  return Number.isFinite(a) && Number.isFinite(b) && a > b
}

function dateOnly(value) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function parseSequence(number) {
  const match = String(number || '').trim().match(/^(.*?)(\d+)$/)
  return match ? { prefix: match[1], seq: Number(match[2]) } : null
}

export function evaluateBusinessCompleteness(db, projectName, now = new Date()) {
  const issues = []
  const nowMs = now.getTime()

  for (const row of db.prepare('SELECT * FROM progress_node WHERE project_name = ?').all(projectName)) {
    if (invalidRange(row.plan_start, row.plan_end)) issues.push(issue('DATE_RANGE_INVALID', `进度节点“${row.name}”计划开始晚于计划结束`, 'progress_node', row.id))
    if (invalidRange(row.actual_start, row.actual_end)) issues.push(issue('DATE_RANGE_INVALID', `进度节点“${row.name}”实际开始晚于实际结束`, 'progress_node', row.id))
    if (row.progress_percent < 0 || row.progress_percent > 100) issues.push(issue('DATE_RANGE_INVALID', `进度节点“${row.name}”完成率超出 0—100%`, 'progress_node', row.id))
  }

  const correspondences = db.prepare('SELECT * FROM correspondence WHERE project_name = ? ORDER BY created_at').all(projectName)
  for (const row of correspondences) {
    if (row.review_date && invalidRange(row.created_at, row.review_date)) issues.push(issue('REVIEW_BEFORE_ISSUE', `函件“${row.subject || row.file_name}”复查日期早于发出日期`, 'correspondence', row.id))
    const deadline = dateOnly(row.deadline)
    if (deadline != null && deadline < nowMs && OPEN_CORRESPONDENCE.has(row.status)) issues.push(issue('CORRESPONDENCE_OVERDUE', `函件“${row.subject || row.file_name}”已超过办理期限`, 'correspondence', row.id, { deadline: row.deadline }))
  }

  const numbered = correspondences.map(row => ({ row, parsed: parseSequence(row.file_number) })).filter(item => item.parsed)
  const groups = new Map()
  for (const item of numbered) {
    if (!groups.has(item.parsed.prefix)) groups.set(item.parsed.prefix, [])
    groups.get(item.parsed.prefix).push(item)
  }
  for (const [prefix, items] of groups) {
    const bySeq = new Map()
    for (const item of items) {
      if (bySeq.has(item.parsed.seq)) issues.push(issue('NUMBER_DUPLICATE', `文号 ${item.row.file_number} 重复`, 'correspondence', item.row.id, { duplicateId: bySeq.get(item.parsed.seq).row.id }))
      else bySeq.set(item.parsed.seq, item)
    }
    const seqs = [...bySeq.keys()].sort((a, b) => a - b)
    for (let n = seqs[0]; seqs.length && n < seqs[seqs.length - 1]; n++) {
      if (!bySeq.has(n)) issues.push(issue('NUMBER_GAP', `文号前缀 ${prefix || '无'} 缺少序号 ${n}`, 'correspondence', '', { prefix, missingSequence: n }))
    }
  }

  for (const row of db.prepare('SELECT * FROM hazard WHERE project_name = ?').all(projectName)) {
    const deadline = dateOnly(row.deadline)
    if (deadline != null && deadline < nowMs && OPEN_HAZARD.has(row.status)) issues.push(issue('HAZARD_OVERDUE', `隐患“${row.description}”已超过整改期限`, 'hazard', row.id, { deadline: row.deadline }))
  }

  const contracts = db.prepare('SELECT * FROM contract WHERE project_name = ?').all(projectName)
  for (const contract of contracts) {
    const end = dateOnly(contract.end_date)
    const remaining = end == null ? null : Math.ceil((end - nowMs) / 86400000)
    if (contract.status === '执行中' && remaining != null && remaining >= 0 && remaining <= 30) issues.push(issue('CONTRACT_EXPIRING', `合同“${contract.contract_name}”将在 ${remaining} 天后到期`, 'contract', contract.id, { endDate: contract.end_date, remainingDays: remaining }))
    if (invalidRange(contract.start_date, contract.end_date)) issues.push(issue('DATE_RANGE_INVALID', `合同“${contract.contract_name}”开始日期晚于结束日期`, 'contract', contract.id))
    const relations = db.prepare("SELECT * FROM business_relation WHERE project_name = ? AND source_type = 'contract' AND source_id = ?").all(projectName, String(contract.id))
    const changeIds = relations.filter(row => row.relation_type === 'contract_change').map(row => Number(row.target_id))
    const paymentIds = relations.filter(row => row.relation_type === 'contract_payment').map(row => Number(row.target_id))
    const approvedChange = changeIds.length ? db.prepare(`SELECT COALESCE(SUM(amount_change), 0) amount FROM change_order WHERE id IN (${changeIds.map(() => '?').join(',')}) AND status = '已批准'`).get(...changeIds).amount : 0
    const paid = paymentIds.length ? db.prepare(`SELECT COALESCE(SUM(amount), 0) amount FROM payment_request WHERE id IN (${paymentIds.map(() => '?').join(',')}) AND status IN ('已通过','已支付')`).get(...paymentIds).amount : 0
    const adjusted = Number(contract.amount || 0) + Number(approvedChange || 0)
    if (paid > adjusted) issues.push(issue('PAYMENT_EXCEEDS_CONTRACT', `合同“${contract.contract_name}”累计支付 ${paid} 元，超过调整后金额 ${adjusted} 元`, 'contract', contract.id, { paid, adjusted }))
  }

  const payments = db.prepare('SELECT * FROM payment_request WHERE project_name = ? ORDER BY created_at, id').all(projectName)
  let running = 0
  for (const row of payments) {
    if (row.status === '已通过' || row.status === '已支付') running += Number(row.amount || 0)
    if ((row.status === '已通过' || row.status === '已支付') && Math.abs(Number(row.cumulative_amount || 0) - running) > 0.009) issues.push(issue('PAYMENT_CUMULATIVE_MISMATCH', `付款申请 ${row.period} 的累计金额与已批准金额不一致`, 'payment_request', row.id, { expected: running, actual: row.cumulative_amount }))
  }

  const reports = db.prepare("SELECT * FROM ledger_simple WHERE project_name = ? AND doc_type IN ('监理周报','监理月报')").all(projectName)
  for (const report of reports) {
    const relationCount = db.prepare("SELECT COUNT(*) count FROM business_relation WHERE project_name = ? AND source_type = 'document' AND source_id = ? AND relation_type = 'document_evidence'").get(projectName, String(report.id)).count
    if (!relationCount) issues.push(issue('REPORT_SOURCE_MISSING', `报告“${report.file_name}”没有登记事实来源`, 'ledger_simple', report.id, { fileName: report.file_name }))
  }

  return issues
}

export function summarizeIssues(issues) {
  const summary = { error: 0, warning: 0, total: issues.length, byCategory: {} }
  for (const item of issues) {
    summary[item.severity] = (summary[item.severity] || 0) + 1
    summary.byCategory[item.category] = (summary.byCategory[item.category] || 0) + 1
  }
  return summary
}

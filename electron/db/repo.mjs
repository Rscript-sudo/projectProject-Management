/**
 * 统一数据访问层 — 业务模块只调这里，不直接碰 SQL
 * 旧 JSON 文件保留不动，作为只读副本兜底
 */

import { getDb } from './database.mjs'

/**
 * v1.2.1 P0 修复：项目名安全校验
 * 防止路径穿越：拒绝包含 / \ : * ? " < > | .. 的项目名
 * 项目名是磁盘目录名 + 路由 key，必须严格
 */
export function assertSafeProjectName(projectName) {
  if (!projectName || typeof projectName !== 'string') {
    throw new Error('项目名不能为空')
  }
  if (projectName.length > 100) {
    throw new Error('项目名过长（>100 字符）')
  }
  if (/[\\/:*?"<>|\x00-\x1f]/.test(projectName)) {
    throw new Error(`项目名含非法字符：${projectName}`)
  }
  if (projectName.includes('..')) {
    throw new Error('项目名不能含 ".."')
  }
  if (projectName.startsWith('.')) {
    throw new Error('项目名不能以 "." 开头')
  }
  return projectName
}

/**
 * v1.2.1 P0 修复：文本字段长度限制（防 100KB 垃圾塞爆 DB）
 */
function clampText(value, max, fieldName) {
  if (value == null) return ''
  const s = String(value)
  if (s.length > max) {
    console.warn(`[repo] ${fieldName} 超过 ${max} 字符，已截断（原 ${s.length}）`)
    return s.slice(0, max)
  }
  return s
}

/**
 * v1.2.1 P2 修复：LIKE 参数转义（防 % _ 通配符误匹配）
 * 与 SQL 中 ESCAPE '\\' 配合使用
 */
function escapeLike(s) {
  if (s == null) return ''
  return String(s).replace(/[\\%_]/g, '\\$&')
}

// ============ 项目元数据 ============

export function getProjectMeta(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM project_meta WHERE project_name = ?').get(projectName)
}

export function upsertProjectMeta(meta) {
  const now = new Date().toISOString()
  assertSafeProjectName(meta.project_name)
  const existing = getProjectMeta(meta.project_name)
  if (existing) {
    getDb().prepare(`
      UPDATE project_meta SET
        project_path = ?, project_type = ?, contractor = ?, owner_unit = ?,
        supervisor_unit = ?, chief_engineer = ?, contract_amount = ?,
        start_date = ?, end_date = ?, chief_engineer_phone = ?, updated_at = ?
      WHERE project_name = ?
    `).run(
      meta.project_path, meta.project_type || '通用',
      meta.contractor || '', meta.owner_unit || '',
      meta.supervisor_unit || '', meta.chief_engineer || '',
      // v1.2.1 P2 修复：合同金额 0 是合法值，?? null 替代 || null
      meta.contract_amount ?? null,
      meta.start_date || null, meta.end_date || null, meta.chief_engineer_phone || null,
      now, meta.project_name,
    )
  } else {
    getDb().prepare(`
      INSERT INTO project_meta
      (project_name, project_path, project_type, contractor, owner_unit, supervisor_unit, chief_engineer, contract_amount, start_date, end_date, chief_engineer_phone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      meta.project_name, meta.project_path, meta.project_type || '通用',
      meta.contractor || '', meta.owner_unit || '',
      meta.supervisor_unit || '', meta.chief_engineer || '',
      // v1.2.1 P2 修复：合同金额 0 是合法值
      meta.contract_amount ?? null,
      meta.start_date || null, meta.end_date || null, meta.chief_engineer_phone || null,
      now, now,
    )
  }
}

export function listProjects() {
  return getDb().prepare('SELECT * FROM project_meta ORDER BY created_at DESC').all()
}

export function deleteProjectMeta(projectName) {
  assertSafeProjectName(projectName)
  getDb().prepare('DELETE FROM project_meta WHERE project_name = ?').run(projectName)
}

// ============ 编号规则 ============

export function getNumberingRules(projectName) {
  assertSafeProjectName(projectName)
  const rows = getDb().prepare('SELECT * FROM numbering_rules WHERE project_name = ?').all(projectName)
  const out = {}
  for (const r of rows) {
    out[r.doc_type] = {
      prefix: r.prefix, reset: r.reset, lastDate: r.last_date, lastSeq: r.last_seq,
    }
  }
  return out
}

export function saveNumberingRules(projectName, rules) {
  assertSafeProjectName(projectName)
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO numbering_rules
    (project_name, doc_type, prefix, reset, last_date, last_seq)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const tx = getDb().transaction((rs) => {
    for (const [docType, r] of Object.entries(rs)) {
      stmt.run(projectName, docType, r.prefix, r.reset, r.lastDate, r.lastSeq)
    }
  })
  tx(rules)
}

export function updateNumberingRule(projectName, docType, rule) {
  assertSafeProjectName(projectName)
  getDb().prepare(`
    INSERT OR REPLACE INTO numbering_rules
    (project_name, doc_type, prefix, reset, last_date, last_seq)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectName, docType, rule.prefix, rule.reset, rule.lastDate || '', rule.lastSeq || 0)
}

export function getNumberingRule(projectName, docType) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM numbering_rules WHERE project_name = ? AND doc_type = ?').get(projectName, docType)
}

// ============ 函件（带状态机）============

export function listCorrespondence(projectName, opts = {}) {
  assertSafeProjectName(projectName)
  const { status, limit = 100, offset = 0 } = opts
  let sql = 'SELECT * FROM correspondence WHERE project_name = ?'
  const params = [projectName]
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)
  return getDb().prepare(sql).all(...params)
}

export function getCorrespondence(id) {
  return getDb().prepare('SELECT * FROM correspondence WHERE id = ?').get(id)
}

export function insertCorrespondence(c) {
  // v1.2.1 P0 修复：项目名安全校验 + 文本字段长度限制
  assertSafeProjectName(c.project_name)
  const now = new Date().toISOString()
  const stmt = getDb().prepare(`
    INSERT INTO correspondence
    (project_name, doc_type, file_name, sub_dir, file_number, subject, respondent, deadline, responsible, status, source, source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const info = stmt.run(
    c.project_name, clampText(c.doc_type, 50, 'doc_type'),
    clampText(c.file_name, 200, 'file_name'),
    c.sub_dir || '',
    clampText(c.file_number, 100, 'file_number'),
    clampText(c.subject, 200, 'subject'),
    clampText(c.respondent, 200, 'respondent'),
    clampText(c.deadline, 50, 'deadline'),
    clampText(c.responsible, 100, 'responsible'),
    clampText(c.status, 30, 'status') || '已发出',
    clampText(c.source, 30, 'source') || 'ai生成',
    c.source_ref || null,
    c.created_at || now, now,
  )
  return info.lastInsertRowid
}

export function updateCorrespondenceStatus(id, status, extra = {}) {
  const now = new Date().toISOString()
  const fields = ['status = ?', 'updated_at = ?']
  const params = [status, now]
  if (extra.review_date !== undefined) {
    fields.push('review_date = ?')
    params.push(extra.review_date)
  }
  if (extra.responsible !== undefined) {
    fields.push('responsible = ?')
    params.push(extra.responsible)
  }
  params.push(id)
  getDb().prepare(`UPDATE correspondence SET ${fields.join(', ')} WHERE id = ?`).run(...params)
}

// ============ 隐患 ============

export function listHazard(projectName, opts = {}) {
  assertSafeProjectName(projectName)
  const { status, dimension, limit = 100 } = opts
  let sql = 'SELECT * FROM hazard WHERE project_name = ?'
  const params = [projectName]
  if (status) { sql += ' AND status = ?'; params.push(status) }
  if (dimension) { sql += ' AND dimension = ?'; params.push(dimension) }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)
  return getDb().prepare(sql).all(...params)
}

export function insertHazard(h) {
  // v1.2.1 P0 修复：项目名校验 + 文本字段长度限制
  assertSafeProjectName(h.project_name)
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO hazard
    (project_name, dimension, dimension_name, location, description, severity, status, source, source_ref, deadline, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    h.project_name,
    clampText(h.dimension, 30, 'dimension'),
    clampText(h.dimension_name, 100, 'dimension_name'),
    clampText(h.location, 200, 'location'),
    clampText(h.description, 1000, 'description'),
    clampText(h.severity, 20, 'severity') || '一般',
    clampText(h.status, 30, 'status') || '待整改',
    clampText(h.source, 30, 'source') || '巡检',
    h.source_ref || null,
    h.deadline || null, now,
  )
  return info.lastInsertRowid
}

export function updateHazardStatus(id, status) {
  const fields = ['status = ?']
  const params = [status]
  if (status === '已关闭') {
    fields.push('closed_at = ?')
    params.push(new Date().toISOString())
  }
  params.push(id)
  getDb().prepare(`UPDATE hazard SET ${fields.join(', ')} WHERE id = ?`).run(...params)
}

export function linkHazardToRectification(hazardId, correspondenceId) {
  getDb().prepare('UPDATE hazard SET rectification_id = ? WHERE id = ?').run(correspondenceId, hazardId)
}

// ============ 进度节点 ============

export function listProgressNodes(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM progress_node WHERE project_name = ? ORDER BY plan_start ASC').all(projectName)
}

export function insertProgressNode(n) {
  assertSafeProjectName(n.project_name)
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO progress_node
    (project_name, name, plan_start, plan_end, actual_start, actual_end, progress_percent, weight, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    n.project_name, n.name, n.plan_start || null, n.plan_end || null,
    n.actual_start || null, n.actual_end || null,
    n.progress_percent || 0, n.weight || 1, n.parent_id || null,
    now, now,
  )
  return info.lastInsertRowid
}

export function updateProgressNode(id, updates) {
  const allowed = ['name', 'plan_start', 'plan_end', 'actual_start', 'actual_end', 'progress_percent', 'weight', 'parent_id']
  const fields = []
  const params = []
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      fields.push(`${k} = ?`)
      params.push(updates[k])
    }
  }
  if (fields.length === 0) return
  fields.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(id)
  getDb().prepare(`UPDATE progress_node SET ${fields.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteProgressNode(id) {
  getDb().prepare('DELETE FROM progress_node WHERE id = ?').run(id)
}

// ============ 付款审批 ============

export function listPaymentRequests(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM payment_request WHERE project_name = ? ORDER BY created_at DESC').all(projectName)
}

export function getPaymentRequest(id) {
  return getDb().prepare('SELECT * FROM payment_request WHERE id = ?').get(id)
}

export function insertPaymentRequest(p) {
  assertSafeProjectName(p.project_name)
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO payment_request
    (project_name, period, amount, amount_upper, cumulative_amount, cumulative_percent, description, approval_stage, approval_history, related_nodes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.project_name, p.period, p.amount, p.amount_upper || '',
    p.cumulative_amount || 0, p.cumulative_percent || 0,
    p.description || '', p.approval_stage || '监理员',
    p.approval_history || '[]', p.related_nodes || '[]',
    p.status || '审批中', now, now,
  )
  return info.lastInsertRowid
}

export function updatePaymentStage(id, stage, history) {
  const now = new Date().toISOString()
  getDb().prepare('UPDATE payment_request SET approval_stage = ?, approval_history = ?, updated_at = ? WHERE id = ?')
    .run(stage, JSON.stringify(history), now, id)
}

export function updatePaymentStatus(id, status) {
  getDb().prepare('UPDATE payment_request SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id)
}

// ============ 合同 ============

export function listContracts(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM contract WHERE project_name = ? ORDER BY created_at DESC').all(projectName)
}

export function getContract(id) {
  return getDb().prepare('SELECT * FROM contract WHERE id = ?').get(id)
}

export function insertContract(c) {
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO contract
    (project_name, contract_name, contract_type, party_a, party_b, amount, sign_date, start_date, end_date, file_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.project_name, c.contract_name, c.contract_type || '',
    c.party_a || '', c.party_b || '', c.amount || 0,
    c.sign_date || null, c.start_date || null, c.end_date || null,
    c.file_name || '', c.status || '执行中', now, now,
  )
  return info.lastInsertRowid
}

export function updateContractStatus(id, status) {
  getDb().prepare('UPDATE contract SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id)
}

// ============ 变更单 ============

export function listChangeOrders(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM change_order WHERE project_name = ? ORDER BY created_at DESC').all(projectName)
}

export function insertChangeOrder(c) {
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO change_order
    (project_name, change_number, subject, initiator, reason, content, amount_change, schedule_change, status, file_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.project_name, c.change_number || '', c.subject || '',
    c.initiator || '', c.reason || '', c.content || '',
    c.amount_change || 0, c.schedule_change || 0,
    c.status || '草稿', c.file_name || '', now, now,
  )
  return info.lastInsertRowid
}

// ============ 索赔 ============

export function listClaims(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM claim WHERE project_name = ? ORDER BY created_at DESC').all(projectName)
}

export function insertClaim(c) {
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO claim
    (project_name, claim_number, claimant, subject, amount, reason, evidence, status, file_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.project_name, c.claim_number || '', c.claimant || '',
    c.subject || '', c.amount || 0, c.reason || '',
    c.evidence || '', c.status || '草稿', c.file_name || '',
    now, now,
  )
  return info.lastInsertRowid
}

// ============ 照片 ============

export function listPhotos(projectName, opts = {}) {
  assertSafeProjectName(projectName)
  const { yearMonth, location, limit = 200 } = opts
  let sql = 'SELECT * FROM photo WHERE project_name = ?'
  const params = [projectName]
  // v1.2.1 P2 修复：LIKE 加 ESCAPE 防 % _ 通配符误匹配
  // 用户输入 "100%" 或 "_test" 不再通配全部
  if (yearMonth) {
    sql += ' AND shoot_date LIKE ? ESCAPE \'\\\''
    params.push(`${escapeLike(yearMonth)}%`)
  }
  if (location) {
    sql += ' AND location LIKE ? ESCAPE \'\\\''
    params.push(`%${escapeLike(location)}%`)
  }
  sql += ' ORDER BY shoot_date DESC LIMIT ?'
  params.push(limit)
  return getDb().prepare(sql).all(...params)
}

export function insertPhoto(p) {
  assertSafeProjectName(p.project_name)
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO photo
    (project_name, file_name, file_path, shoot_date, location, tags, description, linked_hazard_id, linked_node_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.project_name, p.file_name, p.file_path,
    p.shoot_date || null, p.location || '',
    p.tags || '', p.description || '',
    p.linked_hazard_id || null, p.linked_node_id || null,
    now,
  )
  return info.lastInsertRowid
}

// ============ 简易台账（其他 4 类）============

export function listSimpleLedger(projectName, ledgerType, limit = 100) {
  assertSafeProjectName(projectName)
  return getDb().prepare(`
    SELECT * FROM ledger_simple
    WHERE project_name = ? AND ledger_type = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(projectName, ledgerType, limit)
}

export function insertSimpleLedger(projectName, ledgerType, item) {
  assertSafeProjectName(projectName)
  const meta = { ...item }
  delete meta.fileName
  delete meta.subDir
  delete meta.createdAt
  delete meta.docType
  const info = getDb().prepare(`
    INSERT OR IGNORE INTO ledger_simple
    (project_name, ledger_type, file_name, sub_dir, created_at, doc_type, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectName, ledgerType,
    item.fileName || '', item.subDir || '',
    item.createdAt || new Date().toISOString().split('T')[0],
    item.docType || '',
    JSON.stringify(meta),
  )
  return info.lastInsertRowid
}

// ============ 审计日志 ============

export function logAudit(projectName, action, entityType, entityId, detail) {
  assertSafeProjectName(projectName)
  getDb().prepare(`
    INSERT INTO audit_log (project_name, action, entity_type, entity_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    projectName, action, entityType || null, entityId || null,
    detail ? JSON.stringify(detail) : null,
    new Date().toISOString(),
  )
}
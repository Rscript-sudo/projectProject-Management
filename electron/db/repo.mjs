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

const ENTITY_TYPES = new Set([
  'inspection', 'hazard', 'correspondence', 'progress_node', 'payment_request',
  'contract', 'change_order', 'claim', 'photo', 'document', 'ledger_simple',
  'evidence',
])

const ENTITY_TABLES = {
  hazard: 'hazard', correspondence: 'correspondence', progress_node: 'progress_node',
  payment_request: 'payment_request', contract: 'contract', change_order: 'change_order',
  claim: 'claim', photo: 'photo', ledger_simple: 'ledger_simple',
  evidence: 'evidence_item',
}

function normalizeEntityType(value) {
  const type = String(value || '').trim()
  if (!ENTITY_TYPES.has(type)) throw new Error(`不支持的业务对象类型：${type || '空'}`)
  return type
}

function normalizeEntityId(value) {
  const id = String(value ?? '').trim()
  if (!id || id.length > 200) throw new Error('业务对象 ID 无效')
  return id
}

function assertEntityInProject(projectName, entityType, entityId) {
  const table = ENTITY_TABLES[entityType]
  if (!table) return
  const row = getDb().prepare(`SELECT project_name FROM ${table} WHERE id = ?`).get(entityId)
  if (!row) throw new Error(`${entityType} #${entityId} 不存在`)
  if (row.project_name !== projectName) throw new Error('禁止关联不同项目的数据')
}

// ============ 统一业务关系 ============

export function createBusinessRelation(relation) {
  assertSafeProjectName(relation.project_name)
  const sourceType = normalizeEntityType(relation.source_type)
  const targetType = normalizeEntityType(relation.target_type)
  const sourceId = normalizeEntityId(relation.source_id)
  const targetId = normalizeEntityId(relation.target_id)
  if (sourceType === targetType && sourceId === targetId) throw new Error('业务对象不能关联自身')
  assertEntityInProject(relation.project_name, sourceType, sourceId)
  assertEntityInProject(relation.project_name, targetType, targetId)
  const relationType = clampText(relation.relation_type, 80, 'relation_type').trim()
  if (!relationType) throw new Error('关系类型不能为空')
  const now = new Date().toISOString()
  const metadata = relation.metadata == null ? null : JSON.stringify(relation.metadata)
  getDb().prepare(`
    INSERT INTO business_relation
    (project_name, source_type, source_id, target_type, target_id, relation_type, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_name, source_type, source_id, target_type, target_id, relation_type)
    DO UPDATE SET metadata = excluded.metadata, updated_at = excluded.updated_at
  `).run(relation.project_name, sourceType, sourceId, targetType, targetId, relationType, metadata, now, now)
  return getDb().prepare(`
    SELECT * FROM business_relation
    WHERE project_name = ? AND source_type = ? AND source_id = ?
      AND target_type = ? AND target_id = ? AND relation_type = ?
  `).get(relation.project_name, sourceType, sourceId, targetType, targetId, relationType)
}

export function listBusinessRelations(projectName, entityType, entityId) {
  assertSafeProjectName(projectName)
  const type = normalizeEntityType(entityType)
  const id = normalizeEntityId(entityId)
  return getDb().prepare(`
    SELECT *, CASE WHEN source_type = ? AND source_id = ? THEN 'outgoing' ELSE 'incoming' END direction
    FROM business_relation
    WHERE project_name = ?
      AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
    ORDER BY created_at DESC
  `).all(type, id, projectName, type, id, type, id).map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }))
}

export function deleteBusinessRelation(projectName, relationId) {
  assertSafeProjectName(projectName)
  const db = getDb()
  const relation = db.prepare('SELECT * FROM business_relation WHERE project_name = ? AND id = ?').get(projectName, relationId)
  if (!relation) return false
  db.transaction(() => {
    db.prepare('DELETE FROM business_relation WHERE project_name = ? AND id = ?').run(projectName, relationId)
    if (relation.relation_type === 'rectification_notice' && relation.source_type === 'hazard') {
      db.prepare('UPDATE hazard SET rectification_id = NULL WHERE id = ?').run(relation.source_id)
    }
    if (relation.source_type === 'photo' && relation.relation_type === 'hazard_evidence') {
      db.prepare('UPDATE photo SET linked_hazard_id = NULL WHERE id = ?').run(relation.source_id)
    }
    if (relation.source_type === 'photo' && relation.relation_type === 'progress_evidence') {
      db.prepare('UPDATE photo SET linked_node_id = NULL WHERE id = ?').run(relation.source_id)
    }
  })()
  return true
}

export function countBusinessRelations(projectName, entityType, entityId) {
  assertSafeProjectName(projectName)
  const type = normalizeEntityType(entityType)
  const id = normalizeEntityId(entityId)
  return getDb().prepare(`
    SELECT COUNT(*) count FROM business_relation
    WHERE project_name = ?
      AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
  `).get(projectName, type, id, type, id).count
}

// ============ AI 事实证据 ============

export function createEvidenceItem(item) {
  assertSafeProjectName(item.project_name)
  const title = clampText(item.title, 200, 'title').trim()
  if (!title) throw new Error('证据标题不能为空')
  const status = ['confirmed', 'pending', 'invalid'].includes(item.status) ? item.status : 'pending'
  const now = new Date().toISOString()
  const info = getDb().prepare(`
    INSERT INTO evidence_item
    (project_name, title, evidence_type, source_ref, source_location, excerpt, status, critical, confirmed_by, confirmed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.project_name, title, clampText(item.evidence_type || 'other', 50, 'evidence_type'),
    clampText(item.source_ref, 1000, 'source_ref'), clampText(item.source_location, 500, 'source_location'),
    clampText(item.excerpt, 4000, 'excerpt'), status, item.critical ? 1 : 0,
    status === 'confirmed' ? clampText(item.confirmed_by, 100, 'confirmed_by') : '',
    status === 'confirmed' ? (item.confirmed_at || now) : null, now, now,
  )
  return getDb().prepare('SELECT * FROM evidence_item WHERE id = ?').get(info.lastInsertRowid)
}

export function listEvidenceItems(projectName, options = {}) {
  assertSafeProjectName(projectName)
  const status = options.status && ['confirmed', 'pending', 'invalid'].includes(options.status) ? options.status : null
  return status
    ? getDb().prepare('SELECT * FROM evidence_item WHERE project_name = ? AND status = ? ORDER BY created_at DESC').all(projectName, status)
    : getDb().prepare('SELECT * FROM evidence_item WHERE project_name = ? ORDER BY created_at DESC').all(projectName)
}

export function updateEvidenceStatus(projectName, id, status, confirmedBy = '') {
  assertSafeProjectName(projectName)
  if (!['confirmed', 'pending', 'invalid'].includes(status)) throw new Error('无效的证据状态')
  const now = new Date().toISOString()
  const result = getDb().prepare(`
    UPDATE evidence_item SET status = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ?
    WHERE project_name = ? AND id = ?
  `).run(status, status === 'confirmed' ? clampText(confirmedBy, 100, 'confirmed_by') : '', status === 'confirmed' ? now : null, now, projectName, id)
  return result.changes > 0
}

export function validateDocumentEvidence(projectName, evidenceIds = []) {
  assertSafeProjectName(projectName)
  const ids = [...new Set(evidenceIds.map(Number).filter(Number.isInteger))]
  if (!ids.length) return { valid: true, items: [], blockers: [] }
  const placeholders = ids.map(() => '?').join(',')
  const items = getDb().prepare(`SELECT * FROM evidence_item WHERE project_name = ? AND id IN (${placeholders})`).all(projectName, ...ids)
  const found = new Set(items.map(item => item.id))
  const blockers = [
    ...ids.filter(id => !found.has(id)).map(id => ({ id, reason: '证据不存在或不属于当前项目' })),
    ...items.filter(item => item.critical && item.status !== 'confirmed').map(item => ({ id: item.id, reason: `关键证据状态为 ${item.status}` })),
    ...items.filter(item => item.status === 'invalid').map(item => ({ id: item.id, reason: '证据已失效' })),
  ]
  return { valid: blockers.length === 0, items, blockers }
}

export function linkDocumentEvidence(projectName, documentId, evidenceIds = []) {
  return evidenceIds.map(evidenceId => createBusinessRelation({
    project_name: projectName, source_type: 'document', source_id: documentId,
    target_type: 'evidence', target_id: evidenceId, relation_type: 'document_evidence',
  }))
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
  const hazard = getDb().prepare('SELECT project_name FROM hazard WHERE id = ?').get(hazardId)
  const correspondence = getDb().prepare('SELECT project_name FROM correspondence WHERE id = ?').get(correspondenceId)
  if (!hazard || !correspondence) throw new Error('隐患或整改函件不存在')
  if (hazard.project_name !== correspondence.project_name) throw new Error('禁止关联不同项目的数据')
  getDb().transaction(() => {
    getDb().prepare('UPDATE hazard SET rectification_id = ? WHERE id = ?').run(correspondenceId, hazardId)
    createBusinessRelation({
      project_name: hazard.project_name,
      source_type: 'hazard', source_id: hazardId,
      target_type: 'correspondence', target_id: correspondenceId,
      relation_type: 'rectification_notice',
    })
  })()
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
    (project_name, name, plan_start, plan_end, actual_start, actual_end, progress_percent, weight, parent_id, source_file, source_sheet, source_row, import_batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    n.project_name, n.name, n.plan_start || null, n.plan_end || null,
    n.actual_start || null, n.actual_end || null,
    n.progress_percent || 0, n.weight || 1, n.parent_id || null,
    n.source_file || null, n.source_sheet || null, n.source_row || null, n.import_batch_id || null,
    now, now,
  )
  return info.lastInsertRowid
}

export function importProgressNodes(projectName, nodes, sourceFile, sourceHash = '') {
  assertSafeProjectName(projectName)
  const db = getDb()
  const existing = db.prepare('SELECT id FROM progress_import_batch WHERE project_name = ? AND source_file = ? AND source_hash = ?').get(projectName, sourceFile, sourceHash)
  if (existing) return { duplicate: true, batchId: existing.id, ids: [] }
  const tx = db.transaction(() => {
    const batch = db.prepare('INSERT INTO progress_import_batch (project_name, source_file, source_hash, imported_at, imported_count) VALUES (?, ?, ?, ?, ?)')
      .run(projectName, sourceFile, sourceHash, new Date().toISOString(), nodes.length)
    const ids = nodes.map(node => insertProgressNode({ ...node, project_name: projectName, source_file: sourceFile, source_sheet: node.sourceSheet || node.source_sheet || '', source_row: node.sourceRow || node.source_row || null, import_batch_id: batch.lastInsertRowid }))
    return { duplicate: false, batchId: batch.lastInsertRowid, ids }
  })
  return tx()
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
  const node = getDb().prepare('SELECT project_name FROM progress_node WHERE id = ?').get(id)
  if (!node) return
  const relationCount = countBusinessRelations(node.project_name, 'progress_node', id)
  if (relationCount > 0) throw new Error(`该进度节点存在 ${relationCount} 条业务关联，请先解除关联后再删除`)
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
  const id = info.lastInsertRowid
  const relatedNodes = Array.isArray(p.related_nodes)
    ? p.related_nodes
    : (() => { try { return JSON.parse(p.related_nodes || '[]') } catch { return [] } })()
  for (const nodeId of relatedNodes) {
    createBusinessRelation({
      project_name: p.project_name,
      source_type: 'payment_request', source_id: id,
      target_type: 'progress_node', target_id: nodeId,
      relation_type: 'payment_progress',
    })
  }
  if (p.contract_id) createBusinessRelation({
    project_name: p.project_name,
    source_type: 'contract', source_id: p.contract_id,
    target_type: 'payment_request', target_id: id,
    relation_type: 'contract_payment',
  })
  return id
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
  const id = info.lastInsertRowid
  if (c.contract_id) createBusinessRelation({
    project_name: c.project_name,
    source_type: 'contract', source_id: c.contract_id,
    target_type: 'change_order', target_id: id,
    relation_type: 'contract_change',
  })
  return id
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
  const id = info.lastInsertRowid
  if (p.linked_hazard_id) createBusinessRelation({
    project_name: p.project_name,
    source_type: 'photo', source_id: id,
    target_type: 'hazard', target_id: p.linked_hazard_id,
    relation_type: 'hazard_evidence',
  })
  if (p.linked_node_id) createBusinessRelation({
    project_name: p.project_name,
    source_type: 'photo', source_id: id,
    target_type: 'progress_node', target_id: p.linked_node_id,
    relation_type: 'progress_evidence',
  })
  return id
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
  const existing = getDb().prepare(`
    SELECT id FROM ledger_simple
    WHERE project_name = ? AND ledger_type = ? AND file_name = ?
  `).get(projectName, ledgerType, item.fileName || '')
  if (existing) return existing.id
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

/**
 * 文书正式落盘后同步到 SQLite 业务台账。JSON 台账仍保留为可移交副本，
 * 但 AI 数据查询、业务面板与签发状态统一使用这里，避免两套事实源漂移。
 */
export function recordIssuedDocument({ projectName, docType, fileName, subDir, fileNumber = '', meta = {} }) {
  assertSafeProjectName(projectName)
  const createdAt = new Date().toISOString()
  const correspondenceTypes = new Set(['整改通知书', '安全通知书', '工程联系单', '工程函件', '停工令'])
  if (correspondenceTypes.has(docType)) {
    const exists = getDb().prepare('SELECT id FROM correspondence WHERE project_name = ? AND file_name = ?').get(projectName, fileName)
    if (exists) return exists.id
    return insertCorrespondence({
      project_name: projectName, doc_type: docType, file_name: fileName, sub_dir: subDir,
      file_number: fileNumber, subject: meta.subject || '', respondent: meta.respondent || '',
      deadline: meta.deadline || '', responsible: meta.responsible || '', status: meta.status || '正式件',
      source: 'ai生成', created_at: createdAt,
    })
  }
  const ledgerType = docType === '监理日志' || docType === '监理周报' || docType === '监理月报'
    ? 'log' : docType === '会议纪要' ? 'meeting' : docType === '施工方案' ? 'construction' : 'document'
  return insertSimpleLedger(projectName, ledgerType, { fileName, subDir, createdAt, docType, fileNumber, status: meta.status || '正式件', subject: meta.subject || '' })
}

// ============ 项目主数据中心 ============

const MASTER_CONFIG = {
  participant: {
    table: 'project_participant',
    fields: ['organization_type', 'organization_name', 'credit_code', 'contact_name', 'contact_phone'],
    required: ['organization_type', 'organization_name'],
  },
  member: {
    table: 'project_member',
    fields: ['member_name', 'role', 'phone', 'certificate_no'],
    required: ['member_name', 'role'],
  },
  structure: {
    table: 'project_structure',
    fields: ['structure_type', 'name', 'code', 'parent_id'],
    required: ['structure_type', 'name'],
  },
}

function masterConfig(entityType) {
  const config = MASTER_CONFIG[entityType]
  if (!config) throw new Error(`不支持的主数据类型：${entityType}`)
  return config
}

function parseMasterRow(row) {
  return row || null
}

export function listMasterData(projectName, entityType, { includeHistory = false } = {}) {
  assertSafeProjectName(projectName)
  const { table } = masterConfig(entityType)
  return getDb().prepare(`SELECT * FROM ${table} WHERE project_name = ? ${includeHistory ? '' : "AND status = 'active'"} ORDER BY created_at DESC`).all(projectName)
}

export function saveMasterData(projectName, entityType, data, replacingId = null) {
  assertSafeProjectName(projectName)
  const config = masterConfig(entityType)
  for (const field of config.required) {
    if (!String(data?.[field] ?? '').trim()) throw new Error(`${field} 不能为空`)
  }
  const db = getDb()
  const now = new Date().toISOString()
  const effectiveFrom = data.effective_from || now
  if (!Number.isFinite(new Date(effectiveFrom).getTime())) throw new Error('生效时间格式无效')
  return db.transaction(() => {
    let before = null
    if (replacingId) {
      before = db.prepare(`SELECT * FROM ${config.table} WHERE project_name = ? AND id = ? AND status = 'active'`).get(projectName, replacingId)
      if (!before) throw new Error('要变更的主数据不存在或已失效')
      if (new Date(effectiveFrom).getTime() < new Date(before.effective_from).getTime()) throw new Error('新版本生效时间不能早于原版本')
      db.prepare(`UPDATE ${config.table} SET status = 'inactive', effective_to = ?, updated_at = ? WHERE id = ?`).run(effectiveFrom, now, replacingId)
    }
    const fields = config.fields
    const columns = ['project_name', ...fields, 'effective_from', 'effective_to', 'status', 'created_at', 'updated_at']
    const values = [projectName, ...fields.map(field => data[field] ?? null), effectiveFrom, null, 'active', now, now]
    const info = db.prepare(`INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
    const after = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(info.lastInsertRowid)
    db.prepare(`INSERT INTO master_data_change (project_name, entity_type, entity_id, action, before_value, after_value, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(projectName, entityType, String(info.lastInsertRowid), before ? 'replace' : 'create', before ? JSON.stringify(before) : null, JSON.stringify(after), now)
    return parseMasterRow(after)
  })()
}

export function retireMasterData(projectName, entityType, id) {
  assertSafeProjectName(projectName)
  const { table } = masterConfig(entityType)
  const db = getDb()
  const now = new Date().toISOString()
  return db.transaction(() => {
    const before = db.prepare(`SELECT * FROM ${table} WHERE project_name = ? AND id = ? AND status = 'active'`).get(projectName, id)
    if (!before) return false
    db.prepare(`UPDATE ${table} SET status = 'inactive', effective_to = ?, updated_at = ? WHERE id = ?`).run(now, now, id)
    db.prepare(`INSERT INTO master_data_change (project_name, entity_type, entity_id, action, before_value, changed_at) VALUES (?, ?, ?, 'retire', ?, ?)`)
      .run(projectName, entityType, String(id), JSON.stringify(before), now)
    return true
  })()
}

export function setProjectPhase(projectName, phase, note = '', effectiveFrom = '') {
  assertSafeProjectName(projectName)
  const value = clampText(phase, 50, 'phase').trim()
  if (!value) throw new Error('项目阶段不能为空')
  const db = getDb()
  const now = effectiveFrom || new Date().toISOString()
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM project_phase_history WHERE project_name = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1').get(projectName)
    if (current?.phase === value) return current
    if (current) db.prepare('UPDATE project_phase_history SET effective_to = ? WHERE id = ?').run(now, current.id)
    const info = db.prepare('INSERT INTO project_phase_history (project_name, phase, effective_from, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectName, value, now, clampText(note, 500, 'note'), new Date().toISOString())
    const after = db.prepare('SELECT * FROM project_phase_history WHERE id = ?').get(info.lastInsertRowid)
    db.prepare(`INSERT INTO master_data_change (project_name, entity_type, entity_id, action, before_value, after_value, changed_at) VALUES (?, 'phase', ?, 'transition', ?, ?, ?)`)
      .run(projectName, String(info.lastInsertRowid), current ? JSON.stringify(current) : null, JSON.stringify(after), new Date().toISOString())
    return after
  })()
}

export function getProjectPhaseHistory(projectName) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM project_phase_history WHERE project_name = ? ORDER BY effective_from DESC, id DESC').all(projectName)
}

export function listMasterChanges(projectName, limit = 200) {
  assertSafeProjectName(projectName)
  return getDb().prepare('SELECT * FROM master_data_change WHERE project_name = ? ORDER BY changed_at DESC LIMIT ?').all(projectName, Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(row => ({
    ...row,
    before_value: row.before_value ? JSON.parse(row.before_value) : null,
    after_value: row.after_value ? JSON.parse(row.after_value) : null,
  }))
}

export function getCurrentMasterSnapshot(projectName) {
  assertSafeProjectName(projectName)
  return {
    project: getProjectMeta(projectName) || null,
    participants: listMasterData(projectName, 'participant'),
    members: listMasterData(projectName, 'member'),
    structures: listMasterData(projectName, 'structure'),
    phase: getDb().prepare('SELECT * FROM project_phase_history WHERE project_name = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1').get(projectName) || null,
    captured_at: new Date().toISOString(),
  }
}

export function getCurrentMasterProfile(projectName) {
  const snapshot = getCurrentMasterSnapshot(projectName)
  const organization = type => snapshot.participants.find(item => item.organization_type === type)?.organization_name || ''
  const chief = snapshot.members.find(item => item.role === '总监理工程师')
  return {
    ownerUnit: organization('建设单位'),
    contractor: organization('施工单位'),
    supervisorUnit: organization('监理单位'),
    chiefEngineer: chief?.member_name || '',
    chiefEngineerPhone: chief?.phone || '',
    projectPhase: snapshot.phase?.phase || '',
  }
}

export function saveDocumentMasterSnapshot(projectName, filePath, docType = '') {
  const snapshot = getCurrentMasterSnapshot(projectName)
  getDb().prepare(`INSERT OR REPLACE INTO document_master_snapshot (project_name, file_path, doc_type, master_data, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(projectName, filePath, docType, JSON.stringify(snapshot), snapshot.captured_at)
  return snapshot
}

export function getDocumentMasterSnapshot(filePath) {
  const row = getDb().prepare('SELECT * FROM document_master_snapshot WHERE file_path = ?').get(filePath)
  return row ? { ...row, master_data: JSON.parse(row.master_data) } : null
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

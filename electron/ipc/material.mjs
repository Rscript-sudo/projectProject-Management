/**
 * 项目资料解析与进度导入。
 * 本模块只做本地提取和确定性字段识别；AI 只能使用用户确认后入账的数据。
 */
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'
import { parseMaterial as parseLocalMaterial } from '../materialParser.mjs'
import { getDb } from '../db/database.mjs'

export { parseLocalMaterial as parseMaterial }

const IMPORT_ADAPTERS = {
  progress: { table: 'progress_node', insert: row => repo.insertProgressNode(row), required: ['name'] },
  contract: { table: 'contract', insert: row => repo.insertContract(row), required: ['contract_name'] },
  hazard: { table: 'hazard', insert: row => repo.insertHazard(row), required: ['description'] },
  payment: { table: 'payment_request', insert: row => repo.insertPaymentRequest(row), required: ['period', 'amount'] },
  photo: { table: 'photo', insert: row => repo.insertPhoto(row), required: ['file_name', 'file_path'] },
}

function mapImportRows(records, mapping = {}) {
  return (Array.isArray(records) ? records : []).map((record, index) => ({
    sourceRow: index + 2,
    raw: record,
    mapped: Object.fromEntries(Object.entries(mapping).map(([target, source]) => [target, record?.[source]])),
  }))
}

function sourceHash(sourceFile, records) {
  const payload = sourceFile && fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile) : Buffer.from(JSON.stringify(records || []))
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export function register(ipcMain) {
  ipcMain.handle('material:parse', safeCall(async (_, { filePath }) => parseLocalMaterial(filePath)))
  ipcMain.handle('material:previewUnifiedImport', safeCall((_, { entityType, records, fieldMapping }) => {
    const adapter = IMPORT_ADAPTERS[entityType]
    if (!adapter) throw new Error(`不支持的导入类型：${entityType}`)
    const rows = mapImportRows(records, fieldMapping)
    return {
      success: true, entityType, rows,
      errors: rows.flatMap(row => adapter.required.filter(field => row.mapped[field] == null || row.mapped[field] === '').map(field => ({ sourceRow: row.sourceRow, field, message: '必填字段缺失' }))),
    }
  }))
  ipcMain.handle('material:commitUnifiedImport', safeCall((_, { projectPath, entityType, records, fieldMapping, sourceFile = '' }) => {
    const adapter = IMPORT_ADAPTERS[entityType]
    if (!adapter) throw new Error(`不支持的导入类型：${entityType}`)
    const projectName = path.basename(projectPath)
    const rows = mapImportRows(records, fieldMapping)
    const errors = rows.flatMap(row => adapter.required.filter(field => row.mapped[field] == null || row.mapped[field] === '').map(field => ({ sourceRow: row.sourceRow, field })))
    if (errors.length) return { success: false, validationErrors: errors, error: `有 ${errors.length} 个必填字段未映射` }
    const hash = sourceHash(sourceFile, records)
    const db = getDb()
    const duplicate = db.prepare("SELECT id FROM unified_import_batch WHERE project_name = ? AND entity_type = ? AND source_hash = ? AND status = 'committed'").get(projectName, entityType, hash)
    if (duplicate) return { success: false, duplicate: true, batchId: duplicate.id, error: '相同内容已导入' }
    return db.transaction(() => {
      const archiveDir = path.join(projectPath, '项目数据', '导入源文件')
      fs.mkdirSync(archiveDir, { recursive: true })
      let archivedSource = sourceFile
      if (sourceFile && fs.existsSync(sourceFile)) {
        archivedSource = path.join(archiveDir, `${Date.now()}_${path.basename(sourceFile)}`)
        fs.copyFileSync(sourceFile, archivedSource)
      }
      const batch = db.prepare(`INSERT INTO unified_import_batch (project_name, entity_type, source_file, source_hash, field_mapping, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(projectName, entityType, archivedSource || '手工数据', hash, JSON.stringify(fieldMapping || {}), new Date().toISOString())
      const ids = rows.map(row => {
        const id = adapter.insert({ ...row.mapped, project_name: projectName })
        db.prepare('INSERT INTO unified_import_row (batch_id, entity_table, entity_id, source_row, raw_data) VALUES (?, ?, ?, ?, ?)')
          .run(batch.lastInsertRowid, adapter.table, id, row.sourceRow, JSON.stringify(row.raw))
        return Number(id)
      })
      const report = { batchId: Number(batch.lastInsertRowid), projectName, entityType, importedCount: ids.length, sourceHash: hash, sourceFile: archivedSource, fieldMapping, ids }
      const reportPath = path.join(archiveDir, `导入报告_${batch.lastInsertRowid}.json`)
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
      db.prepare('UPDATE unified_import_batch SET imported_count = ?, report = ? WHERE id = ?').run(ids.length, reportPath, batch.lastInsertRowid)
      repo.logAudit(projectName, 'unified_import.commit', entityType, batch.lastInsertRowid, report)
      return { success: true, ...report, reportPath }
    })()
  }))
  ipcMain.handle('material:undoUnifiedImport', safeCall((_, { projectName, batchId }) => {
    const db = getDb()
    return db.transaction(() => {
      const batch = db.prepare("SELECT * FROM unified_import_batch WHERE project_name = ? AND id = ? AND status = 'committed'").get(projectName, batchId)
      if (!batch) throw new Error('导入批次不存在或已撤销')
      const rows = db.prepare('SELECT * FROM unified_import_row WHERE batch_id = ? ORDER BY id DESC').all(batchId)
      for (const row of rows) {
        db.prepare('DELETE FROM business_relation WHERE project_name = ? AND ((source_type IN (?, ?) AND source_id = ?) OR (target_type IN (?, ?) AND target_id = ?))')
          .run(projectName, batch.entity_type, row.entity_table, String(row.entity_id), batch.entity_type, row.entity_table, String(row.entity_id))
        db.prepare(`DELETE FROM ${row.entity_table} WHERE id = ? AND project_name = ?`).run(row.entity_id, projectName)
      }
      db.prepare("UPDATE unified_import_batch SET status = 'undone', undone_at = ? WHERE id = ?").run(new Date().toISOString(), batchId)
      repo.logAudit(projectName, 'unified_import.undo', batch.entity_type, batchId, { count: rows.length })
      return { success: true, batchId, removedCount: rows.length }
    })()
  }))
  ipcMain.handle('material:importProgress', safeCall(async (_, { projectPath, nodes, sourceFile }) => {
    if (!projectPath) throw new Error('未选择项目')
    const projectName = path.basename(projectPath)
    const validNodes = Array.isArray(nodes) ? nodes.filter(node => String(node?.name || '').trim()) : []
    if (!validNodes.length) throw new Error('没有可导入的进度节点')
    const sourceHash = sourceFile && fs.existsSync(sourceFile) ? crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex') : ''
    const imported = repo.importProgressNodes(projectName, validNodes, sourceFile || '手工导入', sourceHash)
    if (imported.duplicate) return { success: false, duplicate: true, error: '该进度表已导入过；请在台账中编辑节点，避免重复累计。' }
    repo.logAudit(projectName, 'progress.import', 'progress_node', imported.ids[0], { count: imported.ids.length, sourceFile: sourceFile || '', sourceHash, batchId: imported.batchId })
    return { success: true, count: imported.ids.length, ids: imported.ids, batchId: imported.batchId }
  }))
}

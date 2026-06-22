/**
 * 数据迁移 — 把老 JSON 台账一次性导入 SQLite
 * 触发时机：首次启动或检测到旧 JSON 时
 * 原则：
 *   1. 旧 JSON 文件保留不动（只读副本）
 *   2. 重复运行安全（基于 fileName + createdAt 去重）
 *   3. 失败不阻塞主流程
 */

import path from 'path'
import fs from 'fs'
import { getDb, isMigrated, markMigrated } from './database.mjs'
import { getProjectIndexPath, getProjectDataPath } from '../ipc/shared.mjs'

// 旧 JSON 文件 → 新表名映射
const LEGACY_LEDGER_FILES = [
  { file: '合同台账.json', type: 'contract' },
  { file: '往来函件登记台账.json', type: 'correspondence' },
  { file: '隐患台账.json', type: 'hazard' },
  { file: '会议纪要台账.json', type: 'meeting' },
  { file: '施工方案台账.json', type: 'construction' },
  { file: '监理日志台账.json', type: 'log' },
]

/**
 * 主迁移入口
 */
export function runMigrations() {
  const db = getDb()
  if (isMigrated()) {
    console.log('[migrations] Already done, skip')
    return { skipped: true }
  }

  const result = {
    projects: 0,
    ledgers: 0,
    correspondences: 0,
    hazards: 0,
    numberingRules: 0,
    errors: [],
  }

  try {
    migrateProjects(db, result)
    migrateLedgers(db, result)
    migrateNumbering(db, result)
    markMigrated()
    console.log('[migrations] Done:', result)
  } catch (e) {
    console.error('[migrations] Failed:', e.message)
    result.errors.push(e.message)
  }
  return result
}

function migrateProjects(db, result) {
  // 从 project-index.json 读项目列表
  const indexPath = getProjectIndexPath()
  if (!fs.existsSync(indexPath)) return

  let index
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } catch {
    return
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO project_meta
    (project_name, project_path, project_type, contractor, owner_unit, supervisor_unit, chief_engineer, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const proj of index.projects || []) {
    // 从每个项目的 project.config.json 读详情
    const configPath = path.join(getProjectDataPath(proj.name), 'project.config.json')
    let cfg = {
      projectType: '通用',
      contractor: '',
      ownerUnit: '',
      supervisorUnit: '',
      chiefEngineer: '',
    }
    if (fs.existsSync(configPath)) {
      try {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }
      } catch {}
    }

    const now = new Date().toISOString()
    stmt.run(
      proj.name,
      proj.path,
      cfg.projectType || '通用',
      cfg.contractor || '',
      cfg.ownerUnit || '',
      cfg.supervisorUnit || '',
      cfg.chiefEngineer || '',
      proj.addedAt || now,
      now,
    )
    result.projects++
  }
}

function migrateLedgers(db, result) {
  // 找出所有项目名
  const projects = db.prepare('SELECT project_name, project_path FROM project_meta').all()
  for (const proj of projects) {
    const dataDir = getProjectDataPath(proj.project_name)
    for (const { file, type } of LEGACY_LEDGER_FILES) {
      const fp = path.join(dataDir, file)
      if (!fs.existsSync(fp)) continue

      let data
      try {
        data = JSON.parse(fs.readFileSync(fp, 'utf8'))
      } catch {
        continue
      }
      const items = Array.isArray(data.items) ? data.items : []

      for (const item of items) {
        // 函件走 correspondence 表，其他走 ledger_simple
        if (type === 'correspondence') {
          migrateCorrespondence(db, proj.project_name, item, result)
        } else if (type === 'hazard') {
          migrateHazard(db, proj.project_name, item, result)
        } else {
          migrateSimpleLedger(db, proj.project_name, type, item, result)
        }
      }
    }
  }
}

function migrateSimpleLedger(db, projectName, type, item, result) {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO ledger_simple
      (project_name, ledger_type, file_name, sub_dir, created_at, doc_type, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const meta = { ...item }
    delete meta.fileName
    delete meta.subDir
    delete meta.createdAt
    delete meta.docType
    stmt.run(
      projectName,
      type,
      item.fileName || '',
      item.subDir || '',
      item.createdAt || new Date().toISOString().split('T')[0],
      item.docType || '',
      JSON.stringify(meta),
    )
    result.ledgers++
  } catch (e) {
    console.warn('[migrateSimpleLedger]', e.message)
  }
}

function migrateCorrespondence(db, projectName, item, result) {
  try {
    // 检查是否已存在（按 file_name + created_at）
    const exist = db.prepare(`
      SELECT id FROM correspondence WHERE project_name = ? AND file_name = ? AND created_at = ?
    `).get(projectName, item.fileName, item.createdAt)
    if (exist) return

    const stmt = db.prepare(`
      INSERT INTO correspondence
      (project_name, doc_type, file_name, sub_dir, subject, respondent, deadline, responsible, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()
    stmt.run(
      projectName,
      item.docType || '其他',
      item.fileName || '',
      item.subDir || '',
      item.subject || '',
      item.respondent || '',
      item.deadline || '',
      item.responsible || '',
      item.status || '已发出',
      item.source || 'ai生成',
      item.createdAt || now,
      now,
    )
    result.correspondences++
  } catch (e) {
    console.warn('[migrateCorrespondence]', e.message)
  }
}

function migrateHazard(db, projectName, item, result) {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO hazard
      (project_name, dimension, dimension_name, location, description, severity, status, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()
    stmt.run(
      projectName,
      item.dimension || '',
      item.dimensionName || '',
      item.location || '',
      item.description || '',
      item.severity || '一般',
      item.status || '待整改',
      item.source || '巡检',
      item.createdAt || now,
    )
    result.hazards++
  } catch (e) {
    console.warn('[migrateHazard]', e.message)
  }
}

function migrateNumbering(db, result) {
  const projects = db.prepare('SELECT project_name FROM project_meta').all()
  for (const { project_name } of projects) {
    const configPath = path.join(getProjectDataPath(project_name), 'project.config.json')
    if (!fs.existsSync(configPath)) continue
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      continue
    }
    const numbering = cfg.numbering || {}
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO numbering_rules
      (project_name, doc_type, prefix, reset, last_date, last_seq)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const [docType, rule] of Object.entries(numbering)) {
      if (!rule || typeof rule !== 'object') continue
      stmt.run(
        project_name,
        docType,
        rule.prefix || '',
        rule.reset || 'monthly',
        rule.lastDate || '',
        rule.lastSeq || 0,
      )
      result.numberingRules++
    }
  }
}
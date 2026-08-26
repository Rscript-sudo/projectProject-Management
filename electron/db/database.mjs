/**
 * SQLite 数据库 — 单例、首次启动自动建表
 * 文件位置：app.getPath('userData')/db.sqlite
 * 替代原来的 userData/projects/{name}/*.json 台账
 */

import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { app } from 'electron'

let _db = null

/**
 * 获取 SQLite 单例（首次调用时建表）
 */
export function getDb() {
  if (_db) return _db

  const dbPath = path.join(app.getPath('userData'), 'db.sqlite')
  _db = new Database(dbPath)

  // 启用 WAL（写性能 + 读并发）
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  // 写性能与崩溃安全的折中：NORMAL 在 WAL 模式下足够安全（事务边界有 fsync）
  _db.pragma('synchronous = NORMAL')
  // 并发写时最多等锁 5 秒，避免 SQLITE_BUSY 直接失败
  _db.pragma('busy_timeout = 5000')

  initSchema(_db)
  return _db
}

/**
 * 建表 — 11 张业务表
 * 命名：snake_case，表名以模块前缀
 */
function initSchema(db) {
  db.exec(`
    -- 项目元数据（替代 project.config.json）
    CREATE TABLE IF NOT EXISTS project_meta (
      project_name TEXT PRIMARY KEY,
      project_path TEXT NOT NULL UNIQUE,
      project_type TEXT DEFAULT '通用',
      contractor TEXT DEFAULT '',
      owner_unit TEXT DEFAULT '',
      supervisor_unit TEXT DEFAULT '',
      chief_engineer TEXT DEFAULT '',
      contract_amount REAL,
      start_date TEXT,
      end_date TEXT,
      chief_engineer_phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 编号规则（从 project.config.json.numbering 迁过来）
    CREATE TABLE IF NOT EXISTS numbering_rules (
      project_name TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      prefix TEXT,
      reset TEXT,
      last_date TEXT,
      last_seq INTEGER DEFAULT 0,
      PRIMARY KEY (project_name, doc_type)
    );

    -- 通用台账（合同/会议/方案/日志）— 简表
    CREATE TABLE IF NOT EXISTS ledger_simple (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      ledger_type TEXT NOT NULL,    -- contract/correspondence/hazard/meeting/construction/log
      file_name TEXT NOT NULL,
      sub_dir TEXT,
      created_at TEXT,
      doc_type TEXT,
      -- 通用扩展字段（JSON 字符串）
      meta TEXT,
      UNIQUE(project_name, ledger_type, file_name, created_at)
    );

    -- 函件业务字段（A2 的 5 字段升级版 + 状态机）
    CREATE TABLE IF NOT EXISTS correspondence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      doc_type TEXT NOT NULL,         -- 整改通知书/安全通知书/工程联系单/工程函件/停工令
      file_name TEXT NOT NULL,
      sub_dir TEXT,
      file_number TEXT,               -- 编号：ZX-202606-001
      subject TEXT,                   -- 事由
      respondent TEXT,                -- 被致送/被整改单位
      deadline TEXT,                  -- 期限
      responsible TEXT,               -- 责任人
      status TEXT DEFAULT '已发出',   -- 已发出/已回复/已复查/已关闭/超期未回复
      review_date TEXT,               -- 复查日期
      source TEXT,                    -- 来源：ai生成/巡检/手动
      source_ref TEXT,                -- 来源关联 ID（如巡检记录 ID）
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_corr_project ON correspondence(project_name);
    CREATE INDEX IF NOT EXISTS idx_corr_status ON correspondence(project_name, status);

    -- 隐患 — 独立表（整改通知之外的隐患来源，如现场巡视）
    CREATE TABLE IF NOT EXISTS hazard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      dimension TEXT,                 -- electrical/height/edge/hotwork/fire
      dimension_name TEXT,
      location TEXT,
      description TEXT,
      severity TEXT DEFAULT '一般',    -- 一般/较重/严重
      status TEXT DEFAULT '待整改',    -- 待整改/整改中/已复查/已关闭/超期
      source TEXT,                    -- 巡检/函件/手动
      source_ref TEXT,                -- 关联函件 ID
      rectification_id INTEGER,        -- 关联到 correspondence.id
      deadline TEXT,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hazard_project ON hazard(project_name);
    CREATE INDEX IF NOT EXISTS idx_hazard_status ON hazard(project_name, status);

    -- 进度计划 — 节点式（横道图数据源）
    CREATE TABLE IF NOT EXISTS progress_node (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      name TEXT NOT NULL,             -- 节点名称
      plan_start TEXT,
      plan_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      progress_percent INTEGER DEFAULT 0,  -- 实际进度
      weight REAL DEFAULT 1,          -- 权重（用于计算总进度）
      parent_id INTEGER,              -- 支持父子层级
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 导入批次：让进度事实可回溯至源文件、工作表与行号，也用于防止重复导入。
    CREATE TABLE IF NOT EXISTS progress_import_batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_hash TEXT,
      imported_at TEXT NOT NULL,
      imported_count INTEGER NOT NULL DEFAULT 0
    );

    -- 付款审批
    CREATE TABLE IF NOT EXISTS payment_request (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      period TEXT NOT NULL,           -- 期次 2026-06
      amount REAL NOT NULL,
      amount_upper TEXT,
      cumulative_amount REAL,
      cumulative_percent REAL,
      description TEXT,
      approval_stage TEXT DEFAULT '监理员',  -- 监理员/专业监理/总监/业主/已完成
      approval_history TEXT,          -- JSON：[{stage, person, time, opinion}]
      related_nodes TEXT,            -- JSON：本月完成的工程节点 ID 列表
      status TEXT DEFAULT '审批中',    -- 审批中/已通过/已驳回/已支付
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 合同 — 简化模型（台账）
    CREATE TABLE IF NOT EXISTS contract (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      contract_name TEXT NOT NULL,
      contract_type TEXT,             -- 施工/设计/监理/采购
      party_a TEXT,                   -- 甲方
      party_b TEXT,                   -- 乙方
      amount REAL,
      sign_date TEXT,
      start_date TEXT,
      end_date TEXT,
      file_name TEXT,
      status TEXT DEFAULT '执行中',    -- 执行中/已到期/已终止
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 变更单
    CREATE TABLE IF NOT EXISTS change_order (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      change_number TEXT,             -- 变更编号
      subject TEXT,
      initiator TEXT,                 -- 发起方：业主/施工/监理
      reason TEXT,
      content TEXT,                   -- 变更内容
      amount_change REAL,             -- 金额变化
      schedule_change INTEGER,        -- 工期变化（天）
      status TEXT DEFAULT '草稿',      -- 草稿/审批中/已批准/已驳回
      file_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 索赔
    CREATE TABLE IF NOT EXISTS claim (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      claim_number TEXT,
      claimant TEXT,                  -- 索赔方
      subject TEXT,
      amount REAL,
      reason TEXT,
      evidence TEXT,                  -- 证据描述
      status TEXT DEFAULT '草稿',      -- 草稿/提交中/审批中/已批准/已驳回
      file_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 照片归档
    CREATE TABLE IF NOT EXISTS photo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      shoot_date TEXT,                -- 拍摄日期
      location TEXT,                  -- 部位
      tags TEXT,                      -- 逗号分隔的标签
      description TEXT,
      linked_hazard_id INTEGER,       -- 关联隐患
      linked_node_id INTEGER,         -- 关联进度节点
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photo_project ON photo(project_name);
    CREATE INDEX IF NOT EXISTS idx_photo_date ON photo(project_name, shoot_date);

    -- 统一业务关系：跨模块关联的唯一真相源。旧表中的 linked_* / related_nodes
    -- 继续保留兼容，但新功能统一读写本表。
    CREATE TABLE IF NOT EXISTS business_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_name, source_type, source_id, target_type, target_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_relation_source
      ON business_relation(project_name, source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_relation_target
      ON business_relation(project_name, target_type, target_id);

    -- AI 事实证据：正式件只能引用已确认的关键证据。
    CREATE TABLE IF NOT EXISTS evidence_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      title TEXT NOT NULL,
      evidence_type TEXT NOT NULL DEFAULT 'other',
      source_ref TEXT,
      source_location TEXT,
      excerpt TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('confirmed', 'pending', 'invalid')),
      critical INTEGER NOT NULL DEFAULT 0,
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_project_status
      ON evidence_item(project_name, status, critical);

    CREATE TABLE IF NOT EXISTS unified_import_batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      field_mapping TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      imported_count INTEGER NOT NULL DEFAULT 0,
      report TEXT,
      created_at TEXT NOT NULL,
      undone_at TEXT,
      UNIQUE(project_name, entity_type, source_hash, status)
    );
    CREATE TABLE IF NOT EXISTS unified_import_row (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      entity_table TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      source_row INTEGER,
      raw_data TEXT,
      FOREIGN KEY(batch_id) REFERENCES unified_import_batch(id)
    );
    CREATE INDEX IF NOT EXISTS idx_unified_import_row_batch ON unified_import_row(batch_id);

    -- 项目主数据：所有对象采用生效区间和状态，禁止覆盖历史事实。
    CREATE TABLE IF NOT EXISTS project_participant (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      organization_type TEXT NOT NULL,
      organization_name TEXT NOT NULL,
      credit_code TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_participant_active ON project_participant(project_name, status, organization_type);

    CREATE TABLE IF NOT EXISTS project_member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      member_name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      certificate_no TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_member_active ON project_member(project_name, status, role);

    CREATE TABLE IF NOT EXISTS project_structure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      structure_type TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      parent_id INTEGER,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_structure_project ON project_structure(project_name, structure_type, status);

    CREATE TABLE IF NOT EXISTS project_phase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      phase TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_phase_current ON project_phase_history(project_name, effective_to);

    CREATE TABLE IF NOT EXISTS master_data_change (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_master_change ON master_data_change(project_name, changed_at);

    CREATE TABLE IF NOT EXISTS document_master_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      doc_type TEXT,
      master_data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 系统事件日志（审计追踪，B 后期用）
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      detail TEXT,                    -- JSON
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  // 兼容既有数据库：SQLite 的 CREATE TABLE 不会补列，升级时明确追加。
  db.transaction(() => {
    for (const statement of [
      'ALTER TABLE progress_node ADD COLUMN source_file TEXT',
      'ALTER TABLE progress_node ADD COLUMN source_sheet TEXT',
      'ALTER TABLE progress_node ADD COLUMN source_row INTEGER',
      'ALTER TABLE progress_node ADD COLUMN import_batch_id INTEGER',
      "ALTER TABLE project_structure ADD COLUMN effective_from TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE project_structure ADD COLUMN effective_to TEXT',
    ]) {
      try { db.exec(statement) } catch (error) { if (!/duplicate column name/i.test(error.message)) throw error }
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_progress_source ON progress_node(project_name, source_file, source_sheet, source_row)')
    db.prepare('INSERT OR IGNORE INTO schema_migration (version, name, applied_at) VALUES (3, ?, ?)').run('P1-P6 unified capabilities', new Date().toISOString())
  })()
}

/**
 * 关闭数据库（应用退出时调用）
 * 先做 WAL checkpoint 把 WAL 文件刷回主库，避免强杀丢数据
 * 返回 true 表示正常关闭，false 表示已经在关闭中（防止重入）
 */
export function closeDb() {
  if (!_db) return false
  try {
    // TRUNCATE 模式：checkpoint + 把 WAL 文件截断到 0，节省磁盘
    _db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (e) {
    console.error('[DB] WAL checkpoint failed:', e.message)
  }
  try {
    _db.close()
  } catch (e) {
    console.error('[DB] close failed:', e.message)
  }
  _db = null
  return true
}

/**
 * 迁移状态 — 防止重复迁移
 */
export function isMigrated() {
  const db = getDb()
  const row = db.prepare('SELECT id FROM audit_log WHERE action = ? LIMIT 1').get('migration_v1_done')
  return !!row
}

export function markMigrated() {
  const db = getDb()
  db.prepare('INSERT INTO audit_log (action, created_at) VALUES (?, ?)').run(
    'migration_v1_done',
    new Date().toISOString()
  )
}

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
  `)
}

/**
 * 关闭数据库（应用退出时调用）
 */
export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
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
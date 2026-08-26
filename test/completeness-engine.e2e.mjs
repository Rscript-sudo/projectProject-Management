import assert from 'node:assert/strict'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { evaluateBusinessCompleteness, summarizeIssues } from '../electron/completenessEngine.mjs'

function fixture() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE progress_node (id INTEGER PRIMARY KEY, project_name TEXT, name TEXT, plan_start TEXT, plan_end TEXT, actual_start TEXT, actual_end TEXT, progress_percent INTEGER);
    CREATE TABLE correspondence (id INTEGER PRIMARY KEY, project_name TEXT, subject TEXT, file_name TEXT, file_number TEXT, deadline TEXT, review_date TEXT, status TEXT, created_at TEXT);
    CREATE TABLE hazard (id INTEGER PRIMARY KEY, project_name TEXT, description TEXT, deadline TEXT, status TEXT);
    CREATE TABLE contract (id INTEGER PRIMARY KEY, project_name TEXT, contract_name TEXT, amount REAL, start_date TEXT, end_date TEXT, status TEXT);
    CREATE TABLE business_relation (id INTEGER PRIMARY KEY, project_name TEXT, source_type TEXT, source_id TEXT, target_type TEXT, target_id TEXT, relation_type TEXT);
    CREATE TABLE change_order (id INTEGER PRIMARY KEY, amount_change REAL, status TEXT);
    CREATE TABLE payment_request (id INTEGER PRIMARY KEY, project_name TEXT, period TEXT, amount REAL, cumulative_amount REAL, status TEXT, created_at TEXT);
    CREATE TABLE ledger_simple (id INTEGER PRIMARY KEY, project_name TEXT, doc_type TEXT, file_name TEXT);
  `)
  db.prepare("INSERT INTO progress_node VALUES (1,'P','节点A','2026-08-20','2026-08-01',NULL,NULL,120)").run()
  const correspondence = db.prepare('INSERT INTO correspondence VALUES (?,?,?,?,?,?,?,?,?)')
  correspondence.run(1, 'P', '函件1', 'a.docx', 'ZX-001', '2026-08-10', '2026-08-01', '已发出', '2026-08-05')
  correspondence.run(2, 'P', '函件2', 'b.docx', 'ZX-001', null, null, '已关闭', '2026-08-06')
  correspondence.run(3, 'P', '函件3', 'c.docx', 'ZX-003', null, null, '已关闭', '2026-08-07')
  db.prepare("INSERT INTO hazard VALUES (1,'P','临电隐患','2026-08-10','待整改')").run()
  db.prepare("INSERT INTO contract VALUES (1,'P','施工合同',1000,'2026-09-02','2026-09-01','执行中')").run()
  db.prepare("INSERT INTO change_order VALUES (1,100,'已批准')").run()
  db.prepare("INSERT INTO payment_request VALUES (1,'P','2026-08',1200,900,'已支付','2026-08-15')").run()
  db.prepare("INSERT INTO business_relation VALUES (1,'P','contract','1','change_order','1','contract_change')").run()
  db.prepare("INSERT INTO business_relation VALUES (2,'P','contract','1','payment_request','1','contract_payment')").run()
  db.prepare("INSERT INTO ledger_simple VALUES (1,'P','监理月报','月报.docx')").run()
  return db
}

async function main() {
  await app.whenReady()
  let db = fixture()
  let issues = evaluateBusinessCompleteness(db, 'P', new Date('2026-08-21T00:00:00Z'))
  const codes = new Set(issues.map(item => item.code))
  for (const code of ['DATE_RANGE_INVALID', 'REVIEW_BEFORE_ISSUE', 'NUMBER_DUPLICATE', 'NUMBER_GAP', 'HAZARD_OVERDUE', 'CORRESPONDENCE_OVERDUE', 'CONTRACT_EXPIRING', 'PAYMENT_EXCEEDS_CONTRACT', 'PAYMENT_CUMULATIVE_MISMATCH', 'REPORT_SOURCE_MISSING']) assert.ok(codes.has(code), `缺少规则结果 ${code}`)
  const summary = summarizeIssues(issues)
  assert.ok(summary.error >= 6)
  assert.ok(summary.warning >= 3)
  db.close()

  db = fixture()
  db.prepare("UPDATE hazard SET status = '已关闭'").run()
  db.prepare("UPDATE correspondence SET status = '已关闭', review_date = NULL, deadline = NULL, file_number = CASE id WHEN 1 THEN 'ZX-001' WHEN 2 THEN 'ZX-002' ELSE 'ZX-003' END").run()
  db.prepare("UPDATE progress_node SET plan_start = '2026-08-01', plan_end = '2026-08-20', progress_percent = 100").run()
  db.prepare("UPDATE contract SET start_date = '2026-08-01', amount = 2000, end_date = '2027-01-01'").run()
  db.prepare("UPDATE payment_request SET cumulative_amount = 1200").run()
  db.prepare("INSERT INTO business_relation VALUES (3,'P','document','1','progress_node','1','document_evidence')").run()
  issues = evaluateBusinessCompleteness(db, 'P', new Date('2026-08-21T00:00:00Z'))
  assert.deepEqual(issues, [])
  db.close()
  console.log('COMPLETENESS ENGINE E2E PASS: detect / repair / disappear')
}

main().catch(error => { console.error('COMPLETENESS ENGINE E2E FAIL:', error.stack || error); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))

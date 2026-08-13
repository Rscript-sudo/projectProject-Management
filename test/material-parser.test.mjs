import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseMaterial } from '../electron/materialParser.mjs'

test('Excel 进度表解析为可确认的进度节点并保留来源位置', async () => {
  const xlsxModule = await import('xlsx')
  const XLSX = xlsxModule.default || xlsxModule
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['任务名称', '计划开始', '计划结束', '实际开始', '实际结束', '完成率', '权重'],
    ['1号楼主体结构', '2026-08-01', '2026-08-20', '2026-08-02', '', '85%', 2],
    ['地下车库防水', '2026-08-10', '2026-08-28', '', '', 0.4, 1],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, '八月计划')
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pms-material-')), '施工进度计划.xlsx')
  XLSX.writeFile(workbook, fixture)

  const result = await parseMaterial(fixture)
  assert.equal(result.success, true)
  assert.equal(result.type, 'excel')
  assert.equal(result.progressCandidates.length, 2)
  assert.deepEqual(result.progressCandidates[0], {
    name: '1号楼主体结构', plan_start: '2026-08-01', plan_end: '2026-08-20',
    actual_start: '2026-08-02', actual_end: '', progress_percent: 85, weight: 2,
    source: '施工进度计划.xlsx｜八月计划!2', sourceSheet: '八月计划', sourceRow: 2,
  })
  assert.equal(result.progressCandidates[1].progress_percent, 40)
  fs.rmSync(path.dirname(fixture), { recursive: true, force: true })
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { buildFileName, DOC_CODE_MAP, DOCUMENT_SUMMARY_MAP, generateProjectCodeFromName, getSubDir, monthSummary, nextVersion } from '../electron/ipc/filename.mjs'

const expected = {
  监理日志: ['JL-RZ', '.docx', '03_实施阶段/01_监理日志'],
  监理周报: ['JL-ZB', '.docx', '03_实施阶段/02_监理周报'],
  监理月报: ['JL-YB', '.docx', '03_实施阶段/03_监理月报'],
  会议纪要: ['HY-JY', '.docx', '03_实施阶段/04_会议纪要'],
  整改通知书: ['ZG-TZ', '.docx', '03_实施阶段/06_往来函件/01_监理整改通知书/原始稿'],
  安全通知书: ['JL-TZ', '.docx', '03_实施阶段/06_往来函件/02_监理安全通知书/原始稿'],
  工程联系单: ['LX-D', '.docx', '03_实施阶段/06_往来函件/03_工程联系单/原始稿'],
  停工令: ['TG-LM', '.docx', '03_实施阶段/06_往来函件/05_停工令/原始稿'],
  开工通知: ['KG-TZ', '.docx', '02_准备阶段/04_开工报审'],
  竣工通知: ['JG-TZ', '.docx', '04_验收阶段/05_竣工移交'],
  工程变更单: ['LX-H', '.xlsx', '03_实施阶段/06_往来函件/04_工程函件/原始稿'],
  工程款支付证书: ['ZF-ZS', '.docx', '03_实施阶段/06_往来函件/06_支付证书/原始稿'],
  进度分析报告: ['JD-FX', '.docx', '03_实施阶段/08_项目进度'],
  开工条件检查表: ['KG-JC', '.docx', '02_准备阶段/04_开工报审/01_开工条件检查表'],
  承建资格报审表: ['CJ-BS', '.docx', '02_准备阶段/04_开工报审/02_承建资格报审'],
  施工组织设计报审表: ['SG-BS', '.docx', '02_准备阶段/04_开工报审/03_施工组织设计报审'],
  总监理工程师任命书: ['ZJ-RM', '.xlsx', '02_准备阶段/04_开工报审/04_总监任命书'],
  监理规划: ['JL-GH', '.docx', '02_准备阶段/02_监理规划'],
}

test('18 个通用模板的编码、扩展名和目录映射唯一且完整', () => {
  const builtin = JSON.parse(fs.readFileSync('src/shared/builtin-doc-types.json', 'utf8'))
  assert.deepEqual(new Set(builtin), new Set(Object.keys(expected)))
  for (const docType of builtin) {
    const [code, ext, subDir] = expected[docType]
    const built = buildFileName({
      docType,
      projectName: '全量验收项目20260830',
      customSummary: '事实核验',
      date: new Date(2026, 7, 30),
    })
    assert.equal(built.code, code, `${docType} 文档编码`)
    assert.equal(built.ext, ext, `${docType} 文件格式`)
    assert.equal(getSubDir(docType), subDir, `${docType} 输出目录`)
    assert.equal(built.fileName, `20260830_${code}_PJ20260830_${built.summary}${ext}`)
    assert.doesNotMatch(built.fileName, /事实核验/)
    if (docType !== '监理周报' && docType !== '监理月报') assert.equal(built.summary, DOCUMENT_SUMMARY_MAP[docType])
  }
})

test('全部内置文种都有固定摘要，任何用户输入都不能进入文件名', () => {
  assert.deepEqual(new Set(Object.keys(DOCUMENT_SUMMARY_MAP)), new Set(Object.keys(DOC_CODE_MAP)))
  for (const docType of Object.keys(DOC_CODE_MAP)) {
    const built = buildFileName({ docType, projectName: '命名验收项目2026', customSummary: '布放20公里光缆，安装15个交接箱', date: new Date(2026, 7, 31) })
    assert.doesNotMatch(built.fileName, /20公里|15个|交接箱|布放|安装/, docType)
    assert.ok(built.summary, `${docType} 固定摘要不能为空`)
  }
})

test('自定义文种使用正式文种名称，不使用用户描述', () => {
  const built = buildFileName({ docType: '设备到货检查表', projectName: '命名验收项目2026', customSummary: '用户随手输入的长句', date: new Date(2026, 7, 31) })
  assert.equal(built.summary, '设备到货检查表')
  assert.match(built.fileName, /_设备到货检查表\.docx$/)
  assert.doesNotMatch(built.fileName, /用户随手输入/)
})

test('周报文件名按 ISO 报告周期固定，跨年时使用归属周年份', () => {
  assert.equal(monthSummary('监理周报', new Date(2027, 0, 1)), '2026年第53周监理周报')
  assert.equal(monthSummary('监理周报', new Date(2027, 0, 4)), '2027年第01周监理周报')
})

test('默认摘要重复生成也按首版、V2、V3 顺序留痕，不覆盖旧文件', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-filename-governance-'))
  try {
    const docType = '整改通知书'
    const summary = buildFileName({ docType, projectName: '版本测试项目' }).summary
    const dir = path.join(projectPath, getSubDir(docType))
    fs.mkdirSync(dir, { recursive: true })
    const businessDate = new Date(2026, 7, 30)
    assert.equal(nextVersion(projectPath, docType, summary, businessDate), '')
    fs.writeFileSync(path.join(dir, `20260830_ZG-TZ_PROJECT_${summary}.docx`), '')
    assert.equal(nextVersion(projectPath, docType, summary, businessDate), 'V2')
    fs.writeFileSync(path.join(dir, `20260830_ZG-TZ_PROJECT_${summary}_V2.docx`), '')
    assert.equal(nextVersion(projectPath, docType, summary, businessDate), 'V3')
    assert.equal(nextVersion(projectPath, docType, summary, new Date(2026, 7, 31)), '', '次日同文种应重新从首版开始')
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true })
  }
})

test('纯中文项目名使用稳定且不冲突的项目码兜底', () => {
  const first = generateProjectCodeFromName('南宁网络改造项目')
  const repeat = generateProjectCodeFromName('南宁网络改造项目')
  const other = generateProjectCodeFromName('柳州网络改造项目')
  assert.match(first, /^PJ[0-9A-F]{8}$/)
  assert.equal(repeat, first)
  assert.notEqual(other, first)
  assert.notEqual(first, 'PROJECT')
})

after(() => setImmediate(() => process.exit(process.exitCode || 0)))

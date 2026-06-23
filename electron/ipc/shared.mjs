import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { encryptSecret, decryptSecret } from './secret.mjs'

export function getDefaultRoot() {
  return path.join(app.getPath('home'), 'Desktop')
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getAppDataPath() {
  return app.getPath('userData')
}

export function getProjectDataPath(projectName) {
  return path.join(getAppDataPath(), 'projects', projectName)
}

export function ensureProjectDataDir(projectName) {
  return ensureDir(getProjectDataPath(projectName))
}

export function createProjectStructure(projectPath, projectName, projectType = '通用') {
  const dirs = [
    '01_项目前期/01_项目合同',
    '01_项目前期/02_招标文件',
    '01_项目前期/03_投标文件',
    '02_准备阶段/01_设计文件',
    '02_准备阶段/02_监理规划',
    '02_准备阶段/03_监理细则',
    '02_准备阶段/04_开工报审/01_开工条件检查表',
    '02_准备阶段/04_开工报审/02_承建资格报审',
    '02_准备阶段/04_开工报审/03_施工组织设计报审',
    '02_准备阶段/04_开工报审/04_总监任命书',
    '02_准备阶段/05_图纸会审',
    '03_实施阶段/01_监理日志',
    '03_实施阶段/02_监理周报',
    '03_实施阶段/03_监理月报',
    '03_实施阶段/04_会议纪要',
    '03_实施阶段/05_安全管理/01_隐患台账',
    '03_实施阶段/05_安全管理/02_现场照片',
    '03_实施阶段/06_往来函件/01_监理整改通知书/原始稿',
    '03_实施阶段/06_往来函件/01_监理整改通知书/签认件',
    '03_实施阶段/06_往来函件/02_监理安全通知书/原始稿',
    '03_实施阶段/06_往来函件/02_监理安全通知书/签认件',
    '03_实施阶段/06_往来函件/03_工程联系单/原始稿',
    '03_实施阶段/06_往来函件/03_工程联系单/签认件',
    '03_实施阶段/06_往来函件/04_工程函件/原始稿',
    '03_实施阶段/06_往来函件/04_工程函件/签认件',
    '03_实施阶段/06_往来函件/05_停工令/原始稿',
    '03_实施阶段/06_往来函件/05_停工令/签认件',
    '03_实施阶段/07_专项汇报',
    '03_实施阶段/08_项目进度',
    '03_实施阶段/09_安全资料',
    '03_实施阶段/10_问题清单',
    '03_实施阶段/11_审计报告',
    '03_实施阶段/12_施工方案',
    '04_验收阶段/01_监理总结',
    '04_验收阶段/02_进场报验',
    '04_验收阶段/03_隐蔽工程',
    '04_验收阶段/04_分部分项验收',
    '04_验收阶段/05_竣工移交',
    '05_缺陷责任期',
  ]

  dirs.forEach(dir => ensureDir(path.join(projectPath, dir)))

  const dataDir = ensureProjectDataDir(projectName)
  const ledgerNames = ['合同台账.json', '往来函件登记台账.json', '隐患台账.json', '会议纪要台账.json', '施工方案台账.json', '监理日志台账.json']
  ledgerNames.forEach(name => {
    const ledgerPath = path.join(dataDir, name)
    if (!fs.existsSync(ledgerPath)) {
      fs.writeFileSync(ledgerPath, JSON.stringify({ items: [] }, null, 2), 'utf8')
    }
  })

  const configPath = path.join(dataDir, 'project.config.json')
  if (!fs.existsSync(configPath)) {
    // 初次创建：自动生成 projectCode（虚竹 v2.0 项目码规则）
    const projectCode = generateProjectCodeFromName(projectName)
    fs.writeFileSync(configPath, JSON.stringify({
      contractor: '',
      ownerUnit: '',
      supervisorUnit: '',
      chiefEngineer: '',
      projectType,
      projectCode,
    }, null, 2), 'utf8')
  }
}

// 复用 filename.mjs 的项目码生成（避免重复实现）
export function generateProjectCodeFromName(projectName) {
  if (!projectName) return 'PROJECT'
  const m = projectName.match(/^([A-Z][A-Z0-9]+)_/)
  if (m) return m[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16) || 'PROJECT'
  const numMatch = projectName.match(/(\d+)/)
  if (numMatch) return `PJ${numMatch[1]}`
  const alphanum = projectName.slice(0, 8).replace(/[^A-Za-z0-9]/g, '')
  if (alphanum) return alphanum.toUpperCase()
  return 'PROJECT'
}

// ===== 项目注册索引 =====
export function getProjectIndexPath() {
  return path.join(app.getPath('userData'), 'project-index.json')
}

export function readProjectIndex() {
  const indexPath = getProjectIndexPath()
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    }
  } catch (e) {
    console.error('[ProjectIndex] Error reading:', e.message)
  }
  return { projects: [] }
}

export function writeProjectIndex(data) {
  try {
    fs.writeFileSync(getProjectIndexPath(), JSON.stringify(data, null, 2), 'utf8')
  } catch (e) {
    console.error('[writeProjectIndex] Error:', e.message)
  }
}

export function ensureProjectIndex(rootPath) {
  const index = readProjectIndex()
  if (!rootPath || !fs.existsSync(rootPath)) return index

  // 项目 = 用户在 index 里显式注册的（通过 fs:createProject 创建的），
  // NOT 根目录下的所有子目录。自动扫描根目录会把"投稿/培训课件"这种普通文件夹当项目，
  // 业务定义错误。只保留 index 里有的 + 路径还存在的。
  const valid = index.projects.filter(p => fs.existsSync(p.path))

  if (valid.length !== index.projects.length) {
    writeProjectIndex({ projects: valid })
  }

  // 防御性补建：如果项目是从外部手工放进 index 的（不是 createProject 流程创建的），
  // dataDir 和 project.config.json 可能缺失。尝试补建一次，避免后续保存 ENOENT。
  for (const p of valid) {
    const dataDir = getProjectDataPath(p.name)
    const configPath = path.join(dataDir, 'project.config.json')
    if (!fs.existsSync(configPath)) {
      try {
        createProjectStructure(p.path, p.name, '通用')
        console.log(`[ensureProjectIndex] 补建数据目录: ${p.name}`)
      } catch (e) {
        console.warn(`[ensureProjectIndex] 补建失败 ${p.name}:`, e.message)
      }
    }
  }

  return { projects: valid }
}

// ===== 台账更新 =====
const LEDGER_DOC_TYPE_MAP = {
  '监理日志': '监理日志台账.json',
  '监理周报': '监理日志台账.json',
  '监理月报': '监理日志台账.json',
  '会议纪要': '会议纪要台账.json',
  '整改通知书': '往来函件登记台账.json',
  '安全通知书': '往来函件登记台账.json',
  '工程联系单': '往来函件登记台账.json',
  '工程函件': '往来函件登记台账.json',
  '停工令': '往来函件登记台账.json',
  '施工方案': '施工方案台账.json',
  '合同': '合同台账.json',
  '投标文件': '合同台账.json',
  '隐患': '隐患台账.json',
}

export function updateLedger(projectPath, subDir, fileName, docType, meta = null) {
  try {
    let ledgerName = null

    if (docType) {
      ledgerName = LEDGER_DOC_TYPE_MAP[docType] || null
    }

    if (!ledgerName) {
      const fileNameLower = (fileName || '').toLowerCase()
      for (const [key, name] of Object.entries(LEDGER_DOC_TYPE_MAP)) {
        if (fileNameLower.includes(key.toLowerCase())) {
          ledgerName = name
          break
        }
      }
    }

    if (!ledgerName) return

    const projectName = path.basename(projectPath || '')
    if (!projectName) return
    const ledgerPath = path.join(getProjectDataPath(projectName), ledgerName)
    let ledger = { items: [] }
    if (fs.existsSync(ledgerPath)) {
      try {
        const raw = fs.readFileSync(ledgerPath, 'utf8')
        ledger = JSON.parse(raw)
        if (!Array.isArray(ledger.items)) ledger = { items: [] }
      } catch {
        ledger = { items: [] }
      }
    }

    const now = new Date().toISOString().split('T')[0]
    const item = { fileName, subDir, createdAt: now }

    // 业务字段（仅整改/停工令/安全通知/工程联系单 这些函件类）
    if (meta && typeof meta === 'object' && ledgerName === '往来函件登记台账.json') {
      item.respondent = meta.respondent || ''       // 被整改/致送单位
      item.deadline = meta.deadline || ''           // 整改期限
      item.responsible = meta.responsible || ''     // 责任人
      item.status = meta.status || '已发出'         // 当前状态
      item.reviewDate = meta.reviewDate || ''      // 复查日期
      item.subject = meta.subject || ''            // 事由
    }

    ledger.items.unshift(item)
    ledger.items = ledger.items.slice(0, 200)

    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8')
  } catch (e) {
    console.error('[updateLedger] Error:', e.message)
  }
}

// ===== 设置 =====
export function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function getDefaultSettings() {
  return {
    projectRoot: getDefaultRoot(),
    aiProvider: 'deepseek',
    apiKey: '',
    baseUrl: '',
    model: 'deepseek-chat',
    autoOpenFile: true,
  }
}

export function getSettings() {
  const settingsPath = getSettingsPath()
  try {
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const merged = { ...getDefaultSettings(), ...saved }
      // 解密 apiKey（如果存的是加密形式），前端拿到明文只在主进程用
      if (typeof merged.apiKey === 'object' && merged.apiKey) {
        const decrypted = decryptSecret(merged.apiKey)
        // decryptSecret 失败时返回 {decryptError: '...'}，透传给前端
        merged.apiKey = decrypted
        if (decrypted && typeof decrypted === 'object' && decrypted.decryptError) {
          merged._apiKeyDecryptError = decrypted.decryptError
        }
      }
      return merged
    }
  } catch (e) {
    console.error('[getSettings] Error:', e.message)
  }
  return getDefaultSettings()
}

/**
 * 给前端用的脱敏 settings —— 不含明文 apiKey，只含 hasApiKey 标志
 * 透传 _apiKeyDecryptError，让前端能区分"未配置"和"配置了解不开"
 */
export function getSettingsForFrontend() {
  const settings = getSettings()
  const { apiKey, _apiKeyDecryptError, ...rest } = settings
  const apiKeyDecryptError = _apiKeyDecryptError || null
  return {
    ...rest,
    hasApiKey: !!apiKey && !apiKeyDecryptError,
    apiKeyDecryptError,
    // 明文存储标志（true = 不用加密，直接落明文）
    apiKeyStoredPlain: !!(apiKey && typeof settings.apiKey === 'object' && settings.apiKey.plain),
  }
}

export function saveSettings(settings) {
  try {
    const toSave = { ...settings }
    // 剔除前端透传的运行时字段——这些不应该落盘
    delete toSave.hasApiKey
    delete toSave.apiKeyDecryptError
    // 如果前端传的是明文 apiKey，加密后落盘；不传或传空字符串则保留原值
    if (typeof toSave.apiKey === 'string') {
      if (toSave.apiKey === '') {
        // 显式清空
        delete toSave.apiKey
      } else {
        toSave.apiKey = encryptSecret(toSave.apiKey)
      }
    }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(toSave, null, 2), 'utf8')
    return { success: true }
  } catch (e) {
    console.error('[saveSettings] Error:', e.message)
    return { success: false, error: e.message }
  }
}

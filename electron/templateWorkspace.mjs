import fs from 'fs'
import path from 'path'

let configured = null

const SCOPE_DIRS = {
  global: '内置模板',
  professional: '专业模板',
  personal: '私人模板',
  other: '其他模板',
}

function copyTreeMissing(source, target) {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyTreeMissing(from, to)
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to)
  }
}

export function configureTemplateWorkspace({ userDataPath, documentsPath, bundledTemplatesDir }) {
  const root = path.join(documentsPath, '项目文档管理系统', '模板库')
  fs.mkdirSync(root, { recursive: true })
  for (const dir of Object.values(SCOPE_DIRS)) fs.mkdirSync(path.join(root, dir), { recursive: true })

  // 安装包中的模板只是只读种子；运行时统一使用用户可定位、可备份的文档目录。
  copyTreeMissing(path.join(bundledTemplatesDir, '通用'), path.join(root, SCOPE_DIRS.global, '通用'))

  // v1.3.x 旧数据从 Application Support 迁移到可见模板库。只复制缺失文件，避免覆盖用户新版本。
  const legacyRoot = path.join(userDataPath, 'template-library')
  const legacyRegistry = path.join(legacyRoot, 'template-registry.json')
  const registryPath = path.join(root, 'template-registry.json')
  if (fs.existsSync(legacyRegistry) && !fs.existsSync(registryPath)) fs.copyFileSync(legacyRegistry, registryPath)
  for (const [scope, targetName] of Object.entries(SCOPE_DIRS)) {
    copyTreeMissing(path.join(legacyRoot, scope), path.join(root, targetName))
  }

  configured = { root, userDataPath, bundledTemplatesDir }
  return configured
}

export function archiveLegacyTemplateLibrary() {
  if (!configured) return { archived: false }
  const legacyRoot = path.join(configured.userDataPath, 'template-library')
  if (!fs.existsSync(legacyRoot) || path.resolve(legacyRoot) === path.resolve(configured.root)) return { archived: false }
  const archiveRoot = path.join(configured.root, '清理归档')
  fs.mkdirSync(archiveRoot, { recursive: true })
  let target = path.join(archiveRoot, '旧版模板库')
  if (fs.existsSync(target)) target = path.join(archiveRoot, `旧版模板库-${Date.now()}`)
  fs.renameSync(legacyRoot, target)
  return { archived: true, target }
}

export function getTemplateWorkspaceRoot(userDataPath) {
  return configured?.root || path.join(userDataPath, 'template-library')
}

export function getTemplateScopeDir(userDataPath, scope) {
  return path.join(getTemplateWorkspaceRoot(userDataPath), SCOPE_DIRS[scope] || SCOPE_DIRS.other)
}

export function getRuntimeSystemTemplatesDir() {
  return configured ? path.join(configured.root, SCOPE_DIRS.global) : null
}

export function getTemplateWorkspaceInfo(userDataPath) {
  const root = getTemplateWorkspaceRoot(userDataPath)
  return {
    root,
    categories: Object.fromEntries(Object.entries(SCOPE_DIRS).map(([scope, name]) => [scope, path.join(root, name)])),
  }
}

export function ensureProfessionalCategory(userDataPath, label) {
  const safeLabel = String(label || '').trim()
  if (!safeLabel || /[\\/:*?"<>|]/.test(safeLabel)) throw new Error('专业名称包含非法字符')
  const directory = path.join(getTemplateScopeDir(userDataPath, 'professional'), safeLabel)
  fs.mkdirSync(directory, { recursive: true })
  return { ok: true, directory }
}

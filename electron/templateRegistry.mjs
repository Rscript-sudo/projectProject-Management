import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeProjectType } from '../src/shared/projectProfile.mjs'
import { getTemplateScopeDir, getTemplateWorkspaceRoot } from './templateWorkspace.mjs'
import { isTemplateReady } from '../src/shared/templateReadiness.mjs'
import { extractTemplateLayoutContract, getTemplateLayoutContractPath } from './templateLayoutContract.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REGISTRY_FILE = 'template-registry.json'

// 内置文种全量清单 — 唯一真相源 src/shared/builtin-doc-types.json
// （渲染层 builtinDocTypes.ts 与主进程都读这份，避免四处手抄漂移）
const SUPPORTED_DOC_TYPES = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'src', 'shared', 'builtin-doc-types.json'), 'utf8'),
)
const BUILTIN_DOC_TYPES = new Set(SUPPORTED_DOC_TYPES)

const DOC_TYPE_NAME_FIXES = new Map([
  ['工程安装质量检查检查表', '工程安装质量检查表'],
  ['软件安装调试纪录', '软件安装调试记录'],
])

export function cleanTemplateDocType(value) {
  let name = String(value || '').trim().replace(/[「」]/g, '').replace(/[_＿]+/g, '')
  name = name.replace(/(?:模版|模板)$/, '').trim()
  // 清除旧专业模板迁移时残留的短随机尾码，例如“记录DYk”；保留 BIM 等全大写业务缩写。
  name = name.replace(/[A-Z][A-Za-z0-9]{0,5}[a-z][A-Za-z0-9]{0,3}$/, '').trim()
  return DOC_TYPE_NAME_FIXES.get(name) || name || '未命名模板'
}

export function getTemplateRegistryPath(userDataPath) {
  return path.join(getTemplateWorkspaceRoot(userDataPath), REGISTRY_FILE)
}

function readRegistry(userDataPath) {
  const registryPath = getTemplateRegistryPath(userDataPath)
  try {
    if (fs.existsSync(registryPath)) {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      return { version: 1, templates: Array.isArray(data.templates) ? data.templates : [] }
    }
  } catch (e) {
    console.error('[templateRegistry] Failed to read registry:', e.message)
  }
  return { version: 1, templates: [] }
}

function writeRegistry(userDataPath, registry) {
  const registryPath = getTemplateRegistryPath(userDataPath)
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  const temporary = `${registryPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), 'utf8')
  fs.renameSync(temporary, registryPath)
}

export function listTemplateLibrary(userDataPath) {
  return readRegistry(userDataPath).templates.sort((a, b) => {
    const byUpdatedAt = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    return byUpdatedAt || String(b.id || '').localeCompare(String(a.id || ''))
  }).map(item => ({ ...item, missing: !item.path || !fs.existsSync(item.path) }))
}

/**
 * 把用户直接复制到专业/私人/其他模板目录的文件补录进 registry。
 * Windows 用户常通过资源管理器维护模板；刷新模板库时必须能发现这些文件，
 * 不能要求用户理解 template-registry.json。
 */
export async function reconcileTemplateLibraryFiles(userDataPath) {
  const registry = readRegistry(userDataPath)
  const registeredPaths = new Set(registry.templates.map(item => item.path && path.resolve(item.path)).filter(Boolean))
  let added = 0
  for (const scope of ['professional', 'personal', 'other']) {
    const scopeRoot = getTemplateScopeDir(userDataPath, scope)
    if (!fs.existsSync(scopeRoot)) continue
    const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (entry.name.startsWith('.') || entry.name === '清理归档') return []
      const fullPath = path.join(directory, entry.name)
      return entry.isDirectory() ? walk(fullPath) : (/\.(docx|xlsx)$/i.test(entry.name) && !entry.name.startsWith('~$') ? [fullPath] : [])
    })
    for (const filePath of walk(scopeRoot)) {
      if (registeredPaths.has(path.resolve(filePath))) continue
      const relativeParts = path.relative(scopeRoot, filePath).split(path.sep)
      const categoryLabel = relativeParts.length >= 3 ? relativeParts[0] : '通用'
      const folderDocType = relativeParts.length >= 3 ? relativeParts.at(-2) : path.basename(filePath, path.extname(filePath))
      const docType = cleanTemplateDocType(folderDocType)
      const { getTemplatePlaceholders } = await import('./templateService.mjs')
      const fields = await getTemplatePlaceholders(filePath)
      const now = new Date().toISOString()
      registry.templates.push({
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: docType,
        docType,
        scope,
        projectType: scope === 'professional' ? (normalizeProjectType(categoryLabel) || 'unclassified') : categoryLabel,
        projectTypeLabel: categoryLabel,
        path: filePath,
        sourceName: path.basename(filePath),
        fields,
        // 内置文种的规则按文种随应用交付。复制为私人副本后直接继承，
        // 只有新增自定义字段或自定义文种才需要重新配置。
        aiRuleConfiguredAt: BUILTIN_DOC_TYPES.has(docType) && fields.length ? now : undefined,
        createdAt: now,
        updatedAt: now,
      })
      registeredPaths.add(path.resolve(filePath))
      added++
    }
  }
  if (added) writeRegistry(userDataPath, registry)
  return { added }
}

/** 把旧版散落路径、英文 ID 文件名和同文种变体收敛为一份中文正式模板。 */
export function normalizeTemplateLibrary(userDataPath) {
  const registry = readRegistry(userDataPath)
  const root = getTemplateWorkspaceRoot(userDataPath)
  const archiveDir = path.join(root, '清理归档')
  const ordered = [...registry.templates].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const kept = []
  const seen = new Set()
  const renamedDocTypes = {}

  for (const entry of ordered) {
    const originalDocType = String(entry.docType || entry.name || '未命名模板')
    const cleanedDocType = cleanTemplateDocType(originalDocType)
    if (originalDocType !== cleanedDocType) renamedDocTypes[originalDocType] = cleanedDocType
    const projectLabel = entry.scope === 'professional'
      ? (entry.projectTypeLabel || entry.projectType || '未分类')
      : (entry.scope === 'other' || entry.scope === 'personal')
        ? (entry.projectTypeLabel || entry.projectType || '通用')
        : '通用'
    const key = `${entry.scope}:${entry.projectTypeLabel || entry.projectType || '通用'}:${cleanedDocType}`
    const sourcePath = entry.path && fs.existsSync(entry.path) ? entry.path : ''
    if (seen.has(key)) {
      if (sourcePath) {
        fs.mkdirSync(archiveDir, { recursive: true })
        const archived = path.join(archiveDir, `${cleanedDocType}_${entry.id}${path.extname(sourcePath)}`)
        if (!fs.existsSync(archived)) fs.copyFileSync(sourcePath, archived)
      }
      continue
    }
    seen.add(key)
    const extension = path.extname(sourcePath || entry.sourceName || '.docx').toLowerCase() || '.docx'
    const safeDocType = cleanedDocType.replace(/[\\/:*?"<>|]/g, '_')
    const targetDir = path.join(getTemplateScopeDir(userDataPath, entry.scope), projectLabel, safeDocType)
    const targetPath = path.join(targetDir, `${safeDocType}模板${extension}`)
    if (sourcePath && path.resolve(sourcePath) !== path.resolve(targetPath)) {
      fs.mkdirSync(targetDir, { recursive: true })
      if (!fs.existsSync(targetPath)) fs.copyFileSync(sourcePath, targetPath)
    }
    kept.push({
      ...entry,
      name: safeDocType,
      docType: safeDocType,
      path: fs.existsSync(targetPath) ? targetPath : entry.path,
      sourceName: `${safeDocType}模板${extension}`,
      projectTypeLabel: projectLabel,
    })
  }
  registry.templates = kept
  writeRegistry(userDataPath, registry)

  // 旧库复制进统一工作区后，正式目录里可能还残留 tpl_xxx / “模版”变体文件。
  // 只清理用户管理的三类目录；内置模板不在 registry 中，不能参与这一步。
  const referenced = new Set(kept.map(item => path.resolve(item.path)).filter(Boolean))
  let physicalArchived = 0
  const archiveUnregistered = directory => {
    if (!fs.existsSync(directory)) return
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, dirent.name)
      if (dirent.isDirectory()) {
        archiveUnregistered(fullPath)
        try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath) } catch {}
        continue
      }
      if (!/\.(docx|xlsx)$/i.test(dirent.name) || referenced.has(path.resolve(fullPath))) continue
      fs.mkdirSync(archiveDir, { recursive: true })
      const extension = path.extname(dirent.name)
      const stem = path.basename(dirent.name, extension).replace(/[\\/:*?"<>|]/g, '_')
      let archivedPath = path.join(archiveDir, `${stem}${extension}`)
      if (fs.existsSync(archivedPath)) archivedPath = path.join(archiveDir, `${stem}-${Date.now()}-${physicalArchived}${extension}`)
      fs.renameSync(fullPath, archivedPath)
      physicalArchived++
    }
  }
  for (const scope of ['professional', 'personal', 'other']) archiveUnregistered(getTemplateScopeDir(userDataPath, scope))

  return { total: kept.length, archived: ordered.length - kept.length + physicalArchived, root, renamedDocTypes }
}

/** 删除一个专业及其整个物理目录和全部模板登记。 */
export async function deleteProfessionalCategory(userDataPath, projectType, { trashItem } = {}) {
  const label = String(projectType || '').trim()
  if (!label) return { ok: false, error: '专业名称不能为空' }
  const registry = readRegistry(userDataPath)
  const targetCode = normalizeProjectType(label)
  const removed = registry.templates.filter(item => item.scope === 'professional' && (
    item.projectTypeLabel === label || normalizeProjectType(item.projectType) === targetCode
  ))
  const categoryDir = path.join(getTemplateScopeDir(userDataPath, 'professional'), label)
  if (fs.existsSync(categoryDir)) {
    if (typeof trashItem !== 'function') return { ok: false, error: '系统废纸篓不可用' }
    await trashItem(categoryDir)
  }
  registry.templates = registry.templates.filter(item => !removed.some(candidate => candidate.id === item.id))
  writeRegistry(userDataPath, registry)
  return { ok: true, removedTemplates: removed.length, trashed: fs.existsSync(categoryDir) === false }
}

/** 删除用户自定义模板文件夹，同步清理文件夹内的模板登记。 */
export async function deleteTemplateCategory(userDataPath, scope, category, { trashItem } = {}) {
  if (!['personal', 'other'].includes(scope)) return { ok: false, error: '只允许删除用户自定义模板文件夹' }
  const label = String(category || '').trim()
  if (!label || /[\\/:*?"<>|]/.test(label)) return { ok: false, error: '文件夹名称无效' }
  const registry = readRegistry(userDataPath)
  const removed = registry.templates.filter(item => item.scope === scope && (item.projectTypeLabel === label || item.projectType === label))
  const categoryDir = path.join(getTemplateScopeDir(userDataPath, scope), label)
  if (fs.existsSync(categoryDir)) {
    if (typeof trashItem !== 'function') return { ok: false, error: '系统废纸篓不可用' }
    await trashItem(categoryDir)
  }
  registry.templates = registry.templates.filter(item => !removed.some(candidate => candidate.id === item.id))
  writeRegistry(userDataPath, registry)
  return { ok: true, removedTemplates: removed.length, trashed: !fs.existsSync(categoryDir) }
}

/**
 * v1.x：按 projectType + docType 过滤企业库（新增）
 * 供模板中心 UI 用：选专业 + docType 时调用
 */
export function listTemplatesByProjectType(userDataPath, { projectType, docType, scope }) {
  const all = listTemplateLibrary(userDataPath)
  return all.filter(item => {
    if (!fs.existsSync(item.path)) return false
    if (docType && item.docType !== docType) return false
    if (scope && item.scope !== scope) return false
    if (projectType) {
      const itemCode = normalizeProjectType(item.projectType)
      const targetCode = normalizeProjectType(projectType)
      // global 永远命中；professional 必须 code 一致
      if (item.scope !== 'global' && itemCode !== targetCode) return false
    }
    return true
  })
}

/**
 * v1.x：删除企业模板库中的一条模板（清 registry + 删物理文件）
 * 只删除位于 template-library 目录内的文件，避免误删系统/其他文件
 */
export async function deleteTemplateFromLibrary(userDataPath, id, { trashItem } = {}) {
  const registry = readRegistry(userDataPath)
  const idx = registry.templates.findIndex(t => t.id === id)
  if (idx < 0) return { ok: false, error: '模板不存在' }
  const removed = registry.templates[idx]
  const libraryRoot = path.resolve(getTemplateWorkspaceRoot(userDataPath))
  const templatePath = removed.path ? path.resolve(removed.path) : ''
  const relative = templatePath ? path.relative(libraryRoot, templatePath) : '..'
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, error: '只允许删除用户模板库中的文件' }
  }
  if (templatePath && fs.existsSync(templatePath)) {
    if (typeof trashItem !== 'function') return { ok: false, error: '系统废纸篓不可用' }
    try {
      await trashItem(templatePath)
    } catch (e) {
      console.warn('[templateRegistry] trash file failed:', e.message)
      return { ok: false, error: `移到废纸篓失败：${e.message}` }
    }
  }
  registry.templates.splice(idx, 1)
  writeRegistry(userDataPath, registry)
  return { ok: true, trashed: Boolean(templatePath) }
}

/**
 * v1.x：更新企业模板（重命名 + 替换文件内容 + 重扫字段）
 * sourcePath 缺省时仅重命名；提供时覆盖原文件并重新识别占位符
 */
export async function updateTemplateInLibrary(userDataPath, id, { name, sourcePath } = {}) {
  const registry = readRegistry(userDataPath)
  const entry = registry.templates.find(t => t.id === id)
  if (!entry) return { ok: false, error: '模板不存在' }
  if (name != null && String(name).trim()) entry.name = String(name).trim()
  if (sourcePath && fs.existsSync(sourcePath) && path.extname(sourcePath).toLowerCase() === '.docx') {
    fs.copyFileSync(sourcePath, entry.path)
    const { getTemplatePlaceholders } = await import('./templateService.mjs')
    entry.fields = await getTemplatePlaceholders(entry.path)
    const layoutContract = await extractTemplateLayoutContract(entry.path, { docType: entry.docType, write: true })
    entry.layoutContract = { path: getTemplateLayoutContractPath(entry.path), templateHash: layoutContract.templateHash, schemaVersion: layoutContract.schemaVersion, status: 'ready', warningCount: layoutContract.warnings.length }
    entry.sourceName = path.basename(sourcePath)
    // 文件内容已替换，旧模板上的规则确认不能沿用；保留曾配置记录，供界面明确显示“需更新”。
    if (entry.aiRuleConfiguredAt) entry.aiRuleNeedsUpdate = true
  }
  entry.updatedAt = new Date().toISOString()
  writeRegistry(userDataPath, registry)
  return { ok: true, template: entry }
}

/** 标记某一份用户模板已经在 AI 扩写编辑中心完成规则保存。 */
export function markTemplateRuleConfigured(userDataPath, id) {
  const registry = readRegistry(userDataPath)
  const entry = registry.templates.find(item => item.id === id)
  if (!entry) return { ok: false, error: '模板不存在' }
  entry.aiRuleConfiguredAt = new Date().toISOString()
  delete entry.aiRuleNeedsUpdate
  entry.updatedAt = entry.aiRuleConfiguredAt
  writeRegistry(userDataPath, registry)
  return { ok: true, template: entry }
}

/**
 * v1.x：注入自定义文种到运行时缓存
 * 主进程 settings 变更后会调
 */
export function setCustomDocTypes(list) {
  customDocTypesCache = Array.isArray(list)
    ? list.filter(item => item && item.label).map(item => item.label)
    : []
}

/** v1.x：运行时全量文种（含 customDocTypes） */
export function getSupportedDocTypes() {
  return [...SUPPORTED_DOC_TYPES, ...customDocTypesCache]
}

// v1.x：自定义文种运行时缓存
let customDocTypesCache = []

export async function importTemplateToLibrary({ userDataPath, sourcePath, docType, scope = 'professional', projectType = '通用', name }) {
    // v1.x：用运行时全量文种（含 customDocTypes）做校验
  const supported = getSupportedDocTypes()
  if (!supported.includes(docType)) throw new Error(`不支持的文种：${docType}`)
  if (!fs.existsSync(sourcePath) || !/\.(docx|xlsx)$/i.test(sourcePath)) throw new Error('请选择有效的 Word 或 Excel 模板文件')
  if (!['global', 'professional', 'other', 'personal'].includes(scope)) throw new Error('模板范围无效')

  const registry = readRegistry(userDataPath)
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const extension = path.extname(sourcePath).toLowerCase()
  const safeDocType = cleanTemplateDocType(docType).replace(/[\\/:*?"<>|]/g, '_')
  const categoryLabel = scope === 'professional' ? (projectType || '未分类') : scope === 'other' || scope === 'personal' ? (projectType || '通用') : '通用'
  const targetDir = path.join(getTemplateScopeDir(userDataPath, scope), categoryLabel, safeDocType)
  fs.mkdirSync(targetDir, { recursive: true })
  // 同一分类、同一文种只保留一个正式模板，不再产生“变体 1/2”式名称。
  const targetPath = path.join(targetDir, `${safeDocType}模板${extension}`)
  const existing = registry.templates.filter(item => item.scope === scope && item.docType === docType && normalizeProjectType(item.projectType) === normalizeProjectType(projectType))
  for (const duplicate of existing) {
    if (duplicate.path && duplicate.path !== targetPath && fs.existsSync(duplicate.path)) {
      const archiveDir = path.join(getTemplateWorkspaceRoot(userDataPath), '清理归档', new Date().toISOString().slice(0, 10))
      fs.mkdirSync(archiveDir, { recursive: true })
      const archivedName = `${safeDocType}_${duplicate.id}${path.extname(duplicate.path)}`
      fs.renameSync(duplicate.path, path.join(archiveDir, archivedName))
    }
  }
  registry.templates = registry.templates.filter(item => !existing.some(duplicate => duplicate.id === item.id))
  fs.copyFileSync(sourcePath, targetPath)
  // XLSX 的单元格占位符映射保存在同目录 config.json；导入时必须一起带入，
  // 否则文件虽然复制成功，后续扫描和生成却无法知道字段对应哪个单元格。
  if (extension === '.xlsx') {
    const sourceConfig = path.join(path.dirname(sourcePath), 'config.json')
    if (fs.existsSync(sourceConfig)) fs.copyFileSync(sourceConfig, path.join(targetDir, 'config.json'))
  }
  // 在导入时即扫描占位符：用户无需研究模板语法，也能判断模板是否可直接生成。
  const { getTemplatePlaceholders } = await import('./templateService.mjs')
  const fields = await getTemplatePlaceholders(targetPath)
  const layoutContract = extension === '.docx'
    ? await extractTemplateLayoutContract(targetPath, { docType, write: true })
    : null
  const entry = {
    id,
    name: safeDocType,
    docType,
    scope,
    // v1.x：projectType 存 code 便于 normalizeProjectType 反查；
    // 老数据是 label，写入时统一转 code；保留 label 给 UI 显示
    projectType: scope === 'global'
      ? 'global'  // sentinel：global 永远命中
      : scope === 'professional' ? (normalizeProjectType(projectType) || 'unclassified') : categoryLabel,
    projectTypeLabel: categoryLabel,  // UI 显示用
    path: targetPath,
    sourceName: `${safeDocType}模板${extension}`,
    fields,
    layoutContract: layoutContract ? {
      path: getTemplateLayoutContractPath(targetPath),
      templateHash: layoutContract.templateHash,
      schemaVersion: layoutContract.schemaVersion,
      status: 'ready',
      warningCount: layoutContract.warnings.length,
    } : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (BUILTIN_DOC_TYPES.has(docType) && fields.length) entry.aiRuleConfiguredAt = entry.updatedAt
  registry.templates.push(entry)
  writeRegistry(userDataPath, registry)
  return entry
}

/** 编辑后的企业模板可重新扫描字段，不必再次导入或新建副本。 */
export async function refreshTemplateLibraryEntry({ userDataPath, templateId }) {
  const registry = readRegistry(userDataPath)
  const entry = registry.templates.find(item => item.id === templateId)
  if (!entry) throw new Error('未找到企业模板')
  if (!fs.existsSync(entry.path)) throw new Error('企业模板文件不存在')
  const { getTemplatePlaceholders } = await import('./templateService.mjs')
  const previousFields = Array.isArray(entry.fields) ? [...entry.fields].sort() : []
  entry.fields = await getTemplatePlaceholders(entry.path)
  if (path.extname(entry.path).toLowerCase() === '.docx') {
    const layoutContract = await extractTemplateLayoutContract(entry.path, { docType: entry.docType, write: true })
    entry.layoutContract = { path: getTemplateLayoutContractPath(entry.path), templateHash: layoutContract.templateHash, schemaVersion: layoutContract.schemaVersion, status: 'ready', warningCount: layoutContract.warnings.length }
  }
  const currentFields = [...entry.fields].sort()
  if (entry.aiRuleConfiguredAt && JSON.stringify(previousFields) !== JSON.stringify(currentFields)) entry.aiRuleNeedsUpdate = true
  entry.updatedAt = new Date().toISOString()
  writeRegistry(userDataPath, registry)
  return entry
}

export function resolveLibraryTemplate(userDataPath, { docType, projectType, selectedTemplateId }) {
  const templates = listTemplateLibrary(userDataPath).filter(item => item.docType === docType && fs.existsSync(item.path))
  if (selectedTemplateId) {
    const selected = templates.find(item => item.id === selectedTemplateId)
    if (selected && !isTemplateReady(selected)) throw new Error(`模板“${selected.name || selected.docType}”尚未完成占位符识别和 AI 扩写规则配置`)
    if (selected) return selected
  }
  // 未完成配置的用户模板可以继续在模板中心编辑，但不能自动参与正式文档生成。
  const readyTemplates = templates.filter(isTemplateReady)
  // v1.x：projectType 兼容 label 和 code（normalizeProjectType 都处理）
  const targetCode = normalizeProjectType(projectType)
  // 优先级：personal（个人私有库，用户自己配）> professional（专业库）> global（通用库）
  return readyTemplates.find(item => item.scope === 'personal')
    || readyTemplates.find(item =>
      item.scope === 'professional' &&
      (item.projectType === targetCode || normalizeProjectType(item.projectType) === targetCode)
    ) || readyTemplates.find(item => item.scope === 'global') || null
}

/**
 * v1.3.2：模板做减法 — 将 templates/专业/ 下的预置专业模板批量迁移到企业模板库。
 *
 * 触发条件：templates/专业/ 目录存在（旧版本升级或首次安装带该目录）。
 * 迁移逻辑：
 *   1. 递归遍历 templates/专业/<专业名>/.../*.docx
 *   2. docType 从文件名推断（去后缀/去"模版"/去"「」"），匹配内置则用内置，否则建自定义文种
 *   3. scope=professional, projectType=专业名（一级目录名）
 *   4. 导入完删除 templates/专业/ 整个目录，写迁移标记防重复
 *
 * 幂等：迁移标记文件 .professional-migrated 存在则跳过。
 */
export async function migrateBuiltinProfessionalTemplates({ userDataPath, templatesDir, getSettings, saveSettings }) {
  const markerPath = path.join(userDataPath, '.professional-migrated')
  if (fs.existsSync(markerPath)) return { skipped: true, reason: 'already-migrated' }

  const specialtyDir = path.join(templatesDir, '专业')
  if (!fs.existsSync(specialtyDir)) {
    // 无源目录也写标记，避免每次启动都检查
    try { fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8') } catch {}
    return { skipped: true, reason: 'no-specialty-dir' }
  }

  const results = { imported: 0, customTypesCreated: 0, errors: [] }
  const settings = getSettings()
  let customDocTypes = Array.isArray(settings.customDocTypes) ? [...settings.customDocTypes] : []
  const customLabels = new Set(customDocTypes.map(item => item.label))

  // 递归找所有 docx
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (entry.name.toLowerCase().endsWith('.docx')) out.push(full)
    }
    return out
  }

  // 推断 docType：取文件名，去 .docx / _模版 / 模版 / 「」 / 工程前缀
  const inferDocType = (fileName) => {
    let n = fileName.replace(/\.docx$/i, '')
    n = n.replace(/_模版$/, '').replace(/模版$/, '')
    n = n.replace(/[「」]/g, '')
    // 去 "通信工程_" / "电力工程_" 等专业前缀
    n = n.replace(/^(电力|通信|信息化|房建|钢结构|市政|土建|园林|装饰)工程[_]/, '')
    // 去版本号前缀如 "E-ZDW-01-"
    n = n.replace(/^[A-Z]+-[A-Z]+-\d+-/, '')
    return n.trim()
  }

  for (const professionName of fs.readdirSync(specialtyDir, { withFileTypes: true })) {
    if (!professionName.isDirectory()) continue
    if (professionName.name.startsWith('.')) continue
    const profDir = path.join(specialtyDir, professionName.name)
    const docxFiles = walk(profDir)
    for (const docxPath of docxFiles) {
      try {
        const fileName = path.basename(docxPath)
        let docType = inferDocType(fileName)
        // 匹配内置则用内置，否则建自定义文种
        if (!SUPPORTED_DOC_TYPES.includes(docType) && !customLabels.has(docType)) {
          const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
          customDocTypes.push({
            code: `prof_${stamp}`,
            label: docType,
            fileCode: `ZY${stamp.slice(-6).toUpperCase()}`,
            projectType: professionName.name,
            minWords: 400,
            inStructuredWhitelist: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          customLabels.add(docType)
          results.customTypesCreated++
          // 立即刷运行时缓存，让 importTemplateToLibrary 的 getSupportedDocTypes 认得新文种
          setCustomDocTypes(customDocTypes)
        }
        // 导入到企业库（scope=professional）
        await importTemplateToLibrary({
          userDataPath,
          sourcePath: docxPath,
          docType,
          scope: 'professional',
          projectType: professionName.name,
          name: docType,
        })
        results.imported++
      } catch (e) {
        results.errors.push({ file: docxPath, error: e.message })
        console.warn('[templateRegistry] migrate failed:', docxPath, e.message)
      }
    }
  }

  // 保存自定义文种到 settings
  if (results.customTypesCreated > 0) {
    saveSettings({ ...settings, customDocTypes })
  }

  // 删除源目录 + 写迁移标记
  try {
    fs.rmSync(specialtyDir, { recursive: true, force: true })
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8')
  } catch (e) {
    console.warn('[templateRegistry] cleanup specialty dir failed:', e.message)
  }

  console.log(`[templateRegistry] Migrated ${results.imported} professional templates, created ${results.customTypesCreated} custom docTypes, ${results.errors.length} errors`)
  return results
}

export { SUPPORTED_DOC_TYPES }

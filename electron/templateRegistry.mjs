import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeProjectType } from '../src/shared/projectProfile.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REGISTRY_FILE = 'template-registry.json'

// 内置文种全量清单 — 唯一真相源 src/shared/builtin-doc-types.json
// （渲染层 builtinDocTypes.ts 与主进程都读这份，避免四处手抄漂移）
const SUPPORTED_DOC_TYPES = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'src', 'shared', 'builtin-doc-types.json'), 'utf8'),
)

export function getTemplateRegistryPath(userDataPath) {
  return path.join(userDataPath, 'template-library', REGISTRY_FILE)
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
  })
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
  const libraryRoot = path.resolve(userDataPath, 'template-library')
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
    entry.sourceName = path.basename(sourcePath)
  }
  entry.updatedAt = new Date().toISOString()
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
  if (!fs.existsSync(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.docx') throw new Error('请选择有效的 Word 模板文件')
  if (!['global', 'professional', 'other', 'personal'].includes(scope)) throw new Error('模板范围无效')

  const registry = readRegistry(userDataPath)
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const safeName = path.basename(sourcePath).replace(/[^\w\u4e00-\u9fff.-]/g, '_')
  const targetDir = path.join(userDataPath, 'template-library', scope, projectType || '通用', docType)
  fs.mkdirSync(targetDir, { recursive: true })
  const targetPath = path.join(targetDir, `${id}_${safeName}`)
  fs.copyFileSync(sourcePath, targetPath)
  // 在导入时即扫描占位符：用户无需研究模板语法，也能判断模板是否可直接生成。
  const { getTemplatePlaceholders } = await import('./templateService.mjs')
  const fields = await getTemplatePlaceholders(targetPath)
  const entry = {
    id,
    name: name?.trim() || path.basename(sourcePath, '.docx'),
    docType,
    scope,
    // v1.x：projectType 存 code 便于 normalizeProjectType 反查；
    // 老数据是 label，写入时统一转 code；保留 label 给 UI 显示
    projectType: scope === 'global' || scope === 'other'
      ? 'global'  // sentinel：global 永远命中
      : (normalizeProjectType(projectType) || 'unclassified'),
    projectTypeLabel: projectType,  // UI 显示用
    path: targetPath,
    sourceName: path.basename(sourcePath),
    fields,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
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
  entry.fields = await getTemplatePlaceholders(entry.path)
  entry.updatedAt = new Date().toISOString()
  writeRegistry(userDataPath, registry)
  return entry
}

export function resolveLibraryTemplate(userDataPath, { docType, projectType, selectedTemplateId }) {
  const templates = listTemplateLibrary(userDataPath).filter(item => item.docType === docType && fs.existsSync(item.path))
  if (selectedTemplateId) {
    const selected = templates.find(item => item.id === selectedTemplateId)
    if (selected) return selected
  }
  // v1.x：projectType 兼容 label 和 code（normalizeProjectType 都处理）
  const targetCode = normalizeProjectType(projectType)
  // 优先级：personal（个人私有库，用户自己配）> professional（专业库）> global（通用库）
  return templates.find(item => item.scope === 'personal')
    || templates.find(item =>
      item.scope === 'professional' &&
      (item.projectType === targetCode || normalizeProjectType(item.projectType) === targetCode)
    ) || templates.find(item => item.scope === 'global') || null
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

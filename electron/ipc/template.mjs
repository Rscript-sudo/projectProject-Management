// v1.x：模板相关 IPC 入口
// fs:listTemplateLibrary / fs:importTemplateToLibrary 等已在 project.mjs 注册
// 这里只放新增的按专业+文种批量查询
import fs from 'fs'
import path from 'path'
import { safeCall } from './safe.mjs'
import { app, shell } from 'electron'
import { listTemplatesByProjectType, deleteTemplateFromLibrary, deleteProfessionalCategory, deleteTemplateCategory, updateTemplateInLibrary, listTemplateLibrary, getTemplateRegistryPath, refreshTemplateLibraryEntry, markTemplateRuleConfigured } from '../templateRegistry.mjs'
import { getTemplatePlaceholders, saveDocxTemplatePlaceholders, saveXlsxTemplatePlaceholders } from '../templateService.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'
import { ensureProfessionalCategory, ensureTemplateCategory, getRuntimeSystemTemplatesDir, getTemplateScopeDir, getTemplateWorkspaceInfo, listTemplateCategories } from '../templateWorkspace.mjs'
import { removeProfessionalCategoryFromSettings } from '../professionalCategory.mjs'
import { getSettings, saveSettings } from './shared.mjs'
import { setCustomProjectTypes } from '../../src/shared/projectProfile.mjs'
import { loadOrCreateTemplateLayoutContract, resetTemplateLayoutContract, saveTemplateLayoutContract } from '../templateLayoutContract.mjs'

function isRuntimeSystemTemplate(filePath) {
  const root = getRuntimeSystemTemplatesDir()
  if (!root || !filePath) return false
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function register(ipcMain) {
  ipcMain.handle('template:listByProjectType', safeCall((_, params = {}) => {
    const userDataPath = app.getPath('userData')
    return listTemplatesByProjectType(userDataPath, {
      projectType: params.projectType,
      docType: params.docType,
      scope: params.scope,
    })
  }))

  // v1.x：扫描一个模板文件的占位符字段（{{字段}}），供"关联模板 → 字段分析"用
  ipcMain.handle('template:getFields', safeCall(async (_, { path: filePath }) => {
    if (!filePath || typeof filePath !== 'string' || !/\.(docx|xlsx)$/i.test(filePath)) {
      return { ok: false, error: '请选择有效的 Word 或 Excel 模板文件' }
    }
    if (!isPathSafe(filePath)) {
      return { ok: false, error: '路径不安全' }
    }
    if (!fs.existsSync(filePath)) return { ok: false, error: '模板文件不存在' }
    const fields = await getTemplatePlaceholders(filePath)
    return { ok: true, fields }
  }))

  // v1.x：删除企业模板（清 registry + 删物理文件）
  ipcMain.handle('template:deleteLibrary', safeCall(async (_, { id }) => {
    const userDataPath = app.getPath('userData')
    return deleteTemplateFromLibrary(userDataPath, id, { trashItem: filePath => shell.trashItem(filePath) })
  }))

  ipcMain.handle('template:deleteProfessional', safeCall(async (_, { projectType, projectTypeCode }) => {
    const deleted = await deleteProfessionalCategory(app.getPath('userData'), projectType, { trashItem: target => shell.trashItem(target) })
    if (!deleted?.ok) return deleted

    // 删除必须是一条完整链路：不能只删目录/registry，却把专业名称留在设置里。
    const nextSettings = removeProfessionalCategoryFromSettings(getSettings(), { projectType, projectTypeCode })
    const saved = saveSettings(nextSettings)
    if (!saved?.success) {
      return { ok: false, error: saved?.error || '专业配置更新失败' }
    }
    setCustomProjectTypes(nextSettings.customProjectTypes || [])
    return {
      ...deleted,
      customProjectTypes: nextSettings.customProjectTypes || [],
      hiddenProfessionalTemplateTypes: nextSettings.hiddenProfessionalTemplateTypes || [],
    }
  }))

  ipcMain.handle('template:workspaceInfo', safeCall(() => getTemplateWorkspaceInfo(app.getPath('userData'))))
  ipcMain.handle('template:createProfessional', safeCall((_, { projectType }) => ensureProfessionalCategory(app.getPath('userData'), projectType)))
  // 显式返回命名字段，避免 safeCall 对数组统一包成 { success, data }
  // 后渲染层误把响应对象当数组调用 map。
  ipcMain.handle('template:listCategories', safeCall((_, { scope = 'other' } = {}) => ({
    success: true,
    categories: listTemplateCategories(app.getPath('userData'), scope),
  })))
  ipcMain.handle('template:createCategory', safeCall((_, { scope = 'other', name }) => ensureTemplateCategory(app.getPath('userData'), scope, name)))
  ipcMain.handle('template:deleteCategory', safeCall(async (_, { scope = 'other', name }) => deleteTemplateCategory(app.getPath('userData'), scope, name, { trashItem: target => shell.trashItem(target) })))

  // v1.x：更新企业模板（重命名 / 替换文件 / 重扫字段）
  ipcMain.handle('template:updateLibrary', safeCall(async (_, { id, name, sourcePath }) => {
    const userDataPath = app.getPath('userData')
    return updateTemplateInLibrary(userDataPath, id, { name, sourcePath })
  }))

  ipcMain.handle('template:markRuleConfigured', safeCall(async (_, { id }) => {
    return markTemplateRuleConfigured(app.getPath('userData'), id)
  }))

  ipcMain.handle('template:getLayoutContract', safeCall(async (_, { path: filePath, docType = '' }) => {
    if (!filePath || !fs.existsSync(filePath) || !/\.(?:docx|xlsx)$/i.test(filePath)) return { ok: false, error: '请选择有效的 DOCX 或 XLSX 模板' }
    if (!isPathSafe(filePath) && !isRuntimeSystemTemplate(filePath)) return { ok: false, error: '模板路径不安全' }
    const result = await loadOrCreateTemplateLayoutContract(filePath, { docType, write: true })
    return { ok: true, ...result }
  }))

  ipcMain.handle('template:saveLayoutContract', safeCall(async (_, { path: filePath, docType = '', fields = {} }) => {
    if (!filePath || !fs.existsSync(filePath) || !/\.(?:docx|xlsx)$/i.test(filePath)) return { ok: false, error: '请选择有效的 DOCX 或 XLSX 模板' }
    if (!isPathSafe(filePath)) return { ok: false, error: '模板路径不安全' }
    const contract = await saveTemplateLayoutContract(filePath, { docType, fields })
    return { ok: true, contract }
  }))

  ipcMain.handle('template:resetLayoutContract', safeCall(async (_, { path: filePath, docType = '' }) => {
    if (!filePath || !fs.existsSync(filePath) || !/\.(?:docx|xlsx)$/i.test(filePath)) return { ok: false, error: '请选择有效的 DOCX 或 XLSX 模板' }
    if (!isPathSafe(filePath)) return { ok: false, error: '模板路径不安全' }
    const contract = await resetTemplateLayoutContract(filePath, { docType })
    return { ok: true, contract }
  }))

  // v1.3.4（2026-08-27）：把占位符变更写回原模板文件（docx / xlsx）。
  // 内置模板的运行时工作副本位于用户文档目录，可原位写回；只有明确另存为
  // 私人模板时才复制。返回的 path 始终是实际写入路径。
  ipcMain.handle('template:saveContent', safeCall(async (_, payload = {}) => {
    const { path: filePath, addFields, removeFields, renameMap, placements, docType, templateId, saveAsPersonal, name } = payload
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: '缺少模板路径' }
    if (!fs.existsSync(filePath)) return { ok: false, error: '模板文件不存在' }
    if (!isPathSafe(filePath) && !isRuntimeSystemTemplate(filePath)) return { ok: false, error: '模板路径不安全' }

    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.docx' && ext !== '.xlsx') {
      return { ok: false, error: '仅支持 .docx / .xlsx 模板' }
    }

    let targetPath = filePath
    let configPath = null
    let clonedToLibrary = null

    // 运行时内置模板位于用户文档目录，允许直接编辑。只有用户明确“另存为私人模板”
    // 时才复制；安装包内的只读种子从不作为本接口的写入目标。
    if (saveAsPersonal) {
      const userDataPath = app.getPath('userData')
      const safeDocType = String(docType || '通用模板').replace(/[\\/:*?"<>|]/g, '_')
      const targetDir = path.join(getTemplateScopeDir(userDataPath, 'personal'), '通用', safeDocType)
      fs.mkdirSync(targetDir, { recursive: true })
      const stamp = Date.now().toString(36)
      const baseName = path.basename(filePath).replace(/[^\w\u4e00-\u9fff.-]/g, '_')
      const newName = `${safeDocType}模板${path.extname(baseName).toLowerCase()}`
      targetPath = path.join(targetDir, newName)
      fs.copyFileSync(filePath, targetPath)
      // 若原目录有 config.json（xlsx 模板），一并复制
      const srcConfig = path.join(path.dirname(filePath), 'config.json')
      if (fs.existsSync(srcConfig)) {
        configPath = path.join(targetDir, 'config.json')
        fs.copyFileSync(srcConfig, configPath)
      }
      // 登记到企业库 registry
      const fields0 = await getTemplatePlaceholders(targetPath)
      const entry = {
        id: `tpl_${stamp}`,
        name: String(name || `${docType || '模板'}私人模板`).trim(),
        docType: docType || '',
        scope: 'personal',
        projectType: 'global',
        projectTypeLabel: '通用',
        path: targetPath,
        sourceName: path.basename(filePath),
        resourceKind: 'document',
        fields: fields0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const regPath = getTemplateRegistryPath(userDataPath)
      let reg = { version: 1, templates: [] }
      if (fs.existsSync(regPath)) {
        try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) } catch {}
      }
      reg.templates = reg.templates || []
      reg.templates.push(entry)
      const tmp = `${regPath}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8')
      fs.renameSync(tmp, regPath)
      clonedToLibrary = entry
    } else if (ext === '.xlsx') {
      // 企业库 xlsx 模板：config.json 在同目录
      const candidate = path.join(path.dirname(filePath), 'config.json')
      if (fs.existsSync(candidate)) configPath = candidate
    }

    // 写回
    let fields
    if (ext === '.docx') {
      fields = await saveDocxTemplatePlaceholders(targetPath, { addFields: addFields || [], removeFields: removeFields || [], renameMap: renameMap || {}, placements: placements || [] })
    } else {
      fields = await saveXlsxTemplatePlaceholders(targetPath, configPath, { addFields: addFields || [], removeFields: removeFields || [], renameMap: renameMap || {} })
    }

    // 物理文件与 registry 保持同一份字段真相，模板资源树刷新后立即可见。
    // system:xxx 是内置工作副本标识，不存在于企业模板 registry；原位编辑时
    // 已完成物理文件扫描，不能再拿系统 id 去刷新企业登记。
    const registryId = clonedToLibrary?.id || (templateId && !String(templateId).startsWith('system:') ? templateId : null)
    if (registryId) {
      const refreshed = await refreshTemplateLibraryEntry({ userDataPath: app.getPath('userData'), templateId: registryId })
      fields = refreshed.fields
      if (clonedToLibrary) clonedToLibrary = refreshed
    }

    // 模板字段编辑会改变 document.xml 和模板指纹；写回完成后立即重建版式合同，
    // 避免用户第一次生成时才发现合同过期或编辑器仍展示旧字段。
    await resetTemplateLayoutContract(targetPath, { docType: docType || clonedToLibrary?.docType || '' })

    return { ok: true, path: targetPath, fields, clonedToLibrary }
  }))
}

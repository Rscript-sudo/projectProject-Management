// v1.x：模板相关 IPC 入口
// fs:listTemplateLibrary / fs:importTemplateToLibrary 等已在 project.mjs 注册
// 这里只放新增的按专业+文种批量查询
import fs from 'fs'
import path from 'path'
import { safeCall } from './safe.mjs'
import { app, shell } from 'electron'
import { listTemplatesByProjectType, deleteTemplateFromLibrary, updateTemplateInLibrary, listTemplateLibrary, getTemplateRegistryPath, refreshTemplateLibraryEntry } from '../templateRegistry.mjs'
import { getTemplatePlaceholders, saveDocxTemplatePlaceholders, saveXlsxTemplatePlaceholders } from '../templateService.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'

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

  // v1.x：更新企业模板（重命名 / 替换文件 / 重扫字段）
  ipcMain.handle('template:updateLibrary', safeCall(async (_, { id, name, sourcePath }) => {
    const userDataPath = app.getPath('userData')
    return updateTemplateInLibrary(userDataPath, id, { name, sourcePath })
  }))

  // v1.3.4（2026-08-27）：把占位符变更写回原模板文件（docx / xlsx）
  // 系统预置模板（路径在应用包内，isPathSafe 不通过）会先复制到 userData 企业库再写回
  // 返回 { ok, path, fields, clonedToLibrary? } —— path 是实际写入的路径（可能是新克隆的）
  ipcMain.handle('template:saveContent', safeCall(async (_, payload = {}) => {
    const { path: filePath, addFields, removeFields, renameMap, placements, docType, templateId, saveAsPersonal, name } = payload
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: '缺少模板路径' }
    if (!fs.existsSync(filePath)) return { ok: false, error: '模板文件不存在' }

    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.docx' && ext !== '.xlsx') {
      return { ok: false, error: '仅支持 .docx / .xlsx 模板' }
    }

    let targetPath = filePath
    let configPath = null
    let clonedToLibrary = null

    // 系统模板或用户明确“另存为私人模板”时，始终复制到 personal，绝不改系统原件。
    if (saveAsPersonal || !isPathSafe(filePath)) {
      const userDataPath = app.getPath('userData')
      const targetDir = path.join(userDataPath, 'template-library', 'personal', '通用', docType || '通用模板')
      fs.mkdirSync(targetDir, { recursive: true })
      const stamp = Date.now().toString(36)
      const baseName = path.basename(filePath).replace(/[^\w\u4e00-\u9fff.-]/g, '_')
      const newName = `tpl_${stamp}_${baseName}`
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
    const registryId = clonedToLibrary?.id || templateId
    if (registryId) {
      const refreshed = await refreshTemplateLibraryEntry({ userDataPath: app.getPath('userData'), templateId: registryId })
      fields = refreshed.fields
      if (clonedToLibrary) clonedToLibrary = refreshed
    }

    return { ok: true, path: targetPath, fields, clonedToLibrary }
  }))
}

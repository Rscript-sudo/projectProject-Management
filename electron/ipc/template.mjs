// v1.x：模板相关 IPC 入口
// fs:listTemplateLibrary / fs:importTemplateToLibrary 等已在 project.mjs 注册
// 这里只放新增的按专业+文种批量查询
import { safeCall } from './safe.mjs'
import { app } from 'electron'
import { listTemplatesByProjectType, getSupportedDocTypes, deleteTemplateFromLibrary, updateTemplateInLibrary } from '../templateRegistry.mjs'
import { getTemplatePlaceholders } from '../templateService.mjs'

export function register(ipcMain) {
  ipcMain.handle('template:listByProjectType', safeCall((_, params = {}) => {
    const userDataPath = app.getPath('userData')
    return listTemplatesByProjectType(userDataPath, {
      projectType: params.projectType,
      docType: params.docType,
      scope: params.scope,
    })
  }))

  // v1.x：返回运行时全量文种（含 customDocTypes）
  ipcMain.handle('template:listSupportedDocTypes', () => getSupportedDocTypes())

  // v1.x：扫描一个模板文件的占位符字段（{{字段}}），供"关联模板 → 字段分析"用
  ipcMain.handle('template:getFields', safeCall(async (_, { path: filePath }) => {
    if (!filePath || typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.docx')) {
      return { ok: false, error: '请选择有效的 Word 模板文件' }
    }
    const fs = await import('fs')
    if (!fs.existsSync(filePath)) return { ok: false, error: '模板文件不存在' }
    const fields = await getTemplatePlaceholders(filePath)
    return { ok: true, fields }
  }))

  // v1.x：删除企业模板（清 registry + 删物理文件）
  ipcMain.handle('template:deleteLibrary', safeCall((_, { id }) => {
    const userDataPath = app.getPath('userData')
    return deleteTemplateFromLibrary(userDataPath, id)
  }))

  // v1.x：更新企业模板（重命名 / 替换文件 / 重扫字段）
  ipcMain.handle('template:updateLibrary', safeCall(async (_, { id, name, sourcePath }) => {
    const userDataPath = app.getPath('userData')
    return updateTemplateInLibrary(userDataPath, id, { name, sourcePath })
  }))
}
import { safeCall } from './safe.mjs'
import { getSettings, saveSettings, getSettingsForFrontend } from './shared.mjs'
import { diagnoseStorage } from './secret.mjs'
import { setCustomProjectTypes } from '../../src/shared/projectProfile.mjs'
import { setCustomDocTypes } from '../templateRegistry.mjs'
import { setCustomDocTypeCodes } from './filename.mjs'
import { setCustomDocTypePrefixes } from './numbering.mjs'
import { setCustomStructuredDocTypes } from '../templateService.mjs'

/**
 * v1.x：settings 变更后调，注入运行时缓存 + 推送给所有渲染进程
 * 调用点：main.mjs 启动后、saveSettings 完成后
 */
export function applyCustomTypesToRuntime(mainWindow) {
  const settings = getSettings()
  const customProjectTypes = Array.isArray(settings.customProjectTypes) ? settings.customProjectTypes : []
  const customDocTypes = Array.isArray(settings.customDocTypes) ? settings.customDocTypes : []
  const docTypePromptOverrides = settings.docTypePromptOverrides || null
  const globalRulesOverrides = settings.globalRulesOverrides || null
  // 注入主进程各模块的运行时缓存
  setCustomProjectTypes(customProjectTypes)
  setCustomDocTypes(customDocTypes)
  setCustomDocTypeCodes(customDocTypes)        // filename.mjs
  setCustomDocTypePrefixes(customDocTypes)    // numbering.mjs
  setCustomStructuredDocTypes(customDocTypes) // templateService.mjs
  // 推送给所有渲染进程窗口（含扩写规则覆盖，供 aiService 注入）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:customTypesChanged', {
      customProjectTypes,
      customDocTypes,
      docTypePromptOverrides,
      globalRulesOverrides,
    })
  }
}

export function register(ipcMain) {
  // 给前端用：不返回明文 apiKey，只返回 hasApiKey 标志
  ipcMain.handle('settings:get', () => getSettingsForFrontend())
  ipcMain.handle('settings:set', safeCall((_, settings) => {
    const result = saveSettings(settings)
    // v1.x：settings 持久化成功后，注入运行时缓存（保证主进程内 normalizeProjectType 立刻生效）
    if (result.success) {
      const projectTypes = settings.customProjectTypes || []
      const docTypes = settings.customDocTypes || []
      setCustomProjectTypes(projectTypes)
      setCustomDocTypes(docTypes)
      setCustomDocTypeCodes(docTypes)
      setCustomDocTypePrefixes(docTypes)
      setCustomStructuredDocTypes(docTypes)
    }
    return result
  }))
  // 主进程内部用：返回完整 settings（含明文 apiKey），仅供 ai:stream/ai:call 等 handler 调
  ipcMain.handle('settings:getFull', () => getSettings())
  // 诊断：报告当前本机配置存储模式（不访问系统钥匙串）
  ipcMain.handle('settings:diagnose', () => diagnoseStorage())
  // v1.x：返回当前自定义专业列表（不含内置）
  ipcMain.handle('settings:listCustomProjectTypes', () => {
    const settings = getSettings()
    return Array.isArray(settings.customProjectTypes) ? settings.customProjectTypes : []
  })
  // v1.x：返回当前自定义文种列表（不含内置）
  ipcMain.handle('settings:listCustomDocTypes', () => {
    const settings = getSettings()
    return Array.isArray(settings.customDocTypes) ? settings.customDocTypes : []
  })
  // v1.x：返回扩写规则覆盖（内置 prompt 的 user 编辑 + 全局规则的开关/改写）
  ipcMain.handle('settings:listDocTypePromptOverrides', () => {
    const settings = getSettings()
    return {
      docTypes: settings.docTypePromptOverrides || null,
      globalRules: settings.globalRulesOverrides || null,
    }
  })
}

import { safeCall } from './safe.mjs'
import { getSettings, saveSettings, getSettingsForFrontend } from './shared.mjs'

export function register(ipcMain) {
  // 给前端用：不返回明文 apiKey，只返回 hasApiKey 标志
  ipcMain.handle('settings:get', () => getSettingsForFrontend())
  ipcMain.handle('settings:set', safeCall((_, settings) => saveSettings(settings)))
  // 主进程内部用：返回完整 settings（含明文 apiKey），仅供 ai:stream/ai:call 等 handler 调
  ipcMain.handle('settings:getFull', () => getSettings())
}

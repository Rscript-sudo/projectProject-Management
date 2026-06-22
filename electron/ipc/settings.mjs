import { safeCall } from './safe.mjs'
import { getSettings, saveSettings } from './shared.mjs'

export function register(ipcMain) {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', safeCall((_, settings) => saveSettings(settings)))
}

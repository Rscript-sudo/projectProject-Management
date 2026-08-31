import { safeCall } from './safe.mjs'
import { resolveAutomaticTemplateFields } from '../fieldResolvers.mjs'

export function register(ipcMain) {
  ipcMain.handle('field:resolveTemplateContext', safeCall(async (_, payload = {}) => {
    return resolveAutomaticTemplateFields(payload)
  }))
}

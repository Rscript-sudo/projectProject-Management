import { register as registerProject } from './project.mjs'
import { register as registerFile } from './file.mjs'
import { register as registerDoc } from './doc.mjs'
import { register as registerSettings, applyCustomTypesToRuntime } from './settings.mjs'
import { register as registerShell } from './shell.mjs'
import { register as registerCompleteness } from './completeness.mjs'
import { register as registerNumbering } from './numbering.mjs'
import { register as registerSearch } from './search.mjs'
import { register as registerInspection } from './inspection.mjs'
import { register as registerProgress } from './progress.mjs'
import { register as registerPayment } from './payment.mjs'
import { register as registerContract } from './contract.mjs'
import { register as registerPhoto } from './photo.mjs'
import { register as registerDb } from './db.mjs'
import { register as registerFilename } from './filename.mjs'
import { register as registerSop } from './sop.mjs'
import { register as registerUpdate } from './update.mjs'
import { register as registerMaterial } from './material.mjs'
import { register as registerTemplate } from './template.mjs'
import { register as registerOperations } from './operations.mjs'
import { register as registerDelivery } from './delivery.mjs'
import { register as registerDashboard } from './dashboard.mjs'
import { register as registerRelease } from './release.mjs'
import { getSettings } from './shared.mjs'
import { setCustomProjectTypes } from '../../src/shared/projectProfile.mjs'
import { setCustomDocTypes } from '../templateRegistry.mjs'
import { setCustomDocTypeCodes } from './filename.mjs'
import { setCustomDocTypePrefixes } from './numbering.mjs'
import { setCustomStructuredDocTypes } from '../templateService.mjs'

export function registerAll(ipcMain, mainWindow) {
  registerProject(ipcMain)
  registerFile(ipcMain)
  registerDoc(ipcMain)
  registerSettings(ipcMain)
  registerShell(ipcMain, mainWindow)
  registerCompleteness(ipcMain)
  registerNumbering(ipcMain)
  registerSearch(ipcMain)
  registerInspection(ipcMain)
  registerProgress(ipcMain)
  registerPayment(ipcMain)
  registerContract(ipcMain)
  registerPhoto(ipcMain)
  registerDb(ipcMain, mainWindow)
  registerFilename(ipcMain)
  registerSop(ipcMain)
  registerUpdate(ipcMain)
  registerMaterial(ipcMain)
  registerTemplate(ipcMain)
  registerOperations(ipcMain)
  registerDelivery(ipcMain)
  registerDashboard(ipcMain)
  registerRelease(ipcMain)

  // v1.x：主进程启动时把 settings 里的 customProjectTypes / customDocTypes 注入运行时
  // （getSettings 内部已经会注入一次，这里再注入一次防 race）
  try {
    const settings = getSettings()
    const projectTypes = settings.customProjectTypes || []
    const docTypes = settings.customDocTypes || []
    setCustomProjectTypes(projectTypes)
    setCustomDocTypes(docTypes)
    setCustomDocTypeCodes(docTypes)
    setCustomDocTypePrefixes(docTypes)
    setCustomStructuredDocTypes(docTypes)
  } catch (e) {
    console.error('[registerAll] inject custom types failed:', e.message)
  }
}

// v1.x：app ready 后用，把自定义类型注入 + 推送给渲染进程
export function bootstrapCustomTypes(mainWindow) {
  applyCustomTypesToRuntime(mainWindow)
}

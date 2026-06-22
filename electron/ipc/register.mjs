import { register as registerProject } from './project.mjs'
import { register as registerFile } from './file.mjs'
import { register as registerDoc } from './doc.mjs'
import { register as registerSettings } from './settings.mjs'
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
  registerDb(ipcMain)
}

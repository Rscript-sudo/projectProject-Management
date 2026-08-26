import fs from 'node:fs'
import path from 'node:path'
import { safeCall } from './safe.mjs'
import { createTask, updateTask, cancelTask, retryTask, appendDiagnostic, listOperations, clearFinishedOperations, resolveModelCapabilities, routeModel, scoreDocumentQuality, auditDocxTemplate } from '../operationCenter.mjs'
import { readProjectIndex } from './shared.mjs'
import { renderDocxVisualAudit } from '../visualRegression.mjs'

function assertProject(projectPath) {
  const normalized = path.resolve(String(projectPath || ''))
  const found = readProjectIndex().projects.some(project => path.resolve(project.path) === normalized)
  if (!found) throw new Error('项目未在系统索引中注册')
  return normalized
}

export function register(ipcMain) {
  ipcMain.handle('operations:create', safeCall((_, input) => ({ success: true, task: createTask(input) })))
  ipcMain.handle('operations:update', safeCall((_, id, patch) => ({ success: true, task: updateTask(id, patch) })))
  ipcMain.handle('operations:cancel', safeCall((_, id) => ({ success: true, task: cancelTask(id) })))
  ipcMain.handle('operations:retry', safeCall((_, id) => ({ success: true, task: retryTask(id) })))
  ipcMain.handle('operations:diagnostic', safeCall((_, input) => ({ success: true, event: appendDiagnostic(input) })))
  ipcMain.handle('operations:list', safeCall((_, filters) => ({ success: true, ...listOperations(filters) })))
  ipcMain.handle('operations:clearFinished', safeCall(() => clearFinishedOperations()))
  ipcMain.handle('ai:modelCapabilities', safeCall((_, model) => ({ success: true, capabilities: resolveModelCapabilities(model) })))
  ipcMain.handle('ai:routeModel', safeCall((_, candidates, requirements) => ({ success: true, route: routeModel(candidates, requirements) })))
  ipcMain.handle('doc:scoreQuality', safeCall((_, docType, content) => ({ success: true, quality: scoreDocumentQuality(docType, content) })))
  ipcMain.handle('doc:visualAudit', safeCall(async (_, filePath) => ({ success: true, audit: await renderDocxVisualAudit(filePath) })))
  ipcMain.handle('template:audit', safeCall((_, filePath) => auditDocxTemplate(filePath)))
  ipcMain.handle('project:createBackup', safeCall((_, projectPath) => {
    const source = assertProject(projectPath)
    const backupRoot = path.join(path.dirname(source), '.项目备份'); fs.mkdirSync(backupRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const target = path.join(backupRoot, `${path.basename(source)}_${stamp}`)
    fs.cpSync(source, target, { recursive: true, errorOnExist: true })
    return { success: true, path: target }
  }))
  ipcMain.handle('project:listBackups', safeCall((_, projectPath) => {
    const source = assertProject(projectPath); const backupRoot = path.join(path.dirname(source), '.项目备份')
    if (!fs.existsSync(backupRoot)) return { success: true, backups: [] }
    const prefix = `${path.basename(source)}_`
    const backups = fs.readdirSync(backupRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(prefix)).map(entry => { const target = path.join(backupRoot, entry.name); const stat = fs.statSync(target); return { name: entry.name, path: target, createdAt: stat.birthtime.toISOString() } }).sort((a, b) => b.name.localeCompare(a.name))
    return { success: true, backups }
  }))
  ipcMain.handle('project:restoreBackup', safeCall((_, projectPath, backupPath) => {
    const target = assertProject(projectPath); const backupRoot = path.resolve(path.dirname(target), '.项目备份'); const source = path.resolve(String(backupPath || ''))
    if (path.dirname(source) !== backupRoot || !path.basename(source).startsWith(`${path.basename(target)}_`) || !fs.existsSync(source)) throw new Error('备份路径无效')
    const safety = path.join(backupRoot, `${path.basename(target)}_恢复前_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`)
    fs.cpSync(target, safety, { recursive: true, errorOnExist: true })
    for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true })
    fs.cpSync(source, target, { recursive: true, force: true })
    return { success: true, restoredFrom: source, safetyBackup: safety }
  }))
}

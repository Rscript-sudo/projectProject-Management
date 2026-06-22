import { shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { ensureDir, ensureProjectIndex, readProjectIndex, writeProjectIndex, createProjectStructure, getProjectDataPath, ensureProjectDataDir, getDefaultRoot, getSettings } from './shared.mjs'

export function register(ipcMain) {
  ipcMain.handle('fs:getRoot', () => {
    try {
      const settings = getSettings()
      return settings.projectRoot || getDefaultRoot()
    } catch (e) {
      console.error('[fs:getRoot]', e.message)
      return getDefaultRoot()
    }
  })

  ipcMain.handle('fs:getProjects', (_, rootPath) => {
    try {
      const index = ensureProjectIndex(rootPath)
      return index.projects
        .map(p => ({ name: p.name, path: p.path }))
        .sort((a, b) => b.name.localeCompare(a.name))
    } catch (e) {
      console.error('[fs:getProjects]', e.message)
      return []
    }
  })

  ipcMain.handle('fs:createProject', safeCall((_, rootPath, projectName, projectType = '通用') => {
    const projectPath = path.join(rootPath, projectName)
    if (fs.existsSync(projectPath)) return { success: false, error: '项目已存在' }
    ensureDir(projectPath)
    createProjectStructure(projectPath, projectName, projectType)
    const index = readProjectIndex()
    index.projects.push({ name: projectName, path: projectPath, addedAt: new Date().toISOString() })
    writeProjectIndex(index)
    return { success: true, path: projectPath }
  }))

  ipcMain.handle('fs:readProjectConfig', (_, projectPath) => {
    try {
      const configPath = path.join(getProjectDataPath(path.basename(projectPath)), 'project.config.json')
      if (!fs.existsSync(configPath)) return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用' }
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用' }
    }
  })

  ipcMain.handle('fs:writeProjectConfig', safeCall((_, projectPath, config) => {
    const dataDir = getProjectDataPath(path.basename(projectPath))
    ensureDir(dataDir)
    const configPath = path.join(dataDir, 'project.config.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { success: true }
  }))

  ipcMain.handle('fs:getProjectLedgers', (_, projectPath) => {
    const LEDGER_FILES = [
      { key: 'contract', label: '合同台账', file: '合同台账.json' },
      { key: 'correspondence', label: '往来函件', file: '往来函件登记台账.json' },
      { key: 'hazard', label: '隐患台账', file: '隐患台账.json' },
      { key: 'meeting', label: '会议纪要', file: '会议纪要台账.json' },
      { key: 'construction', label: '施工方案', file: '施工方案台账.json' },
      { key: 'log', label: '监理日志', file: '监理日志台账.json' },
    ]
    try {
      const projectName = path.basename(projectPath)
      const dataDir = getProjectDataPath(projectName)
      const result = {}
      for (const { key, label, file } of LEDGER_FILES) {
        const ledgerPath = path.join(dataDir, file)
        let items = []
        if (fs.existsSync(ledgerPath)) {
          try {
            const raw = fs.readFileSync(ledgerPath, 'utf8')
            const data = JSON.parse(raw)
            items = Array.isArray(data.items) ? data.items : []
          } catch (e) {
            console.error('[getProjectLedgers] Failed to read ledger file:', ledgerPath, e.message)
            items = []
          }
        }
        result[key] = { label, file, items }
      }
      return result
    } catch (e) {
      console.error('[getProjectLedgers]', projectPath, e.message)
      return {}
    }
  })

  ipcMain.handle('fs:readLedger', (_, projectPath, ledgerName) => {
    try {
      const projectName = path.basename(projectPath)
      const ledgerPath = path.join(getProjectDataPath(projectName), ledgerName)
      if (!fs.existsSync(ledgerPath)) return { items: [] }
      return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    } catch {
      return { items: [] }
    }
  })

  ipcMain.handle('fs:writeLedger', safeCall((_, projectPath, ledgerName, data) => {
    const projectName = path.basename(projectPath)
    const ledgerPath = path.join(getProjectDataPath(projectName), ledgerName)
    fs.writeFileSync(ledgerPath, JSON.stringify(data, null, 2), 'utf8')
    return { success: true }
  }))

  ipcMain.handle('fs:getProjectDataPath', (_, projectPath) => {
    try {
      if (!projectPath) return ''
      return getProjectDataPath(path.basename(projectPath))
    } catch (e) {
      console.error('[fs:getProjectDataPath]', e.message)
      return ''
    }
  })

  ipcMain.handle('fs:unbindProject', safeCall((_, projectPath) => {
    const index = readProjectIndex()
    const before = index.projects.length
    index.projects = index.projects.filter(p => p.path !== projectPath)
    writeProjectIndex(index)
    return { success: true, removed: before !== index.projects.length }
  }))

  ipcMain.handle('fs:deleteProject', safeCall(async (_, projectPath) => {
    const index = readProjectIndex()
    index.projects = index.projects.filter(p => p.path !== projectPath)
    writeProjectIndex(index)

    try {
      await shell.trashItem(projectPath)
      return { success: true }
    } catch (e) {
      try {
        fs.rmSync(projectPath, { recursive: true, force: true })
        return { success: true }
      } catch (e2) {
        return { success: false, error: e2.message }
      }
    }
  }))

  ipcMain.handle('fs:renameProject', safeCall((_, oldPath, newName) => {
    const parentDir = path.dirname(oldPath)
    const newPath = path.join(parentDir, newName)
    if (fs.existsSync(newPath)) return { success: false, error: '目标名称已存在' }
    if (!fs.existsSync(oldPath)) return { success: false, error: '原项目路径不存在' }
    fs.renameSync(oldPath, newPath)
    const index = readProjectIndex()
    const proj = index.projects.find(p => p.path === oldPath)
    if (proj) {
      proj.path = newPath
      proj.name = newName
      writeProjectIndex(index)
    }
    return { success: true, path: newPath }
  }))
}

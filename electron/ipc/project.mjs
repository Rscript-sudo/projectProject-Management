import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { safeCall } from './safe.mjs'
import { ensureDir, ensureProjectIndex, readProjectIndex, writeProjectIndex, createProjectStructure, getProjectDataPath, ensureProjectDataDir, getDefaultRoot, getSettings } from './shared.mjs'
import { generateProjectCodeFromName } from './filename.mjs'

function projectTemplateConfig(projectPath) {
  const dataDir = getProjectDataPath(path.basename(projectPath))
  const configPath = path.join(dataDir, 'project.config.json')
  let config = {}
  if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return { dataDir, configPath, config }
}

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
      if (!fs.existsSync(configPath)) return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用', projectCode: 'PROJECT' }
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      // 旧项目兼容：没有 projectCode 时按项目名兜底
      if (!cfg.projectCode) {
        cfg.projectCode = generateProjectCodeFromName(path.basename(projectPath))
      }
      return cfg
    } catch {
      return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用', projectCode: 'PROJECT' }
    }
  })

  ipcMain.handle('fs:writeProjectConfig', safeCall((_, projectPath, config) => {
    const dataDir = getProjectDataPath(path.basename(projectPath))
    ensureDir(dataDir)
    const configPath = path.join(dataDir, 'project.config.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { success: true }
  }))

  // 项目模板独立保存到项目目录；项目配置仅记录当前生效版本。
  // 这样替换模板不会影响其他项目，通用模板仍可作为未配置项目的兜底。
  ipcMain.handle('fs:assignProjectTemplate', safeCall((_, projectPath, docType, sourcePath) => {
    if (!projectPath || !docType || !sourcePath || path.extname(sourcePath).toLowerCase() !== '.docx') {
      return { success: false, error: '请选择有效的 Word 模板文件' }
    }
    if (!fs.existsSync(sourcePath)) return { success: false, error: '模板文件不存在' }
    const templateDir = path.join(projectPath, '项目模板')
    ensureDir(templateDir)
    const safeType = String(docType).replace(/[\\/:*?"<>|]/g, '_')
    const targetPath = path.join(templateDir, `${safeType}_${Date.now()}.docx`)
    fs.copyFileSync(sourcePath, targetPath)

    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    config.templateOverrides = { ...(config.templateOverrides || {}), [docType]: { path: targetPath, sourceName: path.basename(sourcePath), updatedAt: new Date().toISOString() } }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { success: true, path: targetPath, templateOverride: config.templateOverrides[docType] }
  }))

  ipcMain.handle('fs:getProjectTemplateContract', async (_, projectPath, docType) => {
    try {
      const { config } = projectTemplateConfig(projectPath)
      const templatesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'templates')
        : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates')
      const { findTemplate, getTemplatePlaceholders } = await import('../templateService.mjs')
      const { resolveLibraryTemplate } = await import('../templateRegistry.mjs')
      const libraryTemplate = resolveLibraryTemplate(app.getPath('userData'), {
        docType,
        projectType: config.projectType || '通用',
        selectedTemplateId: config.templateSelections?.[docType],
      })
      const template = findTemplate(templatesDir, docType, { templateOverride: config.templateOverrides?.[docType] || libraryTemplate })
      if (!template) return { found: false, fields: [] }
      return { found: true, fields: await getTemplatePlaceholders(template.templatePath), source: config.templateOverrides?.[docType] ? 'project' : (libraryTemplate ? libraryTemplate.scope : template.source), path: template.templatePath, templateId: libraryTemplate?.id }
    } catch (e) {
      return { found: false, fields: [], error: e.message }
    }
  })

  ipcMain.handle('fs:getProjectLedgers', (_, projectPath) => {
    const LEDGER_FILES = [
      { key: 'contract', label: '合同台账', file: '合同台账.json' },
      { key: 'correspondence', label: '往来函件', file: '往来函件登记台账.json' },
      { key: 'hazard', label: '隐患台账', file: '隐患台账.json' },
      { key: 'meeting', label: '会议纪要', file: '会议纪要台账.json' },
      { key: 'construction', label: '施工方案', file: '施工方案台账.json' },
      { key: 'log', label: '监理日志', file: '监理日志台账.json' },
    ]
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
  })

  ipcMain.handle('fs:writeLedger', safeCall((_, projectPath, ledgerName, data) => {
    const projectName = path.basename(projectPath)
    const ledgerPath = path.join(getProjectDataPath(projectName), ledgerName)
    fs.writeFileSync(ledgerPath, JSON.stringify(data, null, 2), 'utf8')
    return { success: true }
  }))

  ipcMain.handle('fs:listTemplateLibrary', async () => {
    const { listTemplateLibrary } = await import('../templateRegistry.mjs')
    return listTemplateLibrary(app.getPath('userData'))
  })

  ipcMain.handle('fs:importTemplateToLibrary', safeCall(async (_, payload) => {
    const { importTemplateToLibrary } = await import('../templateRegistry.mjs')
    return { success: true, template: await importTemplateToLibrary({ userDataPath: app.getPath('userData'), ...payload }) }
  }))

  ipcMain.handle('fs:selectProjectTemplate', safeCall((_, projectPath, docType, templateId) => {
    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    config.templateSelections = { ...(config.templateSelections || {}), [docType]: templateId || null }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return { success: true, templateId: config.templateSelections[docType] }
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

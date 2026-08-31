import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'url'
import { safeCall } from './safe.mjs'
import { ensureDir, ensureProjectIndex, readProjectIndex, writeProjectIndex, createProjectStructure, getProjectDataPath, ensureProjectDataDir, getDefaultRoot, getSettings } from './shared.mjs'
import { generateProjectCodeFromName } from './filename.mjs'
import { normalizeProjectProfile } from '../../src/shared/projectProfile.mjs'
import { normalizeDocumentRules } from '../../src/shared/documentRules.mjs'
import { assertSafeProjectName, getCurrentMasterProfile } from '../db/repo.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'
import { getRuntimeSystemTemplatesDir } from '../templateWorkspace.mjs'

const PROJECT_LEDGER_FILES = new Set([
  '合同台账.json',
  '往来函件登记台账.json',
  '隐患台账.json',
  '会议纪要台账.json',
  '施工方案台账.json',
  '监理日志台账.json',
])

function normalizeAbsolutePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    throw new Error('项目路径无效')
  }
  return path.resolve(targetPath)
}

function isPathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function assertIndexedProjectPath(projectPath, index) {
  const normalizedPath = normalizeAbsolutePath(projectPath)
  const indexedProject = index.projects.find(project => (
    typeof project.path === 'string' && path.resolve(project.path) === normalizedPath
  ))
  if (!indexedProject) throw new Error('项目未在系统索引中注册')

  const configuredRoot = normalizeAbsolutePath(getSettings().projectRoot || getDefaultRoot())
  const realRoot = fs.realpathSync(configuredRoot)
  const realProjectPath = fs.realpathSync(normalizedPath)
  if (!isPathInside(realRoot, realProjectPath)) {
    throw new Error('项目路径不在已配置的项目根目录内')
  }
  return { indexedProject, normalizedPath, realProjectPath }
}

function projectTemplateConfig(projectPath) {
  const dataDir = getProjectDataPath(path.basename(projectPath))
  const configPath = path.join(dataDir, 'project.config.json')
  let config = {}
  if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return { dataDir, configPath, config: { ...config, documentRules: normalizeDocumentRules(config.documentRules) } }
}

function projectChatHistoryPath(projectPath) {
  const dataDir = getProjectDataPath(path.basename(projectPath))
  return { dataDir, historyPath: path.join(dataDir, 'ai-chat-history.json') }
}

function normalizeChatMessage(item) {
  return {
    id: String(item?.id || crypto.randomUUID()), role: item?.role === 'user' ? 'user' : 'assistant', content: String(item?.content || ''),
    ...(item?.docType ? { docType: String(item.docType) } : {}), ...(item?.wordCount != null ? { wordCount: Number(item.wordCount) || 0 } : {}),
    ...(item?.rawData && typeof item.rawData === 'object' ? { rawData: item.rawData } : {}), ...(item?.imageContext ? { imageContext: String(item.imageContext) } : {}),
    ...(Array.isArray(item?.imagePaths) ? { imagePaths: item.imagePaths.map(String).slice(0, 20) } : {}), ...(Array.isArray(item?.actions) ? { actions: item.actions.slice(0, 10) } : {}),
    timestamp: item?.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
  }
}
function readChatStore(projectPath) {
  const { dataDir, historyPath } = projectChatHistoryPath(projectPath)
  if (!fs.existsSync(historyPath)) return { dataDir, historyPath, store: { version: 3, activeSessionId: '', sessions: [] } }
  const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  if (parsed.version >= 3 && Array.isArray(parsed.sessions)) return { dataDir, historyPath, store: parsed }
  const id = crypto.randomUUID(); const messages = (Array.isArray(parsed.messages) ? parsed.messages : []).map(normalizeChatMessage)
  return { dataDir, historyPath, store: { version: 3, activeSessionId: id, sessions: [{ id, title: '历史会话', archived: false, createdAt: parsed.updatedAt || new Date().toISOString(), updatedAt: parsed.updatedAt || new Date().toISOString(), messages }] } }
}
function writeChatStore(dataDir, historyPath, store) {
  ensureDir(dataDir); const temporary = `${historyPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ ...store, version: 3, updatedAt: new Date().toISOString() }, null, 2), 'utf8'); fs.renameSync(temporary, historyPath)
}

/**
 * 原子写 JSON：先写 .tmp 再 rename，避免中途崩溃留下半截文件导致下次 JSON.parse 失败
 */
function atomicWriteJson(filePath, data) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(temporary, filePath)
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

  ipcMain.handle('fs:createProject', safeCall((_, rootPath, projectName, projectType = '未分类', projectProfile = {}) => {
    assertSafeProjectName(projectName)
    const projectPath = path.join(rootPath, projectName)
    if (fs.existsSync(projectPath)) return { success: false, error: '项目已存在' }
    ensureDir(projectPath)
    createProjectStructure(projectPath, projectName, projectType, projectProfile)
    const index = readProjectIndex()
    index.projects.push({ name: projectName, path: projectPath, addedAt: new Date().toISOString() })
    writeProjectIndex(index)
    return { success: true, path: projectPath }
  }))

  ipcMain.handle('fs:readProjectConfig', (_, projectPath) => {
    try {
      const configPath = path.join(getProjectDataPath(path.basename(projectPath)), 'project.config.json')
      if (!fs.existsSync(configPath)) return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', ...normalizeProjectProfile(), documentRules: normalizeDocumentRules(), projectCode: 'PROJECT' }
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      // 旧项目兼容：没有 projectCode 时按项目名兜底
      if (!cfg.projectCode) {
        cfg.projectCode = generateProjectCodeFromName(path.basename(projectPath))
      }
      const master = getCurrentMasterProfile(path.basename(projectPath))
      const merged = { ...cfg, ...Object.fromEntries(Object.entries(master).filter(([, value]) => value)) }
      return { ...merged, ...normalizeProjectProfile(merged), documentRules: normalizeDocumentRules(merged.documentRules) }
    } catch (e) {
      console.error('[fs:readProjectConfig] 读取失败:', e.message)
      return { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', ...normalizeProjectProfile(), documentRules: normalizeDocumentRules(), projectCode: 'PROJECT' }
    }
  })

  ipcMain.handle('fs:writeProjectConfig', safeCall((_, projectPath, config) => {
    if (!projectPath || !isPathSafe(projectPath)) return { success: false, error: '项目路径不安全' }
    const dataDir = getProjectDataPath(path.basename(projectPath))
    ensureDir(dataDir)
    const configPath = path.join(dataDir, 'project.config.json')
    atomicWriteJson(configPath, { ...config, ...normalizeProjectProfile(config), documentRules: normalizeDocumentRules(config.documentRules) })
    return { success: true }
  }))

  ipcMain.handle('fs:readProjectChatHistory', safeCall((_, projectPath) => {
    const index = readProjectIndex()
    assertIndexedProjectPath(projectPath, index)
    const { dataDir, historyPath, store } = readChatStore(projectPath)
    let session = store.sessions.find(item => item.id === store.activeSessionId && !item.archived) || store.sessions.find(item => !item.archived)
    if (!session) { const now = new Date().toISOString(); session = { id: crypto.randomUUID(), title: '新会话', archived: false, createdAt: now, updatedAt: now, messages: [] }; store.sessions.unshift(session); store.activeSessionId = session.id; writeChatStore(dataDir, historyPath, store) }
    return { success: true, sessionId: session.id, messages: session.messages || [] }
  }))

  ipcMain.handle('fs:writeProjectChatHistory', safeCall((_, projectPath, messages) => {
    const index = readProjectIndex()
    assertIndexedProjectPath(projectPath, index)
    const { dataDir, historyPath, store } = readChatStore(projectPath)
    let session = store.sessions.find(item => item.id === store.activeSessionId)
    if (!session) { const now = new Date().toISOString(); session = { id: crypto.randomUUID(), title: '新会话', archived: false, createdAt: now, updatedAt: now, messages: [] }; store.sessions.unshift(session); store.activeSessionId = session.id }
    const normalized = (Array.isArray(messages) ? messages : []).slice(-200).map(normalizeChatMessage)
    session.messages = normalized; session.updatedAt = new Date().toISOString(); if (session.title === '新会话' && normalized[0]?.content) session.title = normalized[0].content.slice(0, 28)
    writeChatStore(dataDir, historyPath, store)
    return { success: true, count: normalized.length }
  }))

  ipcMain.handle('chat:listSessions', safeCall((_, projectPath, query = '') => {
    assertIndexedProjectPath(projectPath, readProjectIndex()); const { store } = readChatStore(projectPath); const keyword = String(query).trim().toLowerCase()
    return { success: true, activeSessionId: store.activeSessionId, sessions: store.sessions.filter(session => !keyword || session.title.toLowerCase().includes(keyword) || session.messages.some(message => message.content.toLowerCase().includes(keyword))).map(({ messages, ...session }) => ({ ...session, messageCount: messages.length, preview: messages.at(-1)?.content?.slice(0, 80) || '' })) }
  }))
  ipcMain.handle('chat:createSession', safeCall((_, projectPath, title = '新会话') => {
    assertIndexedProjectPath(projectPath, readProjectIndex()); const { dataDir, historyPath, store } = readChatStore(projectPath); const now = new Date().toISOString(); const session = { id: crypto.randomUUID(), title: String(title || '新会话').slice(0, 60), archived: false, createdAt: now, updatedAt: now, messages: [] }; store.sessions.unshift(session); store.activeSessionId = session.id; writeChatStore(dataDir, historyPath, store); return { success: true, session }
  }))
  ipcMain.handle('chat:openSession', safeCall((_, projectPath, sessionId) => {
    assertIndexedProjectPath(projectPath, readProjectIndex()); const { dataDir, historyPath, store } = readChatStore(projectPath); const session = store.sessions.find(item => item.id === sessionId); if (!session) throw new Error('会话不存在'); store.activeSessionId = session.id; session.archived = false; writeChatStore(dataDir, historyPath, store); return { success: true, session }
  }))
  ipcMain.handle('chat:archiveSession', safeCall((_, projectPath, sessionId, archived = true) => {
    assertIndexedProjectPath(projectPath, readProjectIndex()); const { dataDir, historyPath, store } = readChatStore(projectPath); const session = store.sessions.find(item => item.id === sessionId); if (!session) throw new Error('会话不存在'); session.archived = Boolean(archived); session.updatedAt = new Date().toISOString(); if (archived && store.activeSessionId === sessionId) store.activeSessionId = ''; writeChatStore(dataDir, historyPath, store); return { success: true }
  }))

  // 项目模板独立保存到项目目录；项目配置仅记录当前生效版本。
  // 这样替换模板不会影响其他项目，通用模板仍可作为未配置项目的兜底。
  ipcMain.handle('fs:assignProjectTemplate', safeCall((_, projectPath, docType, sourcePath) => {
    if (!projectPath || !docType || !sourcePath || path.extname(sourcePath).toLowerCase() !== '.docx') {
      return { success: false, error: '请选择有效的 Word 模板文件' }
    }
    assertIndexedProjectPath(projectPath, readProjectIndex())
    if (!isPathSafe(sourcePath)) return { success: false, error: '模板源路径不安全' }
    if (!fs.existsSync(sourcePath)) return { success: false, error: '模板文件不存在' }
    const templateDir = path.join(projectPath, '项目模板')
    ensureDir(templateDir)
    const safeType = String(docType).replace(/[\\/:*?"<>|]/g, '_')
    const targetPath = path.join(templateDir, `${safeType}_${Date.now()}.docx`)
    fs.copyFileSync(sourcePath, targetPath)

    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    config.templateOverrides = { ...(config.templateOverrides || {}), [docType]: { path: targetPath, sourceName: path.basename(sourcePath), updatedAt: new Date().toISOString() } }
    atomicWriteJson(configPath, config)
    return { success: true, path: targetPath, templateOverride: config.templateOverrides[docType] }
  }))

  // 恢复项目的自动模板匹配。保留项目模板文件，避免用户误操作后无法找回原件。
  ipcMain.handle('fs:clearProjectTemplateOverride', safeCall((_, projectPath, docType) => {
    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    const overrides = { ...(config.templateOverrides || {}) }
    delete overrides[docType]
    config.templateOverrides = overrides
    atomicWriteJson(configPath, config)
    return { success: true }
  }))

  ipcMain.handle('fs:getProjectTemplateContract', async (_, projectPath, docType) => {
    try {
      const { config } = projectTemplateConfig(projectPath)
      const templatesDir = getRuntimeSystemTemplatesDir() || (app.isPackaged
        ? path.join(process.resourcesPath, 'templates')
        : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates'))
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
    if (!PROJECT_LEDGER_FILES.has(ledgerName)) {
      return { success: false, error: '不允许写入未知台账文件' }
    }
    assertIndexedProjectPath(projectPath, readProjectIndex())
    const projectName = path.basename(projectPath)
    const ledgerPath = path.join(getProjectDataPath(projectName), ledgerName)
    atomicWriteJson(ledgerPath, data)
    return { success: true }
  }))

  ipcMain.handle('fs:listTemplateLibrary', async () => {
    const { listTemplateLibrary, reconcileTemplateLibraryFiles } = await import('../templateRegistry.mjs')
    await reconcileTemplateLibraryFiles(app.getPath('userData'))
    return listTemplateLibrary(app.getPath('userData'))
  })

  ipcMain.handle('fs:listSystemTemplates', async () => {
    const templatesDir = getRuntimeSystemTemplatesDir() || (app.isPackaged
      ? path.join(process.resourcesPath, 'templates')
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates'))
    const { listSystemTemplates } = await import('../templateService.mjs')
    return listSystemTemplates(templatesDir)
  })

  ipcMain.handle('fs:importTemplateToLibrary', safeCall(async (_, payload) => {
    const { importTemplateToLibrary } = await import('../templateRegistry.mjs')
    return { success: true, template: await importTemplateToLibrary({ userDataPath: app.getPath('userData'), ...payload }) }
  }))

  ipcMain.handle('fs:cloneSystemTemplateToLibrary', safeCall(async (_, { docType, scope = 'global', projectType = '通用', name }) => {
    const templatesDir = getRuntimeSystemTemplatesDir() || (app.isPackaged
      ? path.join(process.resourcesPath, 'templates')
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates'))
    const { listSystemTemplates } = await import('../templateService.mjs')
    const source = (await listSystemTemplates(templatesDir)).find(item => item.docType === docType)
    if (!source) return { success: false, error: `未找到${docType}系统预置模板` }
    const { importTemplateToLibrary } = await import('../templateRegistry.mjs')
    return { success: true, template: await importTemplateToLibrary({ userDataPath: app.getPath('userData'), sourcePath: source.path, docType, scope, projectType, name: name || `${docType}企业模板` }) }
  }))

  ipcMain.handle('fs:refreshTemplateLibraryEntry', safeCall(async (_, templateId) => {
    const { refreshTemplateLibraryEntry } = await import('../templateRegistry.mjs')
    return { success: true, template: await refreshTemplateLibraryEntry({ userDataPath: app.getPath('userData'), templateId }) }
  }))

  ipcMain.handle('fs:selectProjectTemplate', safeCall((_, projectPath, docType, templateId) => {
    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    config.templateSelections = { ...(config.templateSelections || {}), [docType]: templateId || null }
    atomicWriteJson(configPath, config)
    return { success: true, templateId: config.templateSelections[docType] }
  }))

  ipcMain.handle('fs:getRuleCatalog', () => import('../../src/shared/documentRules.mjs').then(({ RULE_PACKS, DEFAULT_RULE_PACK_IDS }) => ({ packs: RULE_PACKS, defaults: DEFAULT_RULE_PACK_IDS })))

  ipcMain.handle('fs:saveProjectDocumentRules', safeCall((_, projectPath, documentRules) => {
    const { dataDir, configPath, config } = projectTemplateConfig(projectPath)
    ensureDir(dataDir)
    config.documentRules = normalizeDocumentRules(documentRules)
    atomicWriteJson(configPath, config)
    return { success: true, documentRules: config.documentRules }
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
    const { normalizedPath } = assertIndexedProjectPath(projectPath, index)
    try {
      await shell.trashItem(normalizedPath)
    } catch (e) {
      return { success: false, error: `移入回收站失败：${e.message}` }
    }
    index.projects = index.projects.filter(project => path.resolve(project.path) !== normalizedPath)
    writeProjectIndex(index)
    return { success: true }
  }))

  ipcMain.handle('fs:renameProject', safeCall((_, oldPath, newName) => {
    assertSafeProjectName(newName)
    const index = readProjectIndex()
    const { normalizedPath } = assertIndexedProjectPath(oldPath, index)
    const parentDir = path.dirname(normalizedPath)
    const newPath = path.join(parentDir, newName)
    if (fs.existsSync(newPath)) return { success: false, error: '目标名称已存在' }
    fs.renameSync(normalizedPath, newPath)
    const proj = index.projects.find(p => path.resolve(p.path) === normalizedPath)
    if (proj) {
      proj.path = newPath
      proj.name = newName
      writeProjectIndex(index)
    }
    return { success: true, path: newPath }
  }))
}

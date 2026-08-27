const { contextBridge, ipcRenderer, webUtils } = require('electron')

const api = {
  getRoot: () => ipcRenderer.invoke('fs:getRoot'),
  selectDir: () => ipcRenderer.invoke('dialog:selectDir'),
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readClipboardText: () => ipcRenderer.invoke('shell:readClipboardText'),
  readFileContent: (filePath) => ipcRenderer.invoke('fs:readFileContent', filePath),
  getProjects: (rootPath) => ipcRenderer.invoke('fs:getProjects', rootPath),
  createProject: (rootPath, name, projectType, projectProfile) => ipcRenderer.invoke('fs:createProject', rootPath, name, projectType, projectProfile),
  getDirTree: (dirPath, maxDepth) => ipcRenderer.invoke('fs:getDirTree', dirPath, maxDepth),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteProject: (projectPath) => ipcRenderer.invoke('fs:deleteProject', projectPath),
  renameProject: (oldPath, newName) => ipcRenderer.invoke('fs:renameProject', oldPath, newName),
  unbindProject: (projectPath) => ipcRenderer.invoke('fs:unbindProject', projectPath),
  saveDoc: (options) => ipcRenderer.invoke('fs:saveDoc', options),
  callAI: (options) => ipcRenderer.invoke('ai:call', options),
  recognizeImages: (options) => ipcRenderer.invoke('photo:recognizeImages', options),
  listModels: (options) => ipcRenderer.invoke('ai:listModels', options),
  checkAIHealth: (options) => ipcRenderer.invoke('ai:health', options),
  getModelCapabilities: (model) => ipcRenderer.invoke('ai:modelCapabilities', model),
  routeModel: (candidates, requirements) => ipcRenderer.invoke('ai:routeModel', candidates, requirements),
  createOperation: (input) => ipcRenderer.invoke('operations:create', input),
  updateOperation: (id, patch) => ipcRenderer.invoke('operations:update', id, patch),
  cancelOperation: (id) => ipcRenderer.invoke('operations:cancel', id),
  retryOperation: (id) => ipcRenderer.invoke('operations:retry', id),
  appendDiagnostic: (input) => ipcRenderer.invoke('operations:diagnostic', input),
  listOperations: (filters) => ipcRenderer.invoke('operations:list', filters),
  clearFinishedOperations: () => ipcRenderer.invoke('operations:clearFinished'),
  scoreDocumentQuality: (docType, content) => ipcRenderer.invoke('doc:scoreQuality', docType, content),
  auditDocumentVisual: (filePath) => ipcRenderer.invoke('doc:visualAudit', filePath),
  auditTemplate: (filePath) => ipcRenderer.invoke('template:audit', filePath),
  createProjectBackup: (projectPath) => ipcRenderer.invoke('project:createBackup', projectPath),
  listProjectBackups: (projectPath) => ipcRenderer.invoke('project:listBackups', projectPath),
  restoreProjectBackup: (projectPath, backupPath) => ipcRenderer.invoke('project:restoreBackup', projectPath, backupPath),
  callAIStream: (options) => ipcRenderer.invoke('ai:stream', options),
  abortAIStream: (requestId) => ipcRenderer.send(`ai:abort:${requestId}`),
  // v1.2.1 P0 修复：流式 listener Set 去重（防 HMR 重复添加）
  // channel 名仍用全局 ai:stream:chunk（带 requestId 字段），callback 内部用 requestId 过滤
  // 旧实现：每次组件挂载 addListener 不去重 → 同一个 chunk 被 N 个 callback 处理
  _streamChunkListeners: new Map(),
  _streamEndListeners: new Map(),
  onAIStreamChunk: (callback) => {
    const existing = api._streamChunkListeners.get(callback)
    if (existing) return () => {
      ipcRenderer.removeListener('ai:stream:chunk', existing)
      api._streamChunkListeners.delete(callback)
    }
    const listener = (_event, data) => callback(data)
    api._streamChunkListeners.set(callback, listener)
    ipcRenderer.on('ai:stream:chunk', listener)
    return () => {
      api._streamChunkListeners.delete(callback)
      ipcRenderer.removeListener('ai:stream:chunk', listener)
    }
  },
  onAIStreamEnd: (callback) => {
    const existing = api._streamEndListeners.get(callback)
    if (existing) return () => {
      ipcRenderer.removeListener('ai:stream:end', existing)
      api._streamEndListeners.delete(callback)
    }
    const listener = (_event, data) => callback(data)
    api._streamEndListeners.set(callback, listener)
    ipcRenderer.on('ai:stream:end', listener)
    return () => {
      api._streamEndListeners.delete(callback)
      ipcRenderer.removeListener('ai:stream:end', listener)
    }
  },
  // v1.2.1 P0 修复：HMR 卸载 / 页面关闭时清空所有 stream listener
  // 防主进程 callback 引用泄漏 + 重复触发
  _removeAllStreamListeners: () => {
    for (const listener of api._streamChunkListeners.values()) ipcRenderer.removeListener('ai:stream:chunk', listener)
    for (const listener of api._streamEndListeners.values()) ipcRenderer.removeListener('ai:stream:end', listener)
    api._streamChunkListeners.clear()
    api._streamEndListeners.clear()
  },
  inspectionSave: (options) => ipcRenderer.invoke('inspection:save', options),
  inspectionList: (options) => ipcRenderer.invoke('inspection:list', options),
  inspectionLinkHazard: (options) => ipcRenderer.invoke('inspection:linkHazard', options),
  inspectionMarkReview: (options) => ipcRenderer.invoke('inspection:markReview', options),
  inspectionCloseHazard: (options) => ipcRenderer.invoke('inspection:closeHazard', options),

  // 进度控制（B4）
  progressList: (projectPath) => ipcRenderer.invoke('progress:list', projectPath),
  progressAdd: (options) => ipcRenderer.invoke('progress:add', options),
  progressUpdate: (options) => ipcRenderer.invoke('progress:update', options),
  progressDelete: (options) => ipcRenderer.invoke('progress:delete', options),
  progressGantt: (options) => ipcRenderer.invoke('progress:gantt', options),
  progressMonthlyCompare: (options) => ipcRenderer.invoke('progress:monthlyCompare', options),
  progressDeviation: (projectPath) => ipcRenderer.invoke('progress:deviation', projectPath),
  parseMaterial: (options) => ipcRenderer.invoke('material:parse', options),
  importProgressMaterial: (options) => ipcRenderer.invoke('material:importProgress', options),
  previewUnifiedImport: (options) => ipcRenderer.invoke('material:previewUnifiedImport', options),
  commitUnifiedImport: (options) => ipcRenderer.invoke('material:commitUnifiedImport', options),
  undoUnifiedImport: (options) => ipcRenderer.invoke('material:undoUnifiedImport', options),
  batchGenerateDocuments: (options) => ipcRenderer.invoke('delivery:batchGenerate', options),
  createDeliveryPackage: (options) => ipcRenderer.invoke('delivery:createPackage', options),
  getPortfolioDashboard: () => ipcRenderer.invoke('dashboard:portfolio'),
  releasePreflight: () => ipcRenderer.invoke('release:preflight'),
  prepareUpdate: (options) => ipcRenderer.invoke('release:prepareUpdate', options),

  // 投资控制（B5）
  paymentList: (projectPath) => ipcRenderer.invoke('payment:list', projectPath),
  paymentAdd: (options) => ipcRenderer.invoke('payment:add', options),
  paymentAdvance: (options) => ipcRenderer.invoke('payment:advance', options),
  paymentReject: (options) => ipcRenderer.invoke('payment:reject', options),
  paymentSummary: (projectPath) => ipcRenderer.invoke('payment:summary', projectPath),

  // 合同管理（B6）
  contractList: (projectPath) => ipcRenderer.invoke('contract:list', projectPath),
  contractAdd: (options) => ipcRenderer.invoke('contract:add', options),
  contractTerminate: (options) => ipcRenderer.invoke('contract:terminate', options),
  changeList: (projectPath) => ipcRenderer.invoke('change:list', projectPath),
  changeAdd: (options) => ipcRenderer.invoke('change:add', options),
  claimList: (projectPath) => ipcRenderer.invoke('claim:list', projectPath),
  claimAdd: (options) => ipcRenderer.invoke('claim:add', options),
  contractDashboard: (projectPath) => ipcRenderer.invoke('contract:dashboard', projectPath),

  // 照片归档（B8）
  photoList: (options) => ipcRenderer.invoke('photo:list', options),
  photoMonths: (options) => ipcRenderer.invoke('photo:months', options),
  photoAdd: (options) => ipcRenderer.invoke('photo:add', options),
  photoDelete: (options) => ipcRenderer.invoke('photo:delete', options),
  photoUpdate: (options) => ipcRenderer.invoke('photo:update', options),
  photoArchive: (options) => ipcRenderer.invoke('photo:archive', options),
  photoAiArchive: (options) => ipcRenderer.invoke('photo:aiArchive', options),

  // 数据库 API
  dbListMasterData: (projectName, entityType, options) => ipcRenderer.invoke('db:listMasterData', projectName, entityType, options),
  dbSaveMasterData: (projectName, entityType, data, replacingId) => ipcRenderer.invoke('db:saveMasterData', projectName, entityType, data, replacingId),
  dbRetireMasterData: (projectName, entityType, id) => ipcRenderer.invoke('db:retireMasterData', projectName, entityType, id),
  dbSetProjectPhase: (projectName, phase, note, effectiveFrom) => ipcRenderer.invoke('db:setProjectPhase', projectName, phase, note, effectiveFrom),
  dbGetProjectPhaseHistory: (projectName) => ipcRenderer.invoke('db:getProjectPhaseHistory', projectName),
  dbListMasterChanges: (projectName, limit) => ipcRenderer.invoke('db:listMasterChanges', projectName, limit),
  dbGetCurrentMasterSnapshot: (projectName) => ipcRenderer.invoke('db:getCurrentMasterSnapshot', projectName),
  dbGetDocumentMasterSnapshot: (filePath) => ipcRenderer.invoke('db:getDocumentMasterSnapshot', filePath),
  dbCreateBusinessRelation: (relation) => ipcRenderer.invoke('db:createBusinessRelation', relation),
  dbListBusinessRelations: (projectName, entityType, entityId) => ipcRenderer.invoke('db:listBusinessRelations', projectName, entityType, entityId),
  dbDeleteBusinessRelation: (projectName, relationId) => ipcRenderer.invoke('db:deleteBusinessRelation', projectName, relationId),
  dbCountBusinessRelations: (projectName, entityType, entityId) => ipcRenderer.invoke('db:countBusinessRelations', projectName, entityType, entityId),
  dbCreateEvidenceItem: (item) => ipcRenderer.invoke('db:createEvidenceItem', item),
  dbListEvidenceItems: (projectName, options) => ipcRenderer.invoke('db:listEvidenceItems', projectName, options),
  dbUpdateEvidenceStatus: (projectName, id, status, confirmedBy) => ipcRenderer.invoke('db:updateEvidenceStatus', projectName, id, status, confirmedBy),
  dbValidateDocumentEvidence: (projectName, evidenceIds) => ipcRenderer.invoke('db:validateDocumentEvidence', projectName, evidenceIds),
  dbGetProjectMeta: (name) => ipcRenderer.invoke('db:getProjectMeta', name),
  dbUpsertProjectMeta: (meta) => ipcRenderer.invoke('db:upsertProjectMeta', meta),
  dbListProjects: () => ipcRenderer.invoke('db:listProjects'),
  dbDeleteProjectMeta: (name) => ipcRenderer.invoke('db:deleteProjectMeta', name),
  dbListCorrespondence: (name, opts) => ipcRenderer.invoke('db:listCorrespondence', name, opts),
  dbGetCorrespondence: (id) => ipcRenderer.invoke('db:getCorrespondence', id),
  dbInsertCorrespondence: (c) => ipcRenderer.invoke('db:insertCorrespondence', c),
  dbUpdateCorrespondenceStatus: (id, status, extra) => ipcRenderer.invoke('db:updateCorrespondenceStatus', id, status, extra),
  dbListHazard: (name, opts) => ipcRenderer.invoke('db:listHazard', name, opts),
  dbInsertHazard: (h) => ipcRenderer.invoke('db:insertHazard', h),
  dbUpdateHazardStatus: (id, status) => ipcRenderer.invoke('db:updateHazardStatus', id, status),
  dbLinkHazardToRectification: (hazardId, correspondenceId) => ipcRenderer.invoke('db:linkHazardToRectification', hazardId, correspondenceId),
  dbListProgressNodes: (name) => ipcRenderer.invoke('db:listProgressNodes', name),
  dbInsertProgressNode: (n) => ipcRenderer.invoke('db:insertProgressNode', n),
  dbUpdateProgressNode: (id, updates) => ipcRenderer.invoke('db:updateProgressNode', id, updates),
  dbDeleteProgressNode: (id) => ipcRenderer.invoke('db:deleteProgressNode', id),
  dbListPaymentRequests: (name) => ipcRenderer.invoke('db:listPaymentRequests', name),
  dbGetPaymentRequest: (id) => ipcRenderer.invoke('db:getPaymentRequest', id),
  dbInsertPaymentRequest: (p) => ipcRenderer.invoke('db:insertPaymentRequest', p),
  dbUpdatePaymentStage: (id, stage, history) => ipcRenderer.invoke('db:updatePaymentStage', id, stage, history),
  dbUpdatePaymentStatus: (id, status) => ipcRenderer.invoke('db:updatePaymentStatus', id, status),
  dbListContracts: (name) => ipcRenderer.invoke('db:listContracts', name),
  dbInsertContract: (c) => ipcRenderer.invoke('db:insertContract', c),
  dbListChangeOrders: (name) => ipcRenderer.invoke('db:listChangeOrders', name),
  dbInsertChangeOrder: (c) => ipcRenderer.invoke('db:insertChangeOrder', c),
  dbListClaims: (name) => ipcRenderer.invoke('db:listClaims', name),
  dbInsertClaim: (c) => ipcRenderer.invoke('db:insertClaim', c),
  dbListPhotos: (name, opts) => ipcRenderer.invoke('db:listPhotos', name, opts),
  dbInsertPhoto: (p) => ipcRenderer.invoke('db:insertPhoto', p),
  dbListSimpleLedger: (name, type) => ipcRenderer.invoke('db:listSimpleLedger', name, type),
  dbInsertSimpleLedger: (name, type, item) => ipcRenderer.invoke('db:insertSimpleLedger', name, type, item),
  dbLogAudit: (projectName, action, entityType, entityId, detail) => ipcRenderer.invoke('db:logAudit', projectName, action, entityType, entityId, detail),
  dbExport: () => ipcRenderer.invoke('db:export'),
  writeLedger: (projectPath, ledgerName, data) => ipcRenderer.invoke('fs:writeLedger', projectPath, ledgerName, data),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  openPath: (dirPath) => ipcRenderer.invoke('shell:openPath', dirPath),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  diagnoseStorage: () => ipcRenderer.invoke('settings:diagnose'),
  getTemplateCatalog: () => ipcRenderer.invoke('fs:getTemplateCatalog'),
  selectSavePath: (defaultPath) => ipcRenderer.invoke('dialog:selectSavePath', defaultPath),
  selectTemplateFile: () => ipcRenderer.invoke('dialog:selectTemplateFile'),
  getProjectDataPath: (projectPath) => ipcRenderer.invoke('fs:getProjectDataPath', projectPath),
  readProjectConfig: (projectPath) => ipcRenderer.invoke('fs:readProjectConfig', projectPath),
  writeProjectConfig: (projectPath, config) => ipcRenderer.invoke('fs:writeProjectConfig', projectPath, config),
  readProjectChatHistory: (projectPath) => ipcRenderer.invoke('fs:readProjectChatHistory', projectPath),
  writeProjectChatHistory: (projectPath, messages) => ipcRenderer.invoke('fs:writeProjectChatHistory', projectPath, messages),
  listChatSessions: (projectPath, query) => ipcRenderer.invoke('chat:listSessions', projectPath, query),
  createChatSession: (projectPath, title) => ipcRenderer.invoke('chat:createSession', projectPath, title),
  openChatSession: (projectPath, sessionId) => ipcRenderer.invoke('chat:openSession', projectPath, sessionId),
  archiveChatSession: (projectPath, sessionId, archived) => ipcRenderer.invoke('chat:archiveSession', projectPath, sessionId, archived),
  getRuleCatalog: () => ipcRenderer.invoke('fs:getRuleCatalog'),
  saveProjectDocumentRules: (projectPath, documentRules) => ipcRenderer.invoke('fs:saveProjectDocumentRules', projectPath, documentRules),
  assignProjectTemplate: (projectPath, docType, sourcePath) => ipcRenderer.invoke('fs:assignProjectTemplate', projectPath, docType, sourcePath),
  clearProjectTemplateOverride: (projectPath, docType) => ipcRenderer.invoke('fs:clearProjectTemplateOverride', projectPath, docType),
  getProjectTemplateContract: (projectPath, docType) => ipcRenderer.invoke('fs:getProjectTemplateContract', projectPath, docType),
  listTemplateLibrary: () => ipcRenderer.invoke('fs:listTemplateLibrary'),
  listSystemTemplates: () => ipcRenderer.invoke('fs:listSystemTemplates'),
  importTemplateToLibrary: (payload) => ipcRenderer.invoke('fs:importTemplateToLibrary', payload),
  cloneSystemTemplateToLibrary: (payload) => ipcRenderer.invoke('fs:cloneSystemTemplateToLibrary', payload),
  refreshTemplateLibraryEntry: (templateId) => ipcRenderer.invoke('fs:refreshTemplateLibraryEntry', templateId),
  selectProjectTemplate: (projectPath, docType, templateId) => ipcRenderer.invoke('fs:selectProjectTemplate', projectPath, docType, templateId),
  getProjectLedgers: (projectPath) => ipcRenderer.invoke('fs:getProjectLedgers', projectPath),
  deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
  renameFile: (filePath, newName) => ipcRenderer.invoke('fs:renameFile', filePath, newName),
  moveFile: (filePath, targetDir) => ipcRenderer.invoke('fs:moveFile', filePath, targetDir),
  copyPath: (path) => ipcRenderer.invoke('shell:copyPath', path),
  scanProjectCompleteness: (projectPath) => ipcRenderer.invoke('fs:scanProjectCompleteness', projectPath),
  exportCompletenessReport: (projectPath, mode) => ipcRenderer.invoke('fs:exportCompletenessReport', projectPath, mode),
  scanAllProjectsCompleteness: (rootPath) => ipcRenderer.invoke('fs:scanAllProjectsCompleteness', rootPath),
  exportPDF: (options) => ipcRenderer.invoke('fs:exportPDF', options),
  previewNumber: (docType, projectName) => ipcRenderer.invoke('numbering:preview', docType, projectName),
  getNextNumber: (docType, projectName) => ipcRenderer.invoke('numbering:next', docType, projectName),
  getNumberingRules: (projectName) => ipcRenderer.invoke('numbering:getRules', projectName),
  saveNumberingRules: (projectName, numbering) => ipcRenderer.invoke('numbering:saveRules', projectName, numbering),
  buildFileName: (opts) => ipcRenderer.invoke('filename:build', opts),
  nextDocVersion: (opts) => ipcRenderer.invoke('filename:nextVersion', opts),
  getDocCodes: () => ipcRenderer.invoke('filename:codes'),
  setProjectCode: (projectName, projectCode) => ipcRenderer.invoke('filename:setProjectCode', { projectName, projectCode }),
  dataQuery: (options) => ipcRenderer.invoke('data:query', options),
  searchQuery: (query, options) => ipcRenderer.invoke('search:query', query, options),
  // IPC invoke 参数必须可结构化克隆，不可传递回调函数
  searchRebuild: () => ipcRenderer.invoke('search:rebuild'),
  searchStatus: () => ipcRenderer.invoke('search:status'),
  readSop: (params) => ipcRenderer.invoke('sop:read', params),
  uploadCustomSop: (params) => ipcRenderer.invoke('sop:uploadCustom', params),
  removeCustomSop: (params) => ipcRenderer.invoke('sop:removeCustom', params),
  listTemplatesByProjectType: (params) => ipcRenderer.invoke('template:listByProjectType', params),
  getTemplateFields: (filePath) => ipcRenderer.invoke('template:getFields', { path: filePath }),
  deleteLibraryTemplate: (id) => ipcRenderer.invoke('template:deleteLibrary', { id }),
  updateLibraryTemplate: (payload) => ipcRenderer.invoke('template:updateLibrary', payload),
  saveTemplateContent: (payload) => ipcRenderer.invoke('template:saveContent', payload),
  listCustomProjectTypes: () => ipcRenderer.invoke('settings:listCustomProjectTypes'),
  listCustomDocTypes: () => ipcRenderer.invoke('settings:listCustomDocTypes'),
  listDocTypePromptOverrides: () => ipcRenderer.invoke('settings:listDocTypePromptOverrides'),
  // v1.x：settings 变更后主进程主动推送，自定义专业/文种注入 aiService 缓存
  onCustomTypesChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('settings:customTypesChanged', listener)
    return () => ipcRenderer.removeListener('settings:customTypesChanged', listener)
  },
  appInfo: () => ipcRenderer.invoke('app:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (downloadUrl) => ipcRenderer.invoke('update:download', downloadUrl),
}

contextBridge.exposeInMainWorld('electronAPI', api)

// v1.2.1 P0 修复：页面卸载时清理所有流式 listener 防泄漏
// 在 preload scope 执行，不走 contextBridge 暴露
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    api._removeAllStreamListeners()
  })
}

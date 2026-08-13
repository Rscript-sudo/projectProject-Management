const { contextBridge, ipcRenderer } = require('electron')

const api = {
  getRoot: () => ipcRenderer.invoke('fs:getRoot'),
  selectDir: () => ipcRenderer.invoke('dialog:selectDir'),
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  readFileContent: (filePath) => ipcRenderer.invoke('fs:readFileContent', filePath),
  getProjects: (rootPath) => ipcRenderer.invoke('fs:getProjects', rootPath),
  createProject: (rootPath, name, projectType) => ipcRenderer.invoke('fs:createProject', rootPath, name, projectType),
  getDirTree: (dirPath, maxDepth) => ipcRenderer.invoke('fs:getDirTree', dirPath, maxDepth),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  deleteProject: (projectPath) => ipcRenderer.invoke('fs:deleteProject', projectPath),
  renameProject: (oldPath, newName) => ipcRenderer.invoke('fs:renameProject', oldPath, newName),
  unbindProject: (projectPath) => ipcRenderer.invoke('fs:unbindProject', projectPath),
  saveDoc: (options) => ipcRenderer.invoke('fs:saveDoc', options),
  callAI: (options) => ipcRenderer.invoke('ai:call', options),
  listModels: (options) => ipcRenderer.invoke('ai:listModels', options),
  callAIStream: (options) => ipcRenderer.invoke('ai:stream', options),
  abortAIStream: (requestId) => ipcRenderer.send(`ai:abort:${requestId}`),
  // v1.2.1 P0 修复：流式 listener Set 去重（防 HMR 重复添加）
  // channel 名仍用全局 ai:stream:chunk（带 requestId 字段），callback 内部用 requestId 过滤
  // 旧实现：每次组件挂载 addListener 不去重 → 同一个 chunk 被 N 个 callback 处理
  _streamListeners: new Set(),
  onAIStreamChunk: (callback) => {
    const listener = (_event, data) => callback(data)
    if (api._streamListeners.has(listener)) {
      // 已注册过同一个函数引用 → 跳过（防 HMR 重复添加）
      return () => api._streamListeners.delete(listener)
    }
    api._streamListeners.add(listener)
    ipcRenderer.on('ai:stream:chunk', listener)
    return () => {
      api._streamListeners.delete(listener)
      ipcRenderer.removeListener('ai:stream:chunk', listener)
    }
  },
  onAIStreamEnd: (callback) => {
    const listener = (_event, data) => callback(data)
    if (api._streamListeners.has(listener)) {
      return () => api._streamListeners.delete(listener)
    }
    api._streamListeners.add(listener)
    ipcRenderer.on('ai:stream:end', listener)
    return () => {
      api._streamListeners.delete(listener)
      ipcRenderer.removeListener('ai:stream:end', listener)
    }
  },
  // v1.2.1 P0 修复：HMR 卸载 / 页面关闭时清空所有 stream listener
  // 防主进程 callback 引用泄漏 + 重复触发
  _removeAllStreamListeners: () => {
    for (const l of api._streamListeners) {
      ipcRenderer.removeListener('ai:stream:chunk', l)
      ipcRenderer.removeListener('ai:stream:end', l)
    }
    api._streamListeners.clear()
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
  readLedger: (projectPath, ledgerName) => ipcRenderer.invoke('fs:readLedger', projectPath, ledgerName),
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
  assignProjectTemplate: (projectPath, docType, sourcePath) => ipcRenderer.invoke('fs:assignProjectTemplate', projectPath, docType, sourcePath),
  getProjectTemplateContract: (projectPath, docType) => ipcRenderer.invoke('fs:getProjectTemplateContract', projectPath, docType),
  getProjectLedgers: (projectPath) => ipcRenderer.invoke('fs:getProjectLedgers', projectPath),
  deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
  renameFile: (filePath, newName) => ipcRenderer.invoke('fs:renameFile', filePath, newName),
  moveFile: (filePath, targetDir) => ipcRenderer.invoke('fs:moveFile', filePath, targetDir),
  copyPath: (path) => ipcRenderer.invoke('shell:copyPath', path),
  scanProjectCompleteness: (projectPath) => ipcRenderer.invoke('fs:scanProjectCompleteness', projectPath),
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
  searchRebuild: (progressCallback) => ipcRenderer.invoke('search:rebuild', progressCallback),
  searchStatus: () => ipcRenderer.invoke('search:status'),
  readSop: (params) => ipcRenderer.invoke('sop:read', params),
}

contextBridge.exposeInMainWorld('electronAPI', api)

// v1.2.1 P0 修复：页面卸载时清理所有流式 listener 防泄漏
// 在 preload scope 执行，不走 contextBridge 暴露
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    api._removeAllStreamListeners()
  })
}

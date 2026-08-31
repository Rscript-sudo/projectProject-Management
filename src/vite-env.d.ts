/// <reference types="vite/client" />

export interface DirNode {
  name: string
  path: string
  type: 'folder' | 'file'
  ext?: string
  children?: DirNode[]
}

interface SaveDocOptions {
  projectPath: string
  subDir?: string               // 虚竹 v2.0：可选，由 IPC 端按 docType 算
  fileName?: string             // 虚竹 v2.0：可选，由 IPC 端按 buildFileName 生成
  content: string
  docType: string
  projectName: string
  userInput: string
  savePath?: string
  customSummary?: string        // 虚竹 v2.0：摘要内容（事由等）
  version?: string              // 虚竹 v2.0：修订版本，如 'V2'/'V3'
  meta?: any                    // 台账登记用业务字段
  preview?: boolean             // 临时预览件：不占文号、不写正式台账
  evidenceIds?: number[]        // AI 事实证据 ID；正式件对关键证据执行状态门禁
}

export interface EvidenceItem {
  id: number
  project_name: string
  title: string
  evidence_type: string
  source_ref?: string
  source_location?: string
  excerpt?: string
  status: 'confirmed' | 'pending' | 'invalid'
  critical: number
  confirmed_by?: string
  confirmed_at?: string
}

export interface UpdateCheckResult {
  success: boolean
  currentVersion: string
  latestVersion?: string
  hasUpdate?: boolean
  releaseName?: string
  releaseUrl?: string
  downloadUrl?: string | null
  assetName?: string | null
  error?: string
}

export interface BuildFileNameResult {
  fileName: string
  subDir: string
  code: string
  projectCode: string
  summary: string
  date: string
  version?: string
  ext: string
}

interface AIOptions {
  requestId?: string
  operationId?: string
  url?: string
  baseUrl?: string
  // apiKey 已移至主进程加密存储，前端不再传入；保留字段兼容旧代码（被忽略）
  apiKey?: string
  model: string
  messages: { role: string; content: string }[]
  provider?: string
  // v1.2.1 扩展：DOC/DATA_QUERY/HYBRID/CHAT 路由标记，主进程按 mode 走不同处理
  mode?: string
  projectName?: string
  dataToolIds?: string[]
  reportPeriod?: { start: string; end: string }
}

interface AIResult {
  success: boolean
  content?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
}

interface FileInfo {
  name: string
  size: number
  modified: string
  isBinary: boolean
}

interface LedgerData {
  items: {
    fileName: string
    subDir?: string
    createdAt: string
  }[]
}

export interface TemplateItem {
  name: string
  path: string
  type: 'category' | 'item'
  displayName?: string
  children?: TemplateItem[]
  ext?: string
  docxCount?: number
}

export type CompletenessStatus = 'complete' | 'partial' | 'missing'

export interface DocTypeStatus {
  docType: string
  phase: string
  phaseName: string
  directory: string
  status: CompletenessStatus
  fileCount: number
  lastModified: string | null
}

export interface PhaseGroup {
  phase: string
  phaseName: string
  items: DocTypeStatus[]
  completeCount: number
  totalCount: number
}

export interface ScanCompletenessResult {
  projectPath: string
  projectName: string
  phases: PhaseGroup[]
  totalFiles: number
  totalTypes: number
  completeTypes: number
  issues?: CompletenessIssue[]
  issueSummary?: { error: number; warning: number; total: number; byCategory: Record<string, number> }
}

export interface CompletenessIssue {
  code: string
  category: string
  severity: 'error' | 'warning'
  scope: string
  message: string
  entityType: string
  entityId: string
  detail?: Record<string, any>
}

export interface ProjectDashboard {
  projectPath: string
  projectName: string
  phases: PhaseGroup[]
  totalFiles: number
  totalTypes: number
  completeTypes: number
  lastActivity: string | null
  issues?: CompletenessIssue[]
  issueSummary?: { error: number; warning: number; total: number; byCategory: Record<string, number> }
}

export interface AllProjectsDashboard {
  projects: ProjectDashboard[]
  totalProjects: number
  overallHealth: number
}

export interface LedgerEntry {
  fileName: string
  subDir?: string
  createdAt: string
}

export interface LedgerInfo {
  label: string
  file: string
  items: LedgerEntry[]
}

export type AllLedgersData = Record<string, LedgerInfo>

interface AppSettings {
  projectRoot: string
  aiProvider: 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'qwen' | 'custom'
  // apiKey 已移至主进程加密存储，前端拿到的是脱敏版本（含 hasApiKey 字段）
  apiKey?: string
  hasApiKey?: boolean
  baseUrl: string
  model: string
  autoOpenFile: boolean
  aiProfiles?: Partial<Record<AppSettings['aiProvider'], { baseUrl: string; model: string; hasApiKey?: boolean; apiKeyDecryptError?: string | null }>>
  // v1.x：自定义专业/文种 + 扩写规则覆盖（运行时 JSON，主进程持久化）
  customProjectTypes?: any[]
  customDocTypes?: any[]
  docTypePromptOverrides?: Record<string, any> | null
  globalRulesOverrides?: Record<string, any> | null
  hiddenSystemTemplateIds?: string[]
  hiddenCommonDocTypes?: string[]
  hiddenProfessionalTemplateTypes?: string[]
}

export interface ElectronAPI {
  getRoot: () => Promise<string>
  selectDir: () => Promise<string | null>
  selectFiles: () => Promise<string[] | null>
  selectTemplateFiles: () => Promise<string[] | null>
  getPathForFile: (file: File) => string
  readFileContent: (filePath: string) => Promise<{
    success: boolean
    fileName?: string
    ext?: string
    type?: 'text' | 'image' | 'binary'
    content?: string
    html?: string
    size?: number
    truncated?: boolean
    note?: string
    error?: string
  }>
  getProjects: (rootPath: string) => Promise<{ name: string; path: string }[]>
  createProject: (rootPath: string, name: string, projectType?: string, projectProfile?: { projectTypeCode?: string; projectTags?: string[]; projectFeatures?: string; projectPhase?: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  getDirTree: (dirPath: string, maxDepth?: number) => Promise<DirNode>
  readFile: (filePath: string) => Promise<string | FileInfo | null>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  deleteProject: (projectPath: string) => Promise<{ success: boolean; error?: string }>
  renameProject: (oldPath: string, newName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  unbindProject: (projectPath: string) => Promise<{ success: boolean; removed?: boolean; error?: string }>
  saveDoc: (options: SaveDocOptions) => Promise<{
    success: boolean
    path?: string
    fileName?: string
    subDir?: string
    filenameMeta?: BuildFileNameResult
    error?: string
  }>
  callAI: (options: AIOptions) => Promise<AIResult>
  recognizeImages: (options: { paths: string[] }) => Promise<{ success: boolean; content?: string; model?: string; error?: string }>
  listModels: (options: { baseUrl: string; apiKey?: string; provider?: string }) => Promise<{ success: boolean; models?: string[]; error?: string }>
  checkAIHealth: (options?: { provider?: string; baseUrl?: string; model?: string }) => Promise<{ success: boolean; provider?: string; baseUrl?: string; model?: string; models?: string[]; error?: string }>
  readClipboardText: () => Promise<{ success: boolean; text?: string; error?: string }>
  callAIStream: (options: AIOptions) => Promise<{ success: boolean; error?: string; requestId?: string }>
  abortAIStream: (requestId: string) => void
  onAIStreamChunk: (callback: (data: { requestId: string; type: 'content' | 'error'; content?: string; error?: string }) => void) => () => void
  onAIStreamEnd: (callback: (data: { requestId: string }) => void) => () => void
  // v1.2.1 项目类型 SOP 加载（来源：src/shared/sop/{projectType}/safety-notice.json）
  readSop: (params: { projectType: string; docType?: string }) => Promise<{
    found: boolean
    projectType: string
    projectTypeCode?: string
    sopFile: string
    sections: Array<{ title: string; mustInclude: string[]; forbiddenTerms: string[] }>
    globalForbiddenTerms: string[]
    minWords: number
    error?: string
  }>
  inspectionSave: (options: { projectPath: string; record: any }) => Promise<{ success: boolean; inspectionId?: string; recordPath?: string; hazardIds?: number[]; hazardCount?: number; error?: string }>
  inspectionList: (options: { projectPath: string }) => Promise<any[]>
  inspectionLinkHazard: (options: { hazardId: number; correspondenceId: number }) => Promise<{ success: boolean }>
  inspectionMarkReview: (options: { hazardId: number; reviewDate?: string }) => Promise<{ success: boolean }>
  inspectionCloseHazard: (options: { hazardId: number }) => Promise<{ success: boolean }>

  // 进度控制（B4）
  progressList: (projectPath: string) => Promise<any[]>
  progressAdd: (options: { projectPath: string; node: any }) => Promise<{ success: boolean; id: number }>
  progressUpdate: (options: { id: number; updates: any }) => Promise<{ success: boolean }>
  progressDelete: (options: { id: number }) => Promise<{ success: boolean }>
  progressGantt: (options: { projectPath: string; yearMonth?: string }) => Promise<any>
  progressMonthlyCompare: (options: { projectPath: string; yearMonth: string }) => Promise<any>
  progressDeviation: (projectPath: string) => Promise<any>
  parseMaterial: (options: { filePath: string }) => Promise<{ success: boolean; fileName?: string; ext?: string; type?: string; text?: string; note?: string; truncated?: boolean; progressCandidates?: any[]; error?: string }>
  importProgressMaterial: (options: { projectPath: string; nodes: any[]; sourceFile?: string }) => Promise<{ success: boolean; count?: number; ids?: number[]; batchId?: number; duplicate?: boolean; error?: string }>
  previewUnifiedImport: (options: { entityType: 'progress' | 'contract' | 'hazard' | 'payment' | 'photo'; records: Record<string, any>[]; fieldMapping: Record<string, string> }) => Promise<{ success: boolean; rows: any[]; errors: any[]; error?: string }>
  commitUnifiedImport: (options: { projectPath: string; entityType: 'progress' | 'contract' | 'hazard' | 'payment' | 'photo'; records: Record<string, any>[]; fieldMapping: Record<string, string>; sourceFile?: string }) => Promise<{ success: boolean; batchId?: number; importedCount?: number; reportPath?: string; duplicate?: boolean; validationErrors?: any[]; error?: string }>
  undoUnifiedImport: (options: { projectName: string; batchId: number }) => Promise<{ success: boolean; removedCount?: number; error?: string }>
  batchGenerateDocuments: (options: { projectPath: string; mode: 'daily' | 'weekly' | 'monthly' | 'payment_certificate'; dates?: string[]; period?: { start: string; end: string } }) => Promise<{ success: boolean; paths?: string[]; count?: number; sourceCount?: number; error?: string }>
  createDeliveryPackage: (options: { projectPath: string; allowIncomplete?: boolean }) => Promise<{ success: boolean; blocked?: boolean; packageDir?: string; fileCount?: number; issueCount?: number; issues?: CompletenessIssue[]; error?: string }>
  getPortfolioDashboard: () => Promise<{ projects: any[]; rankings: any[]; todos: any[]; calendar: any[] }>
  releasePreflight: () => Promise<{ success: boolean; version: string; platform: string; arch: string; packaged: boolean; signed: boolean | null; databaseIntegrity: string }>
  prepareUpdate: (options: { packagePath: string; expectedSha256?: string; changelog?: string; minimumVersion?: string }) => Promise<{ success: boolean; recoveryDir?: string; stagedPackage?: string; sha256?: string; changelogPath?: string; error?: string }>

  // 投资控制（B5）
  paymentList: (projectPath: string) => Promise<any[]>
  paymentAdd: (options: { projectPath: string; payment: any }) => Promise<{ success: boolean; id: number; cumulative_amount: number; cumulative_percent: number; error?: string }>
  paymentAdvance: (options: { id: number; person?: string; opinion?: string }) => Promise<{ success: boolean; nextStage?: string; error?: string }>
  paymentReject: (options: { id: number; person?: string; opinion?: string }) => Promise<{ success: boolean; error?: string }>
  paymentSummary: (projectPath: string) => Promise<any>

  // 合同管理（B6）
  contractList: (projectPath: string) => Promise<any[]>
  contractAdd: (options: { projectPath: string; contract: any }) => Promise<{ success: boolean; id: number; error?: string }>
  contractTerminate: (options: { id: number }) => Promise<{ success: boolean; error?: string }>
  changeList: (projectPath: string) => Promise<any[]>
  changeAdd: (options: { projectPath: string; change: any }) => Promise<{ success: boolean; id: number; error?: string }>
  claimList: (projectPath: string) => Promise<any[]>
  claimAdd: (options: { projectPath: string; claim: any }) => Promise<{ success: boolean; id: number; error?: string }>
  contractDashboard: (projectPath: string) => Promise<any>

  // 照片归档（B8）
  photoList: (options: { projectPath: string; yearMonth?: string; location?: string; limit?: number }) => Promise<any[]>
  photoMonths: (options: { projectPath: string }) => Promise<{ month: string; count: number }[]>
  photoAdd: (options: { projectPath: string; photo: any }) => Promise<{ success: boolean; id: number }>
  photoDelete: (options: { id: number }) => Promise<{ success: boolean; error?: string }>
  photoUpdate: (options: { id: number; updates: any }) => Promise<{ success: boolean; error?: string }>
  photoArchive: (options: { projectPath: string; srcPath: string; shootDate?: string; location?: string; tags?: string; description?: string }) => Promise<{ success: boolean; id?: number; destPath?: string; error?: string }>
  photoAiArchive: (options: { projectPath: string; scanDir: string; aiConfig?: { apiKey?: string; baseUrl?: string; model?: string } }) => Promise<{ success: boolean; total?: number; archived?: number; months?: string[]; summary?: string; recognitionMode?: string; error?: string }>
  readLedger: (projectPath: string, ledgerName: string) => Promise<LedgerData>
  writeLedger: (projectPath: string, ledgerName: string, data: LedgerData) => Promise<{ success: boolean }>
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  openTemplatePreview: (filePath: string, displayName?: string) => Promise<{ success: boolean; path?: string; error?: string }>
  readFileContent: (filePath: string) => Promise<{ success: boolean; fileName?: string; content?: string; html?: string; error?: string }>
  openPath: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<{ success: boolean; error?: string }>
  getTemplateCatalog: () => Promise<TemplateItem[]>
  selectSavePath: (defaultPath: string) => Promise<string | null>
  selectTemplateFile: () => Promise<string | null>
  getProjectDataPath: (projectPath: string) => Promise<string>
  readProjectConfig: (projectPath: string) => Promise<{ contractor: string; ownerUnit: string; supervisorUnit: string; chiefEngineer: string; projectType: string; projectTypeCode?: string; projectTags?: string[]; projectFeatures?: string; projectPhase?: string; implementationArea?: string; projectCode?: string; documentRules?: { rulePackIds?: string[]; additionalInstruction?: string }; templateOverrides?: Record<string, { path: string; sourceName?: string; updatedAt?: string }>; templateSelections?: Record<string, string | null> }>
  writeProjectConfig: (projectPath: string, config: object) => Promise<{ success: boolean; error?: string }>
  readProjectChatHistory: (projectPath: string) => Promise<{ success: boolean; sessionId?: string; messages?: Array<Record<string, any>>; error?: string }>
  writeProjectChatHistory: (projectPath: string, messages: Array<Record<string, any>>) => Promise<{ success: boolean; count?: number; error?: string }>
  listChatSessions: (projectPath: string, query?: string) => Promise<{ success: boolean; activeSessionId?: string; sessions?: Array<{ id: string; title: string; archived: boolean; messageCount: number; preview: string; updatedAt: string }>; error?: string }>
  createChatSession: (projectPath: string, title?: string) => Promise<{ success: boolean; session?: any; error?: string }>
  openChatSession: (projectPath: string, sessionId: string) => Promise<{ success: boolean; session?: any; error?: string }>
  archiveChatSession: (projectPath: string, sessionId: string, archived?: boolean) => Promise<{ success: boolean; error?: string }>
  getRuleCatalog: () => Promise<{ packs: Array<{ id: string; group: string; label: string; description: string; default?: boolean; docTypes?: string[] }>; defaults: string[] }>
  saveProjectDocumentRules: (projectPath: string, documentRules: { rulePackIds?: string[]; additionalInstruction?: string }) => Promise<{ success: boolean; documentRules?: { rulePackIds: string[]; additionalInstruction: string }; error?: string }>
  assignProjectTemplate: (projectPath: string, docType: string, sourcePath: string) => Promise<{ success: boolean; path?: string; templateOverride?: { path: string; sourceName?: string; updatedAt?: string }; error?: string }>
  clearProjectTemplateOverride: (projectPath: string, docType: string) => Promise<{ success: boolean; error?: string }>
  getProjectTemplateContract: (projectPath: string, docType: string) => Promise<{ found: boolean; fields: string[]; source?: string; path?: string; templateId?: string; error?: string }>
  listTemplateLibrary: () => Promise<Array<{ id: string; name: string; docType: string; scope: 'global' | 'professional' | 'other' | 'personal'; projectType: string; projectTypeLabel?: string; path: string; sourceName: string; fields?: string[]; aiRuleConfiguredAt?: string; createdAt: string; updatedAt: string }>>
  listSystemTemplates: () => Promise<Array<{ id: string; name: string; docType: string; scope: 'system'; projectType: string; path: string; sourceName: string; fields?: string[]; readOnly: true }>>
  importTemplateToLibrary: (payload: { sourcePath: string; docType: string; scope: 'global' | 'professional' | 'other' | 'personal'; projectType?: string; name?: string }) => Promise<{ success: boolean; template?: any; error?: string }>
  cloneSystemTemplateToLibrary: (payload: { docType: string; scope?: 'global' | 'professional' | 'personal'; projectType?: string; name?: string }) => Promise<{ success: boolean; template?: any; error?: string }>
  refreshTemplateLibraryEntry: (templateId: string) => Promise<{ success: boolean; template?: any; error?: string }>
  selectProjectTemplate: (projectPath: string, docType: string, templateId: string | null) => Promise<{ success: boolean; templateId?: string | null; error?: string }>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  renameFile: (filePath: string, newName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  moveFile: (filePath: string, targetDir: string) => Promise<{ success: boolean; path?: string; error?: string }>
  copyPath: (path: string) => Promise<{ success: boolean; error?: string }>
  scanProjectCompleteness: (projectPath: string) => Promise<ScanCompletenessResult>
  exportCompletenessReport: (projectPath: string, mode: 'project' | 'delivery' | 'monthly') => Promise<{ success: boolean; path?: string; count?: number; error?: string }>

  // 数据库 API（B1）
  dbListMasterData: (projectName: string, entityType: 'participant' | 'member' | 'structure', options?: { includeHistory?: boolean }) => Promise<any[]>
  dbSaveMasterData: (projectName: string, entityType: 'participant' | 'member' | 'structure', data: Record<string, any>, replacingId?: number | null) => Promise<{ success: boolean; item?: any; error?: string }>
  dbRetireMasterData: (projectName: string, entityType: 'participant' | 'member' | 'structure', id: number) => Promise<{ success: boolean; retired?: boolean; error?: string }>
  dbSetProjectPhase: (projectName: string, phase: string, note?: string, effectiveFrom?: string) => Promise<{ success: boolean; phase?: any; error?: string }>
  dbGetProjectPhaseHistory: (projectName: string) => Promise<any[]>
  dbListMasterChanges: (projectName: string, limit?: number) => Promise<any[]>
  dbGetCurrentMasterSnapshot: (projectName: string) => Promise<any>
  dbGetDocumentMasterSnapshot: (filePath: string) => Promise<any>
  dbCreateBusinessRelation: (relation: { project_name: string; source_type: string; source_id: string | number; target_type: string; target_id: string | number; relation_type: string; metadata?: Record<string, any> }) => Promise<{ success: boolean; relation?: any; error?: string }>
  dbListBusinessRelations: (projectName: string, entityType: string, entityId: string | number) => Promise<any[]>
  dbDeleteBusinessRelation: (projectName: string, relationId: number) => Promise<{ success: boolean; deleted?: boolean; error?: string }>
  dbCountBusinessRelations: (projectName: string, entityType: string, entityId: string | number) => Promise<{ success: boolean; count?: number; error?: string }>
  dbCreateEvidenceItem: (item: Partial<EvidenceItem> & { project_name: string; title: string }) => Promise<{ success: boolean; item?: EvidenceItem; error?: string }>
  dbListEvidenceItems: (projectName: string, options?: { status?: EvidenceItem['status'] }) => Promise<EvidenceItem[]>
  dbUpdateEvidenceStatus: (projectName: string, id: number, status: EvidenceItem['status'], confirmedBy?: string) => Promise<{ success: boolean; updated?: boolean; error?: string }>
  dbValidateDocumentEvidence: (projectName: string, evidenceIds: number[]) => Promise<{ valid: boolean; items: EvidenceItem[]; blockers: Array<{ id: number; reason: string }> }>
  dbGetProjectMeta: (name: string) => Promise<any>
  dbUpsertProjectMeta: (meta: any) => Promise<{ success: boolean }>
  dbListProjects: () => Promise<any[]>
  dbDeleteProjectMeta: (name: string) => Promise<{ success: boolean }>
  dbListCorrespondence: (name: string, opts?: any) => Promise<any[]>
  dbGetCorrespondence: (id: number) => Promise<any>
  dbInsertCorrespondence: (c: any) => Promise<{ success: boolean; id: number }>
  dbUpdateCorrespondenceStatus: (id: number, status: string, extra?: any) => Promise<{ success: boolean }>
  dbListHazard: (name: string, opts?: any) => Promise<any[]>
  dbInsertHazard: (h: any) => Promise<{ success: boolean; id: number }>
  dbUpdateHazardStatus: (id: number, status: string) => Promise<{ success: boolean }>
  dbLinkHazardToRectification: (hazardId: number, correspondenceId: number) => Promise<{ success: boolean }>
  dbListProgressNodes: (name: string) => Promise<any[]>
  dbInsertProgressNode: (n: any) => Promise<{ success: boolean; id: number }>
  dbUpdateProgressNode: (id: number, updates: any) => Promise<{ success: boolean }>
  dbDeleteProgressNode: (id: number) => Promise<{ success: boolean }>
  dbListPaymentRequests: (name: string) => Promise<any[]>
  dbGetPaymentRequest: (id: number) => Promise<any>
  dbInsertPaymentRequest: (p: any) => Promise<{ success: boolean; id: number }>
  dbUpdatePaymentStage: (id: number, stage: string, history: any[]) => Promise<{ success: boolean }>
  dbUpdatePaymentStatus: (id: number, status: string) => Promise<{ success: boolean }>
  dbListContracts: (name: string) => Promise<any[]>
  dbInsertContract: (c: any) => Promise<{ success: boolean; id: number }>
  dbListChangeOrders: (name: string) => Promise<any[]>
  dbInsertChangeOrder: (c: any) => Promise<{ success: boolean; id: number }>
  dbListClaims: (name: string) => Promise<any[]>
  dbInsertClaim: (c: any) => Promise<{ success: boolean; id: number }>
  dbListPhotos: (name: string, opts?: any) => Promise<any[]>
  dbInsertPhoto: (p: any) => Promise<{ success: boolean; id: number }>
  dbListSimpleLedger: (name: string, type: string) => Promise<any[]>
  dbInsertSimpleLedger: (name: string, type: string, item: any) => Promise<{ success: boolean; id: number }>
  dbLogAudit: (projectName: string, action: string, entityType: string, entityId: number, detail: any) => Promise<{ success: boolean }>
  getProjectLedgers: (projectPath: string) => Promise<AllLedgersData>
  scanAllProjectsCompleteness: (rootPath: string) => Promise<AllProjectsDashboard>
  exportPDF: (options: {
    projectPath: string
    subDir?: string
    fileName?: string
    content: string
    docType: string
    projectName: string
    userInput: string
    customSummary?: string
  }) => Promise<{ success: boolean; path?: string; fileName?: string; subDir?: string; error?: string }>
  previewNumber: (docType: string, projectName: string) => Promise<{ number: string }>
  buildFileName: (opts: {
    docType: string
    projectName: string
    customSummary?: string
    version?: string
    dateMs?: number
  }) => Promise<BuildFileNameResult>
  nextDocVersion: (opts: {
    projectPath: string
    docType: string
    summary: string
  }) => Promise<string>
  getDocCodes: () => Promise<Record<string, string>>
  setProjectCode: (projectName: string, projectCode: string) => Promise<{ success: boolean; projectCode: string }>
  diagnoseStorage: () => Promise<{
    available: boolean
    backend: string
    encryptTest: string
    decryptTest: string
    keychainService?: string
    appName?: string
    error?: string
    note?: string
  }>
  getNextNumber: (docType: string, projectName: string) => Promise<{ number: string }>
  getNumberingRules: (projectName: string) => Promise<Record<string, any>>
  saveNumberingRules: (projectName: string, numbering: Record<string, any>) => Promise<{ success: boolean }>
  searchQuery: (query: string, options?: { limit?: number }) => Promise<any[]>
  searchRebuild: () => Promise<{ success: boolean; docCount: number }>
  listCustomProjectTypes: () => Promise<any[]>
  listCustomDocTypes: () => Promise<any[]>
  listDocTypePromptOverrides: () => Promise<{ docTypes: any | null; globalRules: any | null }>
  uploadCustomSop: (params: { code: string; sopData: unknown }) => Promise<{ ok: boolean; error?: string }>
  removeCustomSop: (params: { code: string }) => Promise<{ ok: boolean; error?: string }>
  getTemplateFields: (filePath: string) => Promise<{ ok: boolean; fields?: string[]; error?: string }>
  deleteLibraryTemplate: (id: string) => Promise<{ ok: boolean; error?: string }>
  deleteProfessionalTemplateCategory: (projectType: string, projectTypeCode: string) => Promise<{ ok: boolean; removedTemplates?: number; customProjectTypes?: any[]; hiddenProfessionalTemplateTypes?: string[]; error?: string }>
  getTemplateWorkspaceInfo: () => Promise<{ root: string; categories: Record<string, string> }>
  createProfessionalTemplateCategory: (projectType: string) => Promise<{ ok: boolean; directory?: string; error?: string }>
  listTemplateCategories: (scope?: 'professional' | 'personal' | 'other') => Promise<{ success: boolean; categories?: Array<{ name: string; path: string }>; error?: string }>
  createTemplateCategory: (scope: 'personal' | 'other', name: string) => Promise<{ ok: boolean; name?: string; directory?: string; error?: string }>
  deleteTemplateCategory: (scope: 'personal' | 'other', name: string) => Promise<{ ok: boolean; removedTemplates?: number; trashed?: boolean; error?: string }>
  updateLibraryTemplate: (payload: { id: string; name?: string; sourcePath?: string }) => Promise<{ ok: boolean; template?: any; error?: string }>
  markTemplateRuleConfigured: (id: string) => Promise<{ ok: boolean; template?: any; error?: string }>
  getTemplateLayoutContract: (filePath: string, docType: string) => Promise<any>
  saveTemplateLayoutContract: (filePath: string, docType: string, fields: Record<string, any>) => Promise<any>
  resetTemplateLayoutContract: (filePath: string, docType: string) => Promise<any>
  saveTemplateContent: (payload: { path: string; addFields?: string[]; removeFields?: string[]; renameMap?: Record<string, string>; placements?: Array<{ field: string; anchor?: string; position?: 'before' | 'after'; tableIndex?: number; rowIndex?: number; cellIndex?: number }>; docType?: string; templateId?: string; saveAsPersonal?: boolean; name?: string }) => Promise<{ ok: boolean; path?: string; fields?: string[]; clonedToLibrary?: any; error?: string }>
  listSystemTemplates: () => Promise<any[]>
  listTemplatesByProjectType: (params: { projectType?: string; docType?: string; scope?: string }) => Promise<any[]>
  onCustomTypesChanged: (cb: (data: any) => void) => () => void
  searchStatus: () => Promise<{ docCount: number; lastUpdated: string | null }>
  dataQuery: (options: { projectName: string; toolIds: string[]; reportPeriod?: { start: string; end: string } }) => Promise<Record<string, any>>
  dbExport: () => Promise<{ success: boolean; path?: string; size?: number; exportedAt?: string; error?: string }>
  appInfo: () => Promise<{ name: string; version: string; repository: string }>
  checkForUpdates: () => Promise<UpdateCheckResult>
  downloadUpdate: (downloadUrl: string) => Promise<{ success: boolean; error?: string }>
  getModelCapabilities: (model: string) => Promise<{ success: boolean; capabilities?: { model: string; text: boolean; vision: boolean; streaming: boolean; structuredOutput: boolean; maxImages: number }; error?: string }>
  routeModel: (candidates: string[], requirements: { vision?: boolean; structuredOutput?: boolean; streaming?: boolean }) => Promise<{ success: boolean; route?: { selected: { model: string } | null; reason: string }; error?: string }>
  createOperation: (input: { type: string; title: string; projectPath?: string; metadata?: Record<string, any> }) => Promise<{ success: boolean; task?: any; error?: string }>
  updateOperation: (id: string, patch: Record<string, any>) => Promise<{ success: boolean; task?: any; error?: string }>
  cancelOperation: (id: string) => Promise<{ success: boolean; task?: any; error?: string }>
  retryOperation: (id: string) => Promise<{ success: boolean; task?: any; error?: string }>
  appendDiagnostic: (input: { taskId?: string; level?: 'info' | 'warn' | 'error'; stage?: string; message: string; detail?: any }) => Promise<{ success: boolean; event?: any; error?: string }>
  listOperations: (filters?: { projectPath?: string; status?: string; taskId?: string; limit?: number }) => Promise<{ success: boolean; tasks?: any[]; events?: any[]; error?: string }>
  clearFinishedOperations: () => Promise<{ success: boolean; error?: string }>
  scoreDocumentQuality: (docType: string, content: string) => Promise<{ success: boolean; quality?: { score: number; passed: boolean; checks: any[] }; error?: string }>
  auditDocumentVisual: (filePath: string) => Promise<{ success: boolean; audit?: { valid: boolean; issues: string[]; width: number; height: number; inkRatio: number; renderer: string }; error?: string }>
  auditTemplate: (filePath: string) => Promise<{ success: boolean; fields?: string[]; issues?: any[]; error?: string }>
  createProjectBackup: (projectPath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  listProjectBackups: (projectPath: string) => Promise<{ success: boolean; backups?: Array<{ name: string; path: string; createdAt: string }>; error?: string }>
  restoreProjectBackup: (projectPath: string, backupPath: string) => Promise<{ success: boolean; restoredFrom?: string; safetyBackup?: string; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}

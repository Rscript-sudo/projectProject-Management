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
  url?: string
  baseUrl?: string
  // apiKey 已移至主进程加密存储，前端不再传入；保留字段兼容旧代码（被忽略）
  apiKey?: string
  model: string
  messages: { role: string; content: string }[]
  provider?: string
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
}

export interface ProjectDashboard {
  projectPath: string
  projectName: string
  phases: PhaseGroup[]
  totalFiles: number
  totalTypes: number
  completeTypes: number
  lastActivity: string | null
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
}

export interface ElectronAPI {
  getRoot: () => Promise<string>
  selectDir: () => Promise<string | null>
  selectFiles: () => Promise<string[] | null>
  readFileContent: (filePath: string) => Promise<{
    success: boolean
    fileName?: string
    ext?: string
    type?: 'text' | 'image' | 'binary'
    content?: string
    size?: number
    truncated?: boolean
    note?: string
    error?: string
  }>
  getProjects: (rootPath: string) => Promise<{ name: string; path: string }[]>
  createProject: (rootPath: string, name: string, projectType?: string) => Promise<{ success: boolean; path?: string; error?: string }>
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
  callAIStream: (options: AIOptions) => Promise<{ success: boolean; error?: string; requestId?: string }>
  abortAIStream: (requestId: string) => void
  onAIStreamChunk: (callback: (data: { requestId: string; type: 'content' | 'error'; content?: string; error?: string }) => void) => () => void
  onAIStreamEnd: (callback: (data: { requestId: string }) => void) => () => void
  inspectionSave: (options: { projectPath: string; record: any }) => Promise<{ success: boolean; recordPath?: string; hazardIds?: number[]; hazardCount?: number; error?: string }>
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

  // 投资控制（B5）
  paymentList: (projectPath: string) => Promise<any[]>
  paymentAdd: (options: { projectPath: string; payment: any }) => Promise<{ success: boolean; id: number; cumulative_amount: number; cumulative_percent: number }>
  paymentAdvance: (options: { id: number; person?: string; opinion?: string }) => Promise<{ success: boolean; nextStage?: string; error?: string }>
  paymentReject: (options: { id: number; person?: string; opinion?: string }) => Promise<{ success: boolean; error?: string }>
  paymentSummary: (projectPath: string) => Promise<any>

  // 合同管理（B6）
  contractList: (projectPath: string) => Promise<any[]>
  contractAdd: (options: { projectPath: string; contract: any }) => Promise<{ success: boolean; id: number }>
  contractTerminate: (options: { id: number }) => Promise<{ success: boolean }>
  changeList: (projectPath: string) => Promise<any[]>
  changeAdd: (options: { projectPath: string; change: any }) => Promise<{ success: boolean; id: number }>
  claimList: (projectPath: string) => Promise<any[]>
  claimAdd: (options: { projectPath: string; claim: any }) => Promise<{ success: boolean; id: number }>
  contractDashboard: (projectPath: string) => Promise<any>

  // 照片归档（B8）
  photoList: (options: { projectPath: string; yearMonth?: string; location?: string; limit?: number }) => Promise<any[]>
  photoMonths: (options: { projectPath: string }) => Promise<{ month: string; count: number }[]>
  photoAdd: (options: { projectPath: string; photo: any }) => Promise<{ success: boolean; id: number }>
  photoDelete: (options: { id: number }) => Promise<{ success: boolean }>
  photoUpdate: (options: { id: number; updates: any }) => Promise<{ success: boolean; error?: string }>
  photoArchive: (options: { projectPath: string; srcPath: string; shootDate?: string; location?: string; tags?: string; description?: string }) => Promise<{ success: boolean; id?: number; destPath?: string; error?: string }>
  photoAiArchive: (options: { projectPath: string; scanDir: string; aiConfig?: { apiKey?: string; baseUrl?: string; model?: string } }) => Promise<{ success: boolean; total?: number; archived?: number; months?: string[]; summary?: string; error?: string }>
  readLedger: (projectPath: string, ledgerName: string) => Promise<LedgerData>
  writeLedger: (projectPath: string, ledgerName: string, data: LedgerData) => Promise<{ success: boolean }>
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  openPath: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<{ success: boolean; error?: string }>
  getTemplateCatalog: () => Promise<TemplateItem[]>
  selectSavePath: (defaultPath: string) => Promise<string | null>
  getProjectDataPath: (projectPath: string) => Promise<string>
  readProjectConfig: (projectPath: string) => Promise<{ contractor: string; ownerUnit: string; supervisorUnit: string; chiefEngineer: string; projectType: string; projectCode?: string }>
  writeProjectConfig: (projectPath: string, config: object) => Promise<{ success: boolean; error?: string }>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  renameFile: (filePath: string, newName: string) => Promise<{ success: boolean; path?: string; error?: string }>
  moveFile: (filePath: string, targetDir: string) => Promise<{ success: boolean; path?: string; error?: string }>
  copyPath: (path: string) => Promise<{ success: boolean; error?: string }>
  scanProjectCompleteness: (projectPath: string) => Promise<ScanCompletenessResult>

  // 数据库 API（B1）
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
  searchRebuild: (progressCallback?: (current: number, total: number, name: string) => void) => Promise<{ success: boolean; docCount: number }>
  searchStatus: () => Promise<{ docCount: number; lastUpdated: string | null }>
  dataQuery: (options: { projectName: string; toolIds: string[] }) => Promise<Record<string, any>>
  dbExport: () => Promise<{ success: boolean; path?: string; size?: number; exportedAt?: string; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
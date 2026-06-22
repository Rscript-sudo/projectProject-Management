/**
 * 全局共享类型定义
 *
 * 命名约定：领域 + 用途
 *   - ProgressNode / ProgressNodeForm / GanttData / DeviationData / MonthlyCompare
 *   - Contract / ChangeOrder / Claim / ContractDashboard
 *   - PaymentRequest / PaymentForm
 *   - PhotoMeta / PhotoForm
 *   - InspectionIssue / DimensionItem
 */

// ============== 进度控制（B4） ==============
export interface ProgressNode {
  id: number
  project_name: string
  name: string
  plan_start: string | null
  plan_end: string | null
  actual_start: string | null
  actual_end: string | null
  progress_percent: number
  weight: number
  parent_id: number | null
  created_at: string
  updated_at: string
}

export type ProgressNodeForm = Omit<ProgressNode, 'id' | 'project_name' | 'created_at' | 'updated_at' | 'parent_id'>

export interface GanttBar {
  id: number
  name: string
  start: number  // 时间戳
  end: number
  progress: number
  weight: number
}

export interface GanttData {
  bars: GanttBar[]
  totalProgress: number
  projectStart: number | null
  projectEnd: number | null
}

export interface DeviationData {
  totalPlanned: number
  totalActual: number
  deviation: number  // 偏差天数，正=滞后
  nodes: Array<{
    id: number
    name: string
    planEnd: string | null
    actualEnd: string | null
    delayDays: number
  }>
}

export interface MonthlyCompare {
  yearMonth: string
  plannedCount: number
  actualCount: number
  completedNodes: Array<{ id: number; name: string; actualEnd: string }>
}

// ============== 合同管理（B6） ==============
export interface Contract {
  id: number
  project_name: string
  contract_name: string
  contract_type: string | null
  party_a: string | null
  party_b: string | null
  amount: number | null
  sign_date: string | null
  start_date: string | null
  end_date: string | null
  file_name: string | null
  status: '执行中' | '已到期' | '已终止'
  created_at: string
  updated_at: string
}

export interface ChangeOrder {
  id: number
  project_name: string
  change_number: string | null
  subject: string | null
  initiator: string | null
  reason: string | null
  content: string | null
  amount_change: number | null
  schedule_change: number | null
  status: '草稿' | '审批中' | '已批准' | '已驳回'
  file_name: string | null
  created_at: string
  updated_at: string
}

export interface Claim {
  id: number
  project_name: string
  claim_number: string | null
  claimant: string | null
  subject: string | null
  amount: number | null
  reason: string | null
  evidence: string | null
  status: '草稿' | '提交中' | '审批中' | '已批准' | '已驳回'
  file_name: string | null
  created_at: string
  updated_at: string
}

export interface ContractDashboard {
  contractCount: number
  totalAmount: number
  expiringCount: number
  changeCount: number
  changeAmount: number
  claimCount: number
  claimAmount: number
}

// ============== 投资控制（B5） ==============
export interface PaymentApprovalStage {
  stage: string  // 监理员 / 专业监理 / 总监 / 业主 / 已完成
  person: string
  time: string
  opinion: string
}

export interface PaymentRequest {
  id: number
  project_name: string
  period: string  // 2026-06
  amount: number
  amount_upper: string | null
  cumulative_amount: number | null
  cumulative_percent: number | null
  description: string | null
  approval_stage: string
  approval_history: string | null  // JSON string of PaymentApprovalStage[]
  related_nodes: string | null
  status: '审批中' | '已通过' | '已驳回' | '已支付'
  created_at: string
  updated_at: string
}

export type PaymentForm = Pick<PaymentRequest, 'period' | 'amount' | 'amount_upper' | 'description' | 'related_nodes' | 'status'>

export interface PaymentSummary {
  contractAmount: number
  approvedAmount: number
  approvedPercent: number
  pendingAmount: number
  rejectedAmount: number
  totalCount: number
  approvedCount: number
  pendingCount: number
  rejectedCount: number
}

// ============== 照片归档（B8） ==============
export interface PhotoMeta {
  id: number
  project_name: string
  file_name: string
  file_path: string
  shoot_date: string | null
  location: string | null
  tags: string | null
  description: string | null
  linked_hazard_id: number | null
  linked_node_id: number | null
  created_at: string
}

export type PhotoForm = Pick<PhotoMeta, 'location' | 'tags' | 'description' | 'shoot_date'>

// ============== 现场巡视 ==============
// 注意：内部状态用 dimKey/found 字段（不要重命名以避免破坏现成 IPC 数据）
export interface InspectionIssue {
  dimKey: string
  dimensionName: string
  itemId: string
  label: string
  found: boolean
  severity?: '一般' | '较重' | '严重'
  description?: string
  location?: string
  deadline?: string
}

export interface DimensionItem {
  id: string
  label: string
  description?: string
}

// ============== 数据看板 ==============
export interface PhaseItem {
  phase: string         // 阶段标识（如 '01', '02'）
  phaseName: string     // 阶段中文名（如 '设计阶段'）
  completeCount: number
  totalCount: number
}

// ============== AI 流式 ==============
export interface AIStreamParams {
  url?: string
  baseUrl?: string
  provider?: string
  apiKey?: string  // 已弃用：主进程从加密存储读取
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  mode?: 'CHAT' | 'DOC' | 'DATA_QUERY' | 'HYBRID'
  projectName?: string
  dataToolIds?: string[]
}

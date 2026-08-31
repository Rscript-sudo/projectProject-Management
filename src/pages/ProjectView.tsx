import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Typography, Input, Button, Space, Spin, Tag, App, Dropdown, Tooltip, DatePicker, Select, Tree, Modal, List } from 'antd'
import { SendOutlined, RobotOutlined, FileTextOutlined, SaveOutlined, ReloadOutlined, FilePdfOutlined, FolderOpenOutlined, HomeOutlined, EditOutlined, CloseOutlined, SearchOutlined, BookOutlined, EyeOutlined, PictureOutlined, InboxOutlined, HistoryOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { identifyDocType, identifyMode, buildChatPrompt, inferDataTools, postProcessTimeFields, postProcessFabricationGuard, sanitizeUnsupportedLogParticipants, generateFileName, getDocSavePath, providerConfigs, buildDocPrompt, callAI, extractSubject, stripCalibrationStatement, sanitizeFieldValue, sanitizeLetterStyle, parseStructuredContent } from '../services/aiService'
import { normalizeProjectType, normalizeTags } from '../shared/projectProfile.mjs'
import { countEffectiveWords, getMinWordCount } from '../shared/docTypeMinWords'
import { getDocumentRuleMinWords } from '../shared/documentRules.mjs'
import { stripThinkingContent } from '../shared/aiOutput.mjs'
import { hasUsableDocTypePrompt } from '../shared/docTypePrompts'
import { buildTemplateRuleEditorUrl } from '../shared/templateRuleNavigation.mjs'
import { getTemplateInputPlaceholder } from '../shared/templateInputGuidance.mjs'
import { getTemplateStatusBadge, isTemplateReady } from '../shared/templateReadiness.mjs'
import { useSettingsStore } from '../stores/useSettingsStore'
import { normalizeStructuredDocument } from '../shared/structuredGeneration'
import { buildFactPool, buildFieldConfigsFromPrompt, buildFieldResolutionPlan, formatResolutionContext, mergeResolvedFields } from '../shared/fieldResolution.mjs'
import { getDefaultPrompts, mergeDocTypePrompt } from '../shared/docTypePrompts'
import type { SessionMode } from '../services/aiService'
import DirTree from '../components/DirTree'
import type { DirNode, TemplateItem } from '../vite-env'
import { useElectronAPI } from '../hooks/useElectronAPI'
import dayjs from 'dayjs'
import './ProjectView.css'

const { Text } = Typography
const { TextArea } = Input

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  docType?: string
  rawData?: Record<string, any>
  wordCount?: number  // v1.0.0：AI 扩写字数实时统计
  timestamp: Date
  actions?: Array<{ key: 'correction' | 'other'; label: string }>
  imageContext?: string
  imagePaths?: string[]
}

interface GenerationTemplate {
  id: string
  name: string
  docType: string
  scope: 'global' | 'professional' | 'other' | 'system' | 'personal'
  projectType?: string
  projectTypeLabel?: string
  path: string
  sourceName?: string
  aiRuleConfiguredAt?: string
  aiRuleNeedsUpdate?: boolean
  missing?: boolean
  fields?: string[]
  readOnly?: boolean
}

function createMessageId(role: 'user' | 'assistant') {
  return `${role}_${Date.now()}_${crypto.randomUUID()}`
}

const IMAGE_FILE_RE = /\.(jpe?g|png|gif|bmp|webp|heic|heif)$/i

function isImagePath(filePath: string) {
  return IMAGE_FILE_RE.test(filePath)
}

function localImageUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  return encodeURI(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`)
}

async function collectAIStream(
  options: Parameters<typeof window.electronAPI.callAIStream>[0],
  onContent?: (content: string) => void,
  timeoutMs = 190000,
): Promise<{ success: boolean; content: string; error?: string }> {
  const requestId = `renderer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  let content = ''
  let streamError = ''
  let pendingVisibleContent = ''

  return await new Promise(resolve => {
    let settled = false
    let offChunk = () => {}
    let offEnd = () => {}
    let paintTimer: number | undefined
    const paint = () => {
      paintTimer = undefined
      if (!pendingVisibleContent) return
      const visibleContent = pendingVisibleContent
      pendingVisibleContent = ''
      onContent?.(visibleContent)
    }
    const schedulePaint = () => {
      if (paintTimer !== undefined) return
      // AI providers often emit only one or two characters per event. Updating the
      // whole React/Markdown tree for every event makes the text and scrollbar
      // visibly stutter. A 30 fps presentation cadence keeps latency imperceptible
      // while coalescing the bursty transport chunks into stable visual frames.
      paintTimer = window.setTimeout(paint, 34)
    }
    const finish = (success: boolean, error?: string) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (paintTimer !== undefined) window.clearTimeout(paintTimer)
      paint()
      offChunk()
      offEnd()
      resolve({ success, content, error })
    }
    offChunk = window.electronAPI.onAIStreamChunk(data => {
      if (data.requestId !== requestId) return
      if (data.type === 'content' && data.content) {
        content += data.content
        pendingVisibleContent = content
        schedulePaint()
      } else if (data.type === 'error') {
        streamError = data.error || 'AI 流式错误'
      }
    })
    offEnd = window.electronAPI.onAIStreamEnd(data => {
      if (data.requestId !== requestId) return
      finish(!streamError && !!stripThinkingContent(content).trim(), streamError || (!stripThinkingContent(content).trim() ? 'AI 未返回有效内容' : undefined))
    })
    const timer = window.setTimeout(() => {
      window.electronAPI.abortAIStream(requestId)
      finish(false, `AI 生成超时（${Math.round(timeoutMs / 1000)}秒）`)
    }, timeoutMs)

    window.electronAPI.callAIStream({ ...options, requestId }).then(started => {
      if (!started.success) finish(false, started.error || 'AI 流式请求启动失败')
    }).catch(error => finish(false, error?.message || 'AI 流式请求启动失败'))
  })
}

const AUTO_FILLED_TEMPLATE_FIELDS = new Set([
  '项目名称', '工程名称', '文件编号', '编号', '文号', '日期', '报告日期', '签章日期',
  '星期几', '天气', '气温',
  '致单位', '致送单位', '建设单位', '业主单位', '业主', '甲方', '甲方单位',
  '施工单位', '承建单位', '乙方', '乙方单位', '监理单位', '监理公司', '监理机构',
  '总监理工程师', '总监姓名', '总监理', '编制人', '审核人', '批准人',
  '施工单位签名', '监理单位签名', '建设单位签名', '签名日期',
  '局点名称', '表格行规格型号', '表格行备注', '表格行其它情况',
])

function fillMonitorLogBasics(content: string, docType: string) {
  if (docType !== '监理日志') return content
  const fields = parseStructuredContent(content)
  const defaults: Record<string, string> = {
    日期: dayjs().format('YYYY年MM月DD日'),
    星期几: `星期${'日一二三四五六'[dayjs().day()]}`,
    天气: '未记录',
    气温: '未记录',
  }
  const additions = Object.entries(defaults)
    .filter(([field]) => !String(fields[field] || '').trim())
    .map(([field, value]) => `【${field}】${value}`)
  return additions.length ? `${content.trim()}\n\n${additions.join('\n')}` : content
}

function validateGeneratedOutput(docType: string, content: string, templateFields: string[]) {
  const cleaned = stripThinkingContent(content).trim()
  if (!cleaned) return { valid: false, error: 'AI 未返回正文' }
  if (!templateFields.length) return { valid: true, envelope: normalizeStructuredDocument(docType, cleaned) }
  const envelope = normalizeStructuredDocument(docType, cleaned)
  const parsed = envelope.fields
  const required = templateFields.filter(field => !AUTO_FILLED_TEMPLATE_FIELDS.has(field))
  const missing = required.filter(field => !String(parsed[field] || '').trim())
  // 模板字段缺失不能阻断内容生成：事实字段由系统/用户后续补充，叙述字段由 AI
  // 尽量围绕已知事实扩写。这里只拦截完全空白的结果，缺字段降级为交付前软提醒。
  return { valid: true, envelope, missing }
}

/**
 * 统一 sanitize 管道（v1.3.1 新增）：流式主路径 / 续写路径 / 非流式降级 三路径共用
 * 顺序：stripThinking → stripCalibration → 反编造守门员 → 时间字段 → 事由前缀 → 信件语体 → 日志参与者
 * 返回 { content, warnings } 供调用方决定是否 message.warning
 */
function sanitizeFullPipeline(
  rawContent: string,
  ctx: { docType: string; holidayType?: string; sourceText?: string; isDocMode: boolean }
): { content: string; warnings: string[] } {
  let result = stripThinkingContent(rawContent)
  result = stripCalibrationStatement(result)
  const guardResult = postProcessFabricationGuard(result)
  result = postProcessTimeFields(guardResult.content, { docType: ctx.docType, holidayType: ctx.holidayType, sourceText: ctx.sourceText })
  if (ctx.isDocMode) {
    result = result.replace(
      /【(事由|主题|标题|摘要)】\s*([\s\S]*?)(?=【|$)/g,
      (_m, k, v) => `【${k}】${sanitizeFieldValue(String(v).trim())}`
    )
    result = sanitizeLetterStyle(result)
    // 文档生成与审批分离：这些字段可以存在于模板中，但 AI 生成阶段不得代替
    // 审批人作出流程决定。保留字段名并清空值，供后续独立审批流程填写。
    const decisionFields = '(?:审批意见|审批结论|审核结论|批准意见|是否同意|支付结论|是否进入下道工序)'
    result = result.replace(
      new RegExp(`【(${decisionFields})】[\\s\\S]*?(?=【|$)`, 'g'),
      (_match, field) => `【${field}】`,
    )
  }
  if (ctx.docType === '监理日志') {
    result = sanitizeUnsupportedLogParticipants(result, ctx.sourceText || '')
    result = fillMonitorLogBasics(result, ctx.docType)
  }
  return { content: result, warnings: guardResult.warnings }
}

export default function ProjectView() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { currentProject, setCurrentProject, projects, settings, projectRoot, loadSettings } = useAppStore()
  const { message } = App.useApp()

  // 本地状态
  const [dirTree, setDirTree] = useState<DirNode | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progressStage, setProgressStage] = useState<string>('')
  const [previewContent, setPreviewContent] = useState<{ docType: string; content: string; userInput: string; meta?: any } | null>(null)
  const [savedPath, setSavedPath] = useState('')
  const apiReady = useElectronAPI()
  const [lastInput, setLastInput] = useState('')
  const [projectConfig, setProjectConfig] = useState<{ contractor: string; ownerUnit: string; supervisorUnit: string; chiefEngineer: string; projectType: string; projectTypeCode?: string; projectTags?: string[]; projectFeatures?: string; projectPhase?: string; implementationArea?: string; documentRules?: { rulePackIds?: string[]; additionalInstruction?: string }; templateOverrides?: Record<string, { path: string; sourceName?: string; updatedAt?: string }>; templateSelections?: Record<string, string | null> }>({
    contractor: '',
    ownerUnit: '',
    supervisorUnit: '',
    chiefEngineer: '',
    projectType: '未分类', projectTypeCode: 'unclassified', projectTags: [], projectFeatures: '', projectPhase: '',
  })
  const [editMode, setEditMode] = useState(false)
  const [editableContent, setEditableContent] = useState('')
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'templates'>('preview')
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [activeDocumentType, setActiveDocumentType] = useState<string>()
  const [templateCatalog, setTemplateCatalog] = useState<TemplateItem[]>([])
  const [generationTemplates, setGenerationTemplates] = useState<GenerationTemplate[]>([])
  const [selectedGenerationTemplateId, setSelectedGenerationTemplateId] = useState<string>()
  const [templateLoading, setTemplateLoading] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [templateSearch, setTemplateSearch] = useState('')
  const [treeWidth, setTreeWidth] = useState(260)
  const [previewWidth, setPreviewWidth] = useState(380)
  const [attachedItems, setAttachedItems] = useState<Array<{ type: 'folder' | 'file'; path: string }>>([])
  const [reportPeriod, setReportPeriod] = useState<{ start: string; end: string } | null>(null)
  const [imageDragging, setImageDragging] = useState(false)
  const [recognizingImages, setRecognizingImages] = useState(false)
  const [sessionModalOpen, setSessionModalOpen] = useState(false)
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; archived: boolean; messageCount: number; preview: string; updatedAt: string }>>([])
  const [sessionQuery, setSessionQuery] = useState('')
  const [activeSessionId, setActiveSessionId] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const outputScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const historyLoadedProjectRef = useRef<string | null>(null)
  const aiHealthRef = useRef<{ key: string; checkedAt: number } | null>(null)
  const autoFollowOutputRef = useRef(true)

  // 拖拽调整面板宽度（使用 ref 避免闭包问题）
  const dragStateRef = useRef<{ panel: 'tree' | 'preview'; startX: number; startWidth: number } | null>(null)

  // AI 流式监听器 cleanup 句柄（FIX BUG-006：原代码 cleanup 只在 onEnd 内执行，
  // 若主进程异常未发 end 或组件提前卸载，监听器永远挂着会内存泄漏）
  const aiStreamCleanupRef = useRef<(() => void) | null>(null)

  // 卸载时清理任何残留的 AI 流式监听器
  useEffect(() => {
    return () => {
      aiStreamCleanupRef.current?.()
      aiStreamCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragStateRef.current) return
      const { panel, startX, startWidth } = dragStateRef.current
      const delta = ev.clientX - startX
      if (panel === 'tree') {
        setTreeWidth(Math.max(180, Math.min(500, startWidth + delta)))
      } else {
        setPreviewWidth(Math.max(280, Math.min(700, startWidth - delta)))
      }
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragStateRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleResizeStart = (panel: 'tree' | 'preview') => (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panel === 'tree' ? treeWidth : previewWidth
    dragStateRef.current = { panel, startX, startWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const stopStreaming = () => {
    aiStreamCleanupRef.current?.()
    aiStreamCleanupRef.current = null
    setLoading(false)
    setProgressStage('')
    message.info('已停止接收本次生成内容')
  }

  const copyLatestAssistant = async () => {
    const content = [...messages].reverse().find(item => item.role === 'assistant' && item.content)?.content
    if (!content) { message.warning('暂无可复制的 AI 输出'); return }
    await navigator.clipboard.writeText(content)
    message.success('AI 输出已复制')
  }

  // --- 函数定义（useCallback 必须在消费它们的 useEffect 之前声明，避免 TDZ）---

  const loadDirTree = useCallback(async (dirPath: string) => {
    if (!window.electronAPI) return
    try {
      const tree = await window.electronAPI.getDirTree(dirPath, 99)
      setDirTree(tree)
    } catch (e) {
      console.error('[ProjectView] Failed to load directory tree:', e)
    }
  }, [])

  const loadProjectConfig = useCallback(async () => {
    if (!currentProject || !window.electronAPI) return
    try {
      const config = await window.electronAPI.readProjectConfig(currentProject.path)
      setProjectConfig(config)
    } catch (e) {
      console.warn('[ProjectView] Failed to load project config:', e)
    }
  }, [currentProject])

  // 确保 settings 已加载（用 hasApiKey 而不是 apiKey，因为 apiKey 是脱敏字段永远是 undefined）
  useEffect(() => {
    if (!settings.hasApiKey && !settings.apiKeyDecryptError) {
      loadSettings()
    }
  }, [settings.hasApiKey, settings.apiKeyDecryptError, loadSettings])

  // 加载当前项目目录树；项目工作台应直接展示四阶段结构，而不是再套一层项目根目录。
  useEffect(() => {
    if (currentProject?.path && apiReady) {
      loadDirTree(currentProject.path)
    }
  }, [currentProject?.path, apiReady, loadDirTree])

  // 加载项目配置
  useEffect(() => {
    if (currentProject) {
      loadProjectConfig()
    }
  }, [currentProject, loadProjectConfig])

  // 每个项目独立保存 AI 对话；切换项目时先恢复对应历史。
  useEffect(() => {
    const projectPath = currentProject?.path
    historyLoadedProjectRef.current = null
    setMessages([])
    setPreviewContent(null)
    setSavedPath('')
    if (!projectPath || !apiReady) return

    let cancelled = false
    window.electronAPI.readProjectChatHistory(projectPath).then(result => {
      if (cancelled) return
      const restored = result.success && Array.isArray(result.messages)
        ? result.messages
          .filter((item, index, all) => !(
            item.role === 'user'
            && String(item.content || '').startsWith('生成失败：')
            && all.some((other, otherIndex) => otherIndex !== index && other.id === item.id && other.role === 'assistant' && other.content === item.content)
          ))
          .map(item => ({ ...item, timestamp: new Date(item.timestamp || Date.now()) })) as ChatMessage[]
        : []
      messagesRef.current = restored
      setMessages(restored)
      setActiveSessionId(result.sessionId || '')
      historyLoadedProjectRef.current = projectPath
      if (!result.success) message.warning(`聊天记录恢复失败：${result.error || '未知错误'}`)
    })

    return () => {
      cancelled = true
      if (historyLoadedProjectRef.current === projectPath) {
        void window.electronAPI.writeProjectChatHistory(projectPath, messagesRef.current)
      }
    }
  }, [currentProject?.path, apiReady, message])

  useEffect(() => {
    const projectPath = currentProject?.path
    if (!projectPath || historyLoadedProjectRef.current !== projectPath) return
    const timer = window.setTimeout(() => {
      void window.electronAPI.writeProjectChatHistory(projectPath, messages).then(result => {
        if (!result.success) console.error('[ProjectView] 聊天记录保存失败:', result.error)
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [messages, currentProject?.path])

  const loadChatSessions = useCallback(async (query = sessionQuery) => {
    if (!currentProject) return
    const result = await window.electronAPI.listChatSessions(currentProject.path, query)
    if (result.success) { setChatSessions(result.sessions || []); setActiveSessionId(result.activeSessionId || '') }
    else message.error(result.error || '会话列表读取失败')
  }, [currentProject, message, sessionQuery])

  const openSession = async (sessionId: string) => {
    if (!currentProject) return
    await window.electronAPI.writeProjectChatHistory(currentProject.path, messagesRef.current)
    const result = await window.electronAPI.openChatSession(currentProject.path, sessionId)
    if (!result.success) return message.error(result.error || '打开会话失败')
    const restored = (result.session?.messages || []).map((item: any) => ({ ...item, timestamp: new Date(item.timestamp || Date.now()) })) as ChatMessage[]
    messagesRef.current = restored; setMessages(restored); setActiveSessionId(sessionId); setPreviewContent(null); setSessionModalOpen(false)
  }

  const createSession = async () => {
    if (!currentProject) return
    await window.electronAPI.writeProjectChatHistory(currentProject.path, messagesRef.current)
    const result = await window.electronAPI.createChatSession(currentProject.path)
    if (!result.success) return message.error(result.error || '创建会话失败')
    messagesRef.current = []; setMessages([]); setActiveSessionId(result.session.id); setPreviewContent(null); setSessionModalOpen(false)
  }

  // 加载模板资源目录
  useEffect(() => {
    if (!apiReady) return
    loadTemplateCatalog()
  }, [apiReady])

  // 默认展开模板目录
  useEffect(() => {
    if (templateCatalog.length > 0) {
      setExpandedCategories(new Set())
    }
  }, [templateCatalog])

  // 项目配置是模板选择的真相源。返回生成页或重启应用后恢复高亮，避免界面选中项与实际渲染模板脱节。
  useEffect(() => {
    if (!activeDocumentType || generationTemplates.length === 0) return
    const configuredId = projectConfig.templateSelections?.[activeDocumentType]
    if (configuredId) {
      setSelectedGenerationTemplateId(configuredId)
      return
    }
    if (configuredId === null) {
      const systemTemplate = generationTemplates.find(item => item.docType === activeDocumentType && item.scope === 'system')
      setSelectedGenerationTemplateId(systemTemplate?.id)
    }
  }, [activeDocumentType, generationTemplates, projectConfig.templateSelections])

  // 消费从规则页返回时携带的上下文。只有真实用户输入才恢复到编辑框；
  // 文种名称本身不再作为可发送内容预填，避免误发空任务。
  useEffect(() => {
    const docType = searchParams.get('docType')
    const prefill = searchParams.get('input')
    const generationTemplateId = searchParams.get('generationTemplateId')
    if (docType) setActiveDocumentType(docType)
    if (generationTemplateId) setSelectedGenerationTemplateId(generationTemplateId)
    if (prefill) setInput(prefill)
  }, [searchParams])

  const loadTemplateCatalog = async () => {
    if (!window.electronAPI) return
    setTemplateLoading(true)
    try {
      const [catalog, library, system] = await Promise.all([
        window.electronAPI.getTemplateCatalog(),
        window.electronAPI.listTemplateLibrary(),
        window.electronAPI.listSystemTemplates(),
      ])
      setTemplateCatalog(catalog || [])
      // 只有用户添加的“通用模板”才覆盖同文种系统模板。
      // 专业/项目/私人模板属于独立资源树节点，不能让系统内置项从通用模板中消失。
      const globalLibraryDocTypes = new Set(
        (library || []).filter(item => item.scope === 'global').map(item => item.docType),
      )
      setGenerationTemplates([
        ...(library || []),
        ...(system || []).filter(item => !globalLibraryDocTypes.has(item.docType)),
      ] as GenerationTemplate[])
    } catch (e) {
      console.error('[ProjectView] Failed to load template catalog:', e)
    }
    setTemplateLoading(false)
  }

  const selectGenerationTemplate = async (template: GenerationTemplate) => {
    if (!currentProject) return
    const templateId = template.scope === 'system' ? null : template.id
    const result = await window.electronAPI.selectProjectTemplate(currentProject.path, template.docType, templateId)
    if (!result?.success) { message.error(result?.error || '模板选择失败'); return }
    setProjectConfig(prev => ({
      ...prev,
      templateSelections: { ...(prev.templateSelections || {}), [template.docType]: templateId },
    }))
    setActiveDocumentType(template.docType)
    if ((template.docType === '监理周报' || template.docType === '监理月报') && !reportPeriod) {
      const now = dayjs()
      setReportPeriod(template.docType === '监理周报'
        ? { start: now.startOf('week').add(1, 'day').format('YYYY-MM-DD'), end: now.endOf('week').add(1, 'day').format('YYYY-MM-DD') }
        : { start: now.startOf('month').format('YYYY-MM-DD'), end: now.endOf('month').format('YYYY-MM-DD') })
    }
    setSelectedGenerationTemplateId(template.id)
    message.success(`已选择“${template.name || template.docType}”，请输入事实或上传资料`)
  }

  const handleAttachFolder = async () => {
    if (!window.electronAPI) return
    const dir = await window.electronAPI.selectDir()
    if (dir) setAttachedItems(prev => [...prev, { type: 'folder', path: dir }])
  }

  const handleAttachFiles = async () => {
    if (!window.electronAPI) return
    const files = await window.electronAPI.selectFiles()
    if (files?.length) setAttachedItems(prev => [...prev, ...files.map(f => ({ type: 'file' as const, path: f }))])
  }

  const recognizeDroppedImages = async (paths: string[]) => {
    if (!paths.length || recognizingImages) return
    const currentSettings = useAppStore.getState().settings
    if (!currentSettings.hasApiKey) { message.error('请先在 AI 配置中设置 API Key'); return }
    autoFollowOutputRef.current = true
    setMessages(prev => [...prev, {
      id: `image-user-${Date.now()}`,
      role: 'user',
      content: paths.length === 1 ? '现场图片' : `现场图片（${paths.length} 张）`,
      imagePaths: paths,
      timestamp: new Date(),
    }])
    setRecognizingImages(true)
    setLoading(true)
    setProgressStage('analyzing')
    try {
      const result = await window.electronAPI.recognizeImages({ paths })
      if (!result.success || !result.content) throw new Error(result.error || '图片识别失败')
      const cleanContent = stripThinkingContent(result.content)
      setMessages(prev => [...prev, {
        id: `image-ai-${Date.now()}`,
        role: 'assistant',
        content: `**图片识别结果**\n\n${cleanContent}\n\n是否根据以上事实撰写文档？`,
        imageContext: cleanContent,
        actions: [
          { key: 'correction', label: '撰写监理整改通知单' },
          { key: 'other', label: '选择其他文档类型' },
        ],
        timestamp: new Date(),
      }])
    } catch (error: any) {
      message.error(error?.message || '图片识别失败')
      setMessages(prev => [...prev, { id: `image-error-${Date.now()}`, role: 'assistant', content: `图片识别失败：${error?.message || '请检查当前模型是否支持图片输入'}`, timestamp: new Date() }])
    } finally {
      setRecognizingImages(false)
      setLoading(false)
      setProgressStage('')
    }
  }

  const handleImageDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setImageDragging(false)
    const paths = Array.from(event.dataTransfer.files)
      .map(file => window.electronAPI.getPathForFile(file))
      .filter(isImagePath)
    if (!paths.length) { message.warning('请拖入 JPG、PNG、WEBP、HEIC 等图片文件'); return }
    await recognizeDroppedImages(paths)
  }

  const handleImageDocumentAction = async (msg: ChatMessage, action: 'correction' | 'other') => {
    const facts = msg.imageContext || ''
    if (action === 'correction') {
      const docType = '整改通知书'
      const template = generationTemplates.find(item => item.docType === docType)
      if (template) await selectGenerationTemplate(template)
      setActiveDocumentType(docType)
      setInput(`请根据以下图片识别事实撰写${docType}，不得增加图片中无法确认的信息：\n\n${facts}`)
      setRightPanelTab('preview')
      message.success('已准备整改通知单，请补充项目事实后发送')
    } else {
      setInput(`请根据以下图片识别事实撰写文档，不得增加图片中无法确认的信息：\n\n${facts}`)
      setRightPanelTab('templates')
      message.info('请在右侧模板资源中选择文档类型')
    }
  }

  // 发送消息 — 支持 CHAT / DATA_QUERY / DOC / HYBRID 四模式
  const handleSend = useCallback(async () => {
    if (!apiReady) {
      message.error('系统正在初始化，请稍候...')
      return
    }

    if (loading) return
    const trimmedInput = input.trim() || (attachedItems.length > 0
      ? `请根据已上传的资料填写当前${activeDocumentType || '文档'}，只使用可核验事实。`
      : '')
    if (!trimmedInput) {
      message.warning(activeDocumentType ? getTemplateInputPlaceholder(activeDocumentType) : '请输入需求，或先上传相关资料')
      return
    }
    autoFollowOutputRef.current = true

    // 先完成文种与模板规则门禁，再检查 AI 服务，避免无规则模板先发起网络请求。
    const identified = identifyMode(trimmedInput)
    let { mode, docType, dataToolIds } = identified
    const explicitlySelectedTemplate = generationTemplates.find(item => item.id === selectedGenerationTemplateId)
    // 用户在模板资源中点选的实体模板是本次生成文种的最高优先级真相源。
    // 不能再让关键词识别把“网络系统工程设计方案审核意见表”等专业文种降级为
    // 泛化的“方案审核意见”，否则会绕开该模板刚保存的字段合同和 AI 规则。
    if (explicitlySelectedTemplate && activeDocumentType === explicitlySelectedTemplate.docType) {
      mode = 'DOC'
      docType = explicitlySelectedTemplate.docType
      dataToolIds = []
    } else if (activeDocumentType && (mode === 'CHAT' || (mode === 'DOC' && docType === '通用文档'))) {
      mode = 'DOC'
      docType = activeDocumentType
      dataToolIds = []
    }
    const effectiveDocType = docType || activeDocumentType
    const needsReportPeriod = effectiveDocType === '监理周报' || effectiveDocType === '监理月报'
    if (needsReportPeriod && !reportPeriod) {
      message.warning('请先选择报告期；周报和月报只能使用报告期内已确认的数据。')
      return
    }
    if ((mode === 'DOC' || mode === 'HYBRID') && effectiveDocType) {
      const settingsState = useSettingsStore.getState()
      const promptKey = settingsState.customDocTypes.find(item => item.label === effectiveDocType)?.code || effectiveDocType
      const selectedTemplate = generationTemplates.find(item => item.id === selectedGenerationTemplateId)
      const hasDocTypeRule = hasUsableDocTypePrompt(promptKey, settingsState.docTypePromptOverrides)
      const hasTemplateRule = !selectedTemplate || isTemplateReady({ ...selectedTemplate, readOnly: selectedTemplate.scope === 'system' })
      if (!hasDocTypeRule || !hasTemplateRule) {
        Modal.confirm({
          title: '模板尚未配置 AI 扩写规则',
          content: `“${selectedTemplate?.name || effectiveDocType}”尚未完成这份模板的 AI 扩写规则配置。请先确认字段和扩写规则，保存后系统会返回当前项目继续生成。`,
          okText: '去配置规则',
          cancelText: '暂不生成',
          onOk: () => navigate(buildTemplateRuleEditorUrl({
            pathname: location.pathname,
            search: location.search,
            docType: effectiveDocType,
            templateId: selectedTemplate?.id,
            input: trimmedInput,
          })),
        })
        return
      }
    }

    const currentSettings = useAppStore.getState().settings
    // 注意：settings 是脱敏版（主进程持有真实 apiKey），前端用 hasApiKey 判断
    // 别再用 currentSettings.apiKey — 它永远 undefined
    if (!currentSettings.hasApiKey) {
      message.error('请先在设置中配置 AI API Key')
      return
    }
    if (currentSettings.apiKeyDecryptError) {
      message.error('已配置的 API Key 无法解密，请到【设置】页重新输入')
      return
    }

    const healthKey = `${currentSettings.aiProvider}|${currentSettings.baseUrl}|${currentSettings.model}`
    if (!aiHealthRef.current || aiHealthRef.current.key !== healthKey || Date.now() - aiHealthRef.current.checkedAt > 5 * 60 * 1000) {
      setProgressStage('analyzing')
      const health = await window.electronAPI.checkAIHealth({
        provider: currentSettings.aiProvider,
        baseUrl: currentSettings.baseUrl,
        model: currentSettings.model,
      })
      setProgressStage('')
      if (!health.success) {
        message.error(`AI 服务不可用：${health.error || '请检查服务商和模型配置'}`, 6)
        return
      }
      aiHealthRef.current = { key: healthKey, checkedAt: Date.now() }
    }

    // ==== 照片归档模式（直接调 photo:aiArchive，不走 AI 流）====
    const attachedFolder = attachedItems.find(i => i.type === 'folder')
    if (attachedFolder && (trimmedInput.includes('整理照片') || trimmedInput.includes('照片归档') || trimmedInput.includes('照片存档')) && currentProject) {
      setMessages(prev => [...prev, {
        id: createMessageId('user'),
        role: 'user',
        content: trimmedInput + '\n📁 ' + attachedFolder.path,
        timestamp: new Date(),
      }])
      setInput('')
      setLoading(true)
      setProgressStage('processing')
      try {
        const result = await window.electronAPI.photoAiArchive({
          projectPath: currentProject.path,
          scanDir: attachedFolder.path,
          // 不传 apiKey，主进程自己持有
          aiConfig: { baseUrl: currentSettings.baseUrl, model: currentSettings.model },
        })
        const content = result.success
          ? `✅ **照片整理完成**\n\n共扫描 **${result.total}** 张照片\n已归档 **${result.archived}** 张\n\n${(result.months || []).map(m => '📁 ' + m).join('\n') || ''}\n\n${result.summary || ''}`
          : `❌ 整理失败：${result.error || '未知错误'}`
        setMessages(prev => [...prev, { id: createMessageId('assistant'), role: 'assistant', content, timestamp: new Date() }])
      } catch (e: any) {
        setMessages(prev => [...prev, { id: createMessageId('assistant'), role: 'assistant', content: `❌ 整理出错：${e.message}`, timestamp: new Date() }])
      }
      setAttachedItems([])
      setProgressStage('')
      setLoading(false)
      return
    }

    // ==== 意图分类已在 AI 服务检查前完成 ====
    if (docType) setActiveDocumentType(docType)
    setLastInput(trimmedInput)

    // v1.2.0：DOC/HYBRID 模式必须先选项目，避免 AI 在没有项目信息时凭空扩写
    //   v1.1.x 行为：currentProject 为 null 时 projectInfo=undefined，AI 仍生成但内容空泛
    //   v1.2.0 行为：弹 toast 提示选项目，中断生成
    if ((mode === 'DOC' || mode === 'HYBRID') && !currentProject) {
      message.warning('请先在顶部选择项目，再生成文档', 3)
      setLoading(false)
      setProgressStage('')
      return
    }
    if ((mode === 'DOC' || mode === 'HYBRID') && normalizeProjectType(projectConfig.projectTypeCode || projectConfig.projectType) === 'unclassified') {
      message.info('项目类型未配置，将按通用工程规则生成；项目类型只影响专业术语，不限制生成', 4)
    }

    // 添加用户消息
    const attachSummary = attachedItems.map(i => `  ${i.type === 'folder' ? '📁' : '📄'} ${i.path}`).join('\n')

    // v1.2.1（2026-06-28）：识别节假日类型，给 postProcessTimeFields 传 context
    //   避免【放假日期】字段被误替换成今天（老板反馈的"国庆 → 2026年06月28日"）
    let holidayType: string | undefined
    if (docType === '安全通知书') {
      const lower = trimmedInput.toLowerCase()
      if (lower.includes('五一') || lower.includes('劳动节')) holidayType = '五一'
      else if (lower.includes('端午') || lower.includes('端阳')) holidayType = '端午'
      else if (lower.includes('国庆') || lower.includes('十一')) holidayType = '国庆'
      else if (lower.includes('春节') || lower.includes('过年')) holidayType = '春节'
      else if (lower.includes('清明')) holidayType = '清明'
    }
    setMessages(prev => [...prev, {
      id: createMessageId('user'),
      role: 'user',
      content: trimmedInput + (attachedItems.length > 0 ? '\n\n【附件】\n' + attachSummary : ''),
      timestamp: new Date(),
    }])
    setInput('')
    setLoading(true)
    setProgressStage('analyzing')

    // 提前挂一个 assistant 占位消息
    const assistantId = createMessageId('assistant')
    const showDocType = mode === 'DOC' || mode === 'HYBRID' ? docType : undefined
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      docType: showDocType,
      timestamp: new Date(),
    }])

    let operationId = ''
    try {
      const operation = await window.electronAPI.createOperation({
        type: mode === 'DOC' || mode === 'HYBRID' ? 'document-generation' : 'ai-conversation',
        title: mode === 'DOC' || mode === 'HYBRID' ? `生成${docType || '通用文档'}` : 'AI 对话',
        projectPath: currentProject?.path,
        metadata: { docType, mode, attachmentCount: attachedItems.length, model: currentSettings.model },
      })
      if (operation?.success && operation.task?.id) {
        operationId = operation.task.id
        await window.electronAPI.updateOperation(operationId, { status: 'running', stage: 'analyzing', progress: 10 })
      } else {
        console.warn('[ProjectView] 任务记录创建失败:', operation?.error)
      }
    } catch (error) { console.warn('[ProjectView] 任务记录创建失败:', error) }

    try {
      // v1.2.0：删除假值兜底（v1.1.x 用了 '建设单位'/'施工单位' 等字面字符串作为 fallback，
      //   AI 会把这些字面字符串当真值写进文档。改为 undefined 让 AI 走反编造铁律的占位符逻辑）
      const projectInfo = currentProject ? {
        projectName: currentProject.name,
        ownerUnit: projectConfig.ownerUnit || undefined,
        contractor: projectConfig.contractor || undefined,
        supervisorUnit: projectConfig.supervisorUnit || undefined,
        chiefEngineer: projectConfig.chiefEngineer || undefined,
        projectType: projectConfig.projectType || undefined,
        projectTypeCode: projectConfig.projectTypeCode || normalizeProjectType(projectConfig.projectType),
        projectTags: normalizeTags(projectConfig.projectTags),
        projectFeatures: projectConfig.projectFeatures || undefined,
        projectPhase: projectConfig.projectPhase || undefined,
        implementationArea: projectConfig.implementationArea || undefined,
        projectCode: (projectConfig as any).projectCode || undefined,
        documentRules: projectConfig.documentRules,
      } : undefined

      // ==== 附件信息注入 AI 上下文 ====
      let attachContext = ''
      if (attachedItems.length > 0) {
        const parts: string[] = []
        for (const [sourceIndex, item] of attachedItems.entries()) {
          const sourceId = `S${sourceIndex + 1}`
          if (item.type === 'folder') {
            try {
              const tree = await window.electronAPI.getDirTree(item.path, 5)
              if (tree) {
                const files = flattenFileTree(tree)
                if (files.length > 0) {
                  parts.push(`【来源:${sourceId}】文件夹：${item.path}\n  文件清单：\n${files.map((f, i) => `    ${i + 1}. ${f}`).join('\n')}`)
                } else {
                  parts.push(`【来源:${sourceId}】文件夹：${item.path}（空文件夹）`)
                }
              }
            } catch {
              parts.push(`【来源:${sourceId}】文件夹：${item.path}（读取失败）`)
            }
          } else {
            // 读取文件内容供 AI 分析
            try {
              const fc = await window.electronAPI.readFileContent(item.path)
              if (fc.success && fc.type === 'text' && fc.content) {
                const note = fc.truncated ? '\n  (内容较长已截断，仅显示前50KB)' : ''
                parts.push(`【来源:${sourceId}】文件：${item.path}\n  ---- 文件内容 ----\n${fc.content}${note}`)
              } else if (fc.success && fc.type === 'image') {
                parts.push(`【来源:${sourceId}】图片：${item.path}（图片文件，大小：${(fc.size || 0) / 1024 > 1024 ? ((fc.size || 0) / 1024 / 1024).toFixed(1) + 'MB' : ((fc.size || 0) / 1024).toFixed(0) + 'KB'}）`)
              } else {
                parts.push(`【来源:${sourceId}】文件：${item.path}（${fc.note || '暂不支持内容解析'}）`)
              }
            } catch {
              parts.push(`【来源:${sourceId}】文件：${item.path}（读取失败）`)
            }
          }
        }
        if (parts.length > 0) {
          attachContext = `\n\n【附件内容】\n${parts.join('\n\n')}\n\n请根据以上附件内容给出分析或建议。凡引用附件事实，必须在对应句末标注[来源:S编号]；无法对应来源的事实不得写入正式文档。如果是文件清单，建议每个文件应归档到项目下哪个子目录。`
        }
      }

      // ==== 按模式构建 messages ====
      let aiMessages: { role: string; content: string }[]
      let generationTemplateFields: string[] = []
      let generationFieldPlan: any[] = []
      let userContent = attachContext ? trimmedInput + attachContext : trimmedInput
      const extractedSubject = extractSubject(trimmedInput)  // 提取事由摘要，不让 AI 照抄原始输入

      switch (mode) {
        case 'DOC':
        case 'HYBRID': {
          // v1.2.1（2026-06-28）：预加载项目类型 SOP JSON 注入 prompt
          // 不阻塞：失败时降级到 router enabledSections 摘要（buildDocPrompt 兜底）
          let sopData: any = undefined
          try {
            const projectType = projectInfo?.projectTypeCode || projectInfo?.projectType || 'unclassified'
            if (window.electronAPI?.readSop) {
              const r = await window.electronAPI.readSop({ projectType, docType: docType || '' })
              if (r && r.found) sopData = r
            }
          } catch (e) {
            console.warn('[ProjectView] SOP 预加载失败，降级到 router:', e)
          }
          let templateFields: string[] = []
          try {
            if (currentProject && docType && window.electronAPI?.getProjectTemplateContract) {
              const contract = await window.electronAPI.getProjectTemplateContract(currentProject.path, docType)
              templateFields = contract.fields || []
              generationTemplateFields = templateFields
            }
          } catch (e) {
            console.warn('[ProjectView] 模板字段契约读取失败，继续使用文种规则:', e)
          }
          try {
            const automatic = await window.electronAPI.resolveTemplateContext({
              input: trimmedInput,
              project: projectInfo || {},
              fields: templateFields,
            })
            if (automatic.warnings?.length) message.info(`自动取数提示：${automatic.warnings.join('；')}`, 5)
            const promptOverrides = useSettingsStore.getState().docTypePromptOverrides || {}
            const promptKey = Object.keys(promptOverrides).find(key => key === docType || promptOverrides[key]?.key === docType)
            const defaults = getDefaultPrompts().docTypes[docType || '']
            const effectivePrompt = defaults
              ? mergeDocTypePrompt(defaults, promptKey ? promptOverrides[promptKey] : undefined)
              : (promptKey ? promptOverrides[promptKey] : undefined)
            const fieldConfigs = buildFieldConfigsFromPrompt(effectivePrompt || {}, templateFields)
            const factPool = buildFactPool(trimmedInput, {
              project: projectInfo || {},
              autoValues: automatic.values || {},
              provenance: automatic.provenance || {},
            })
            generationFieldPlan = buildFieldResolutionPlan(templateFields, { fieldConfigs, factPool })
            const hardMissing = generationFieldPlan.filter(item => item.contract.requiredForGeneration && !item.value && item.status !== 'expand')
            if (hardMissing.length) throw new Error(`以下高风险字段必须先提供明确数据：${hardMissing.map(item => item.field).join('、')}`)
            userContent = `${userContent}\n\n${formatResolutionContext(factPool, generationFieldPlan)}`
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('以下高风险字段')) throw e
            console.warn('[ProjectView] 字段解析计划失败，按现有模板规则继续生成:', e)
          }
          const { system, user } = buildDocPrompt(docType || '通用文档', userContent, projectInfo, extractedSubject, sopData, templateFields)
          aiMessages = [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ]
          break
        }
        case 'CHAT': {
          // 多轮对话：保留完整历史
          const sys = buildChatPrompt(projectInfo)
          const history = messages.map(m => ({ role: m.role, content: m.content }))
          aiMessages = [
            { role: 'system', content: sys },
            ...history,
            { role: 'user', content: userContent },
          ]
          break
        }
        case 'DATA_QUERY': {
          // 数据查询：主进程会注入数据上下文
          aiMessages = [
            { role: 'system', content: 'DATA_QUERY' },
            { role: 'user', content: userContent },
          ]
          break
        }
        default: {
          const { system, user } = buildDocPrompt('通用文档', userContent, projectInfo, extractedSubject)
          aiMessages = [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ]
        }
      }

      setProgressStage('generating')
      if (operationId) void window.electronAPI.updateOperation(operationId, { status: 'running', stage: 'generating', progress: 35 })

      const hasImageAttachment = attachedItems.some(item => item.type === 'file' && isImagePath(item.path))
      const route = await window.electronAPI.routeModel([currentSettings.model], {
        vision: hasImageAttachment,
        structuredOutput: mode === 'DOC' || mode === 'HYBRID',
        streaming: true,
      })
      if (!route.success || !route.route?.selected) throw new Error(route.route?.reason || route.error || '当前模型不满足任务能力要求')
      const aiCfg = {
        provider: currentSettings.aiProvider as any,
        // 不再传 apiKey —— 主进程自己持有（脱敏设计）
        baseUrl: currentSettings.baseUrl,
        model: route.route.selected.model,
      }

      // 构造 IPC 参数（apiKey 已在主进程持有，前端不再传入；新签名的 AIOptions 已将 apiKey 改为可选）
      const ipcParams = {
        ...aiCfg,
        mode,
        projectName: currentProject?.name,
        dataToolIds,
        reportPeriod: needsReportPeriod ? reportPeriod || undefined : undefined,
        messages: aiMessages,
        operationId,
      }

      // 监听器先注册、请求后启动，避免首批流式内容丢失。
      const streamable = await collectAIStream(ipcParams, visible => {
        const clean = stripThinkingContent(visible)
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          content: clean,
          wordCount: countEffectiveWords(clean),
        } : m))
      })

      if (streamable.success) {
        let accumulated = streamable.content

        // v1.3.1：统一用 sanitizeFullPipeline（原流式主路径分散调用 sanitizeFieldValue/sanitizeLetterStyle 在续写之后）
        const mainSanitized = sanitizeFullPipeline(accumulated, {
          docType: docType || '通用文档',
          holidayType,
          sourceText: trimmedInput,
          isDocMode: mode === 'DOC' || mode === 'HYBRID',
        })
        accumulated = mainSanitized.content
        accumulated = mergeResolvedFields(accumulated, generationFieldPlan)
        if (mainSanitized.warnings.length > 0) {
          message.warning(`⚠️ ${mainSanitized.warnings.join('；')}，已替换为占位符请补充`, 5)
        }

        // v1.2.1（2026-06-28 接入）：DOC/HYBRID 模式下自动续写
        //   AI 输出 < getMinWordCount(docType) → 追加一轮 user 消息要求扩写，最多 1 次
        if ((mode === 'DOC' || mode === 'HYBRID') && docType && docType !== '通用文档') {
            const minWords = Math.max(getMinWordCount(docType), getDocumentRuleMinWords(docType, projectConfig.documentRules))
          let wordCount = countEffectiveWords(accumulated)
          if (minWords > 0 && wordCount < minWords) {
            // 尝试追加一轮 user 消息（不重新走 system prompt，直接续写）
            const extraUserMsg = `【字数补足要求】你刚刚输出 ${wordCount} 字，远低于本文档要求的 ${minWords} 字下限。请在原文基础上直接续写扩写，不要重写开头、不要重写已正确的内容。重点：补充缺失条款的细节、给出可执行的检查/整改步骤、引用规范条款编号；不得编造具体时间/人员/部位。继续输出正文即可。`
            try {
              console.log(`[AI] 触发续写：当前 ${wordCount}/${minWords} 字`)
              const retryResult = await collectAIStream({
                ...aiCfg,
                mode: 'CHAT',  // 续写走 CHAT 模式避免再次走 DOC 复杂提示
                projectName: currentProject?.name,
                messages: [
                  ...aiMessages,
                  { role: 'assistant', content: accumulated },
                  { role: 'user', content: extraUserMsg },
                ],
              }, retryContent => {
                // v1.3.1 修复：续写中间态也要 sanitize（原直接显示未清洗内容）
                const merged = sanitizeFullPipeline(accumulated + '\n' + retryContent, {
                  docType: docType || '通用文档',
                  holidayType,
                  sourceText: trimmedInput,
                  isDocMode: mode === 'DOC' || mode === 'HYBRID',
                }).content
                setMessages(prev => prev.map(m => m.id === assistantId ? {
                  ...m,
                  content: merged,
                  wordCount: countEffectiveWords(merged),
                } : m))
              })
              if (!retryResult.success) {
                console.error('[AI] 续写失败:', retryResult.error)
                message.warning(`续写失败：${retryResult.error || '未知错误'}；已保留首次生成内容`)
              } else {
                // v1.3.1 修复：续写成功分支用统一 sanitizeFullPipeline（原漏 sanitizeFieldValue + sanitizeLetterStyle）
                const finalResult = sanitizeFullPipeline(accumulated + '\n' + retryResult.content, {
                  docType: docType || '通用文档',
                  holidayType,
                  sourceText: trimmedInput,
                  isDocMode: mode === 'DOC' || mode === 'HYBRID',
                })
                accumulated = finalResult.content
                accumulated = mergeResolvedFields(accumulated, generationFieldPlan)
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m))
              }
            } catch (e) {
              console.error('[ProjectView] 续写异常:', e)
              message.error(`续写异常：${e instanceof Error ? e.message : String(e)}`)
            }
            wordCount = countEffectiveWords(accumulated)
            if (wordCount < minWords) {
              message.warning(`⚠️ AI 仅输出 ${wordCount} 字（要求 ≥ ${minWords} 字），内容可能不足，建议在输入中补充具体要求后重新生成`, 6)
            }
          }
        }

        // v1.3.1：sanitizeFieldValue + sanitizeLetterStyle 已由 sanitizeFullPipeline 统一处理
        //   保留验收 + 质量评分 + 最终 setMessages
        if (mode === 'DOC' || mode === 'HYBRID') {
          const validation = validateGeneratedOutput(docType || '通用文档', accumulated, generationTemplateFields)
          if (!validation.valid) throw new Error(`生成结果验收未通过：${validation.error}`)
          if (validation.missing?.length) message.warning(`以下字段尚未取得明确事实，已保留生成结果，可在保存前补充：${validation.missing.join('、')}`, 6)
          const quality = await window.electronAPI.scoreDocumentQuality(docType || '通用文档', accumulated)
          if (quality.quality && !quality.quality.passed) message.warning(`文档质量评分 ${quality.quality.score}，建议检查后再保存`)
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m))
        }

        // DOC / HYBRID 模式显示文档预览
        if (mode === 'DOC' || mode === 'HYBRID') {
          setProgressStage('processing')
          setPreviewContent({ docType: docType || '通用文档', content: accumulated, userInput: trimmedInput, meta: { fieldPlan: generationFieldPlan } })
          setSavedPath('')
        } else if (mode === 'DATA_QUERY' && currentProject && dataToolIds?.length) {
          setPreviewContent(null)
          setSavedPath('')
          try {
            const raw = await window.electronAPI.dataQuery({
              projectName: currentProject.name,
              toolIds: dataToolIds,
              reportPeriod: needsReportPeriod ? reportPeriod || undefined : undefined,
            })
            if (raw && Object.keys(raw).length > 0) {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, rawData: raw } : m))
            }
          } catch (e) {
            console.warn('[ProjectView] dataQuery failed:', e)
          }
        } else {
          // CHAT 模式
          setPreviewContent(null)
          setSavedPath('')
        }
        setAttachedItems([])
        setProgressStage('')
        setLoading(false)
        if (operationId) void window.electronAPI.updateOperation(operationId, { status: 'succeeded', stage: 'completed', progress: 100, result: { docType, wordCount: countEffectiveWords(accumulated) } })
        return
      }

      // 流式失败自动降级非流式，保留同一条对话占位消息。
      console.warn('[ProjectView] 流式生成失败，降级非流式:', streamable.error)
      setProgressStage('generating')
      const result = await callAI(aiCfg, aiMessages, {
        mode,
        projectName: currentProject?.name,
        dataToolIds,
        reportPeriod: needsReportPeriod ? reportPeriod || undefined : undefined,
      })
      if (!result.success) throw new Error(result.error || 'AI 调用失败')

      // v1.3.1：非流式降级路径统一用 sanitizeFullPipeline（原分散调用，与流式路径对齐）
      const nonStreamSanitized = sanitizeFullPipeline(result.content || '', {
        docType: docType || '通用文档',
        holidayType,
        sourceText: trimmedInput,
        isDocMode: mode === 'DOC' || mode === 'HYBRID',
      })
      let aiContent = nonStreamSanitized.content
      aiContent = mergeResolvedFields(aiContent, generationFieldPlan)
      if (nonStreamSanitized.warnings.length > 0) {
        message.warning(`⚠️ ${nonStreamSanitized.warnings.join('；')}，已替换为占位符请补充`, 5)
      }
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: aiContent } : m))

      // v1.2.0：AI 扩写字数软警告（与流式路径同源，老板 2026-06-27 反馈内容过简）
      if (mode === 'DOC' || mode === 'HYBRID') {
        const wordCount = countEffectiveWords(aiContent)
        const minWords = Math.max(getMinWordCount(docType || ''), getDocumentRuleMinWords(docType || '', projectConfig.documentRules))
        if (wordCount < minWords) message.warning(`⚠️ AI 仅输出 ${wordCount} 字（要求 ≥ ${minWords} 字），建议补充现场事实后重新生成`, 6)
      }

      // v1.3.1：sanitizeFieldValue + sanitizeLetterStyle + 日志参与者已由 sanitizeFullPipeline 统一处理
      if (mode === 'DOC' || mode === 'HYBRID') {
        const validation = validateGeneratedOutput(docType || '通用文档', aiContent, generationTemplateFields)
        if (!validation.valid) throw new Error(`生成结果验收未通过：${validation.error}`)
        if (validation.missing?.length) message.warning(`以下字段尚未取得明确事实，已保留生成结果，可在保存前补充：${validation.missing.join('、')}`, 6)
        const quality = await window.electronAPI.scoreDocumentQuality(docType || '通用文档', aiContent)
        if (quality.quality && !quality.quality.passed) message.warning(`文档质量评分 ${quality.quality.score}，建议检查后再保存`)
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: aiContent } : m))
      }

      if (mode === 'DOC' || mode === 'HYBRID') {
        setProgressStage('processing')
        setPreviewContent({ docType: docType || '通用文档', content: aiContent, userInput: trimmedInput, meta: { fieldPlan: generationFieldPlan } })
        setSavedPath('')
      } else if (mode === 'DATA_QUERY' && currentProject && dataToolIds?.length) {
        setPreviewContent(null)
        setSavedPath('')
        try {
          const raw = await window.electronAPI.dataQuery({
            projectName: currentProject.name,
              toolIds: dataToolIds,
              reportPeriod: needsReportPeriod ? reportPeriod || undefined : undefined,
          })
          if (raw && Object.keys(raw).length > 0) {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, rawData: raw } : m))
          }
        } catch (e) {
          console.warn('[ProjectView] dataQuery failed:', e)
        }
      } else {
        setPreviewContent(null)
        setSavedPath('')
      }
      setProgressStage('')
      if (operationId) void window.electronAPI.updateOperation(operationId, { status: 'succeeded', stage: 'completed', progress: 100, result: { docType, wordCount: countEffectiveWords(aiContent) } })

    } catch (e: any) {
      setProgressStage('')
      const errorText = e.message || '处理失败，请检查网络和 API Key'
      setMessages(prev => prev.map(item => item.id === assistantId ? { ...item, content: `生成失败：${errorText}` } : item))
      message.error(errorText)
      if (operationId) {
        void window.electronAPI.updateOperation(operationId, { status: 'failed', stage: progressStage || 'unknown', progress: 100, retryable: true, error: errorText })
        void window.electronAPI.appendDiagnostic({ taskId: operationId, level: 'error', stage: progressStage || 'generation', message: errorText })
      }
    }

    setAttachedItems([])
    setLoading(false)
  }, [input, loading, apiReady, currentProject, projectConfig, messages, activeDocumentType, attachedItems, reportPeriod, generationTemplates, selectedGenerationTemplateId, location.pathname, location.search, navigate])

  // 保存文档
  const handleSave = async () => {
    if (!currentProject || !previewContent) {
      message.error('没有可保存的内容')
      return
    }

    setGenerating(true)
    try {
      const { docType } = previewContent
      // 编辑模式下使用编辑后的内容
      // 校准声明仅用于界面说明，绝不能落入正式文书或计入字数。
      const content = stripCalibrationStatement(editMode ? editableContent : previewContent.content)
      const subject = extractSubject(previewContent.userInput || lastInput)
      // 预览用的文件名（前端也展示给老板看）
      const fileNameInfo = await generateFileName(docType, currentProject.name, subject || docType)
      const fileName = fileNameInfo.fileName

      // 直接保存到默认路径（IPC 端按虚竹 v2.0 重新生成标准文件名+路径）
      const result = await window.electronAPI.saveDoc({
        projectPath: currentProject.path,
        content: content,
        docType: docType,
        projectName: currentProject.name,
        userInput: subject,
        customSummary: subject || docType,
        meta: previewContent.meta,
      })

      if (result.success) {
        const savedFilePath = result.path || (result.subDir && result.fileName ? `${currentProject.path}/${result.subDir}/${result.fileName}` : `${currentProject.path}/${fileNameInfo.subDir || ''}/${fileName}`)
        message.success(`文档已保存：${result.fileName || fileName}`)
        setSavedPath(savedFilePath)
        setEditMode(false)
        if (settings.autoOpenFile && result.path) {
          window.electronAPI.openFile(result.path)
        }
      } else {
        message.error('保存失败：' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
    setGenerating(false)
  }

  // 流式输出期间只在用户仍停留于底部时跟随。直接设置 scrollTop，避免每个
  // 文本帧都叠加一轮 smooth-scroll 动画而造成上下抽动；用户向上阅读后不抢滚动位置。
  useEffect(() => {
    if (!autoFollowOutputRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const pane = outputScrollRef.current
      if (pane) pane.scrollTop = pane.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages])

  const handleFileClick = (path: string) => {
    if (!apiReady || !window.electronAPI) return
    window.electronAPI.openFile(path)
  }

  const handleFileDelete = async (filePath: string): Promise<boolean> => {
    if (!window.electronAPI) return false
    try {
      const result = await window.electronAPI.deleteFile(filePath)
      if (result.success) {
        // 刷新目录树
        if (currentProject?.path) loadDirTree(currentProject.path)
        return true
      }
      message.error('删除失败：' + (result.error || '未知错误'))
      return false
    } catch (e: any) {
      message.error('删除失败：' + (e?.message || '未知错误'))
      return false
    }
  }

  if (!currentProject) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Text type="secondary">请先选择一个项目</Text>
      </div>
    )
  }

  if (!apiReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin tip="正在加载项目..." />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="ai-workbench" style={{ display: 'flex', height: '100%', gap: 0, overflow: 'hidden' }}>
      {/* 左侧：项目目录树（全高，可拖拽调整宽度） */}
      <div style={{
        width: treeWidth,
        flexShrink: 0,
        background: '#fafafa',
        borderRight: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}>
        {/* 树头部 */}
        <div className="ai-output-toolbar" style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Space size={4}>
            <FolderOpenOutlined style={{ color: '#1677ff', fontSize: 13 }} />
            <Text strong ellipsis style={{ fontSize: 12, maxWidth: 160 }}>
              {currentProject?.name || '未选定项目'}
            </Text>
          </Space>
          <Space size={2}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => currentProject?.path && loadDirTree(currentProject.path)}
              title="刷新"
            />
          </Space>
        </div>

        {/* 树主体 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {dirTree ? (
            <DirTree
              dirTree={dirTree}
              onFileClick={handleFileClick}
              onFileDelete={handleFileDelete}
              onRefresh={() => currentProject?.path && loadDirTree(currentProject.path)}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
              <Spin size="small" />
              <div style={{ fontSize: 12, marginTop: 8 }}>加载中...</div>
            </div>
          )}
        </div>

        {/* 树底部 */}
        <div style={{
          padding: '4px 12px',
          borderTop: '1px solid #e8e8e8',
          flexShrink: 0,
        }}>
          <Button
            type="text"
            size="small"
            icon={<HomeOutlined />}
            onClick={() => navigate('/')}
            style={{ fontSize: 11, color: '#888', width: '100%', textAlign: 'left', height: 26 }}
          >
            返回控制台
          </Button>
        </div>
      </div>

      {/* 拖拽手柄：目录树 ↔ AI聊天 */}
      <div
        onMouseDown={handleResizeStart('tree')}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: 'transparent',
          flexShrink: 0,
          position: 'relative',
          zIndex: 5,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          left: 2,
          width: 1,
          background: '#e8e8e8',
        }} />
      </div>

      {/* 中间：AI 聊天 */}
      <div
        className="ai-output-pane"
        style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', position: 'relative' }}
        onDragEnter={(event) => { event.preventDefault(); setImageDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setImageDragging(false) }}
        onDrop={handleImageDrop}
      >
        {imageDragging && (
          <div style={{ position: 'absolute', inset: 8, zIndex: 30, display: 'grid', placeItems: 'center', border: '2px dashed #1677ff', borderRadius: 12, background: 'rgba(230,244,255,.96)', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: '#1677ff' }}><InboxOutlined style={{ fontSize: 34 }} /><div style={{ marginTop: 8, fontWeight: 600 }}>松开即可识别现场图片</div><div style={{ marginTop: 4, fontSize: 12 }}>最多同时识别 6 张</div></div>
          </div>
        )}
        {/* 聊天头部 — 模式感知 */}
        <div className="ai-output-toolbar" style={{
          padding: '8px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}>
          <span className="ai-output-icon"><RobotOutlined /></span>
          <Text strong className="ai-output-title" style={{ fontSize: 14 }}>AI 扩写结果</Text>
          {loading && <span className="ai-stream-status"><span className="ai-live-dot" />正在生成…</span>}
          {/* 项目选择器：决定所有 AI 辅助的工作项目 */}
          <Select
            size="small"
            value={currentProject?.path || undefined}
            placeholder="选定项目"
            className="ai-project-selector"
            style={{ minWidth: 120, width: 220, maxWidth: '100%' }}
            onChange={(path) => {
              const proj = projects.find(p => p.path === path)
              if (proj) setCurrentProject(proj)
            }}
            popupMatchSelectWidth={false}
            dropdownStyle={{ minWidth: 220 }}
            suffixIcon={<FolderOpenOutlined style={{ fontSize: 11 }} />}
          >
            {projects.map(p => (
              <Select.Option key={p.path} value={p.path}>
                <Space size={4}>
                  <FolderOpenOutlined style={{ fontSize: 11, color: currentProject?.path === p.path ? '#1677ff' : '#999' }} />
                  <span style={{ fontSize: 12 }}>{p.name}</span>
                </Space>
              </Select.Option>
            ))}
            {projects.length === 0 && (
              <Select.Option key="__empty__" value="__empty__" disabled>
                <span style={{ fontSize: 12, color: '#999' }}>暂无项目（先到首页创建）</span>
              </Select.Option>
            )}
          </Select>
          {currentProject && (
            <Tag color="#1677ff" style={{ fontSize: 10, lineHeight: '18px', height: 20, margin: 0, borderRadius: 10 }}>
              ✓ 当前
            </Tag>
          )}
          {loading && progressStage && (
            <Tag style={{ fontSize: 10, lineHeight: '18px', height: 20, margin: 0, borderRadius: 10, background: '#fff7e6', border: '1px solid #ffd591', color: '#d46b08' }}>
              {progressStage === 'analyzing' ? '分析中' : progressStage === 'generating' ? '生成中' : '处理中'}
            </Tag>
          )}
          <div className="ai-output-toolbar-spacer" />
          <div className="ai-output-actions">
            {loading && <Button size="small" onClick={stopStreaming}>停止生成</Button>}
            <Button size="small" icon={<HistoryOutlined />} onClick={() => { setSessionModalOpen(true); void loadChatSessions('') }}>会话</Button>
            <Button size="small" onClick={copyLatestAssistant}>复制</Button>
            <Button size="small" className="ai-apply-button" disabled={!previewContent} onClick={handleSave}>应用到文档</Button>
          </div>
        </div>

        <Modal title="项目会话" open={sessionModalOpen} onCancel={() => setSessionModalOpen(false)} footer={null} width={620}>
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}><Input.Search value={sessionQuery} onChange={event => setSessionQuery(event.target.value)} onSearch={loadChatSessions} placeholder="搜索会话标题或内容" /><Button type="primary" icon={<PlusOutlined />} onClick={createSession}>新会话</Button></Space.Compact>
          <List dataSource={chatSessions} locale={{ emptyText: '暂无会话' }} renderItem={session => <List.Item actions={[<Button key="open" type="link" onClick={() => openSession(session.id)}>打开</Button>, <Button key="archive" type="link" danger onClick={async () => { if (!currentProject) return; await window.electronAPI.archiveChatSession(currentProject.path, session.id, !session.archived); await loadChatSessions() }}>{session.archived ? '恢复' : '归档'}</Button>]}>
            <List.Item.Meta title={<Space>{session.title}{session.id === activeSessionId && <Tag color="blue">当前</Tag>}{session.archived && <Tag>已归档</Tag>}</Space>} description={`${session.messageCount} 条消息 · ${session.preview || '暂无内容'} · ${new Date(session.updatedAt).toLocaleString()}`} />
          </List.Item>} />
        </Modal>

        {/* 消息区域 */}
        <div
          ref={outputScrollRef}
          className="ai-output-scroll"
          style={{ flex: 1, overflow: 'auto', padding: 20 }}
          onScroll={(event) => {
            const pane = event.currentTarget
            autoFollowOutputRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 72
          }}
        >
          {messages.length === 0 && !loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
              <RobotOutlined style={{ fontSize: 36, marginBottom: 12, color: '#d9d9d9' }} />
              <div style={{ fontSize: 13, marginBottom: 4, color: '#999' }}>AI 助手</div>
              <div style={{ fontSize: 11, lineHeight: 1.8, color: '#bbb' }}>
                📊 查数据 · 📖 问规范 · 📄 写文档
              </div>
              <div style={{ fontSize: 11, color: '#ccc', marginTop: 4 }}>
                仅查询当前项目：「{currentProject?.name || '—'}」
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div className={msg.role === 'user' ? 'ai-question-output' : 'ai-document-output'}>
                  {msg.imagePaths && msg.imagePaths.length > 0 && (
                    <div className="ai-chat-image-grid">
                      {msg.imagePaths.map((imagePath, index) => (
                        <button
                          type="button"
                          className="ai-chat-image"
                          key={`${imagePath}_${index}`}
                          onClick={() => window.electronAPI.openFile(imagePath)}
                          title="点击打开原图"
                        >
                          <img src={localImageUrl(imagePath)} alt={`现场图片 ${index + 1}`} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    style={{ fontSize: 14, lineHeight: 1.9 }}
                  />
                  {loading && msg.id === [...messages].reverse().find(item => item.role === 'assistant')?.id && <span className="ai-stream-cursor" />}
                  {msg.rawData && (
                    <div style={{ marginTop: 12 }}>
                      <DataPreviewTable data={msg.rawData} />
                    </div>
                  )}
                  {msg.actions && msg.actions.length > 0 && (
                    <Space wrap style={{ marginTop: 12 }}>
                      {msg.actions.map(action => (
                        <Button key={action.key} size="small" type={action.key === 'correction' ? 'primary' : 'default'} onClick={() => handleImageDocumentAction(msg, action.key)}>
                          {action.label}
                        </Button>
                      ))}
                    </Space>
                  )}
                </div>
                {msg.docType && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
                    文档类型：{msg.docType}
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div style={{ textAlign: 'center', padding: '16px 16px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 6 }}>
                {[
                  { key: 'analyzing', label: '分析输入' },
                  { key: 'generating', label: 'AI 生成' },
                  { key: 'processing', label: '处理结果' },
                ].map((step, idx) => {
                  const currentIdx = ['analyzing', 'generating', 'processing'].indexOf(progressStage || '')
                  const stepIdx = idx
                  const done = currentIdx > stepIdx
                  const active = currentIdx === stepIdx
                  return (
                    <React.Fragment key={step.key}>
                      {idx > 0 && (
                        <div style={{
                          width: 20,
                          height: 1,
                          background: done ? '#1677ff' : '#e8e8e8',
                          margin: '0 4px',
                        }} />
                      )}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: done ? '#1677ff' : active ? '#1677ff' : '#bbb',
                        fontWeight: active ? 600 : done ? 500 : 400,
                      }}>
                        <div style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 9,
                          fontWeight: 600,
                          background: done ? '#1677ff' : active ? '#e6f4ff' : '#f5f5f5',
                          color: done ? '#fff' : active ? '#1677ff' : '#bbb',
                          border: active ? '1px solid #1677ff' : '1px solid transparent',
                        }}>
                          {done ? '✓' : idx + 1}
                        </div>
                        {step.label}
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
              <Spin size="small" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 中间输入区：资料、文种和发送操作集中在 AI 结果下方 */}
        <div style={{
          padding: '10px 14px 12px',
          borderTop: '1px solid #f0f0f0',
          background: '#f7f9fc',
        }}>
          {/* 附件项目展示条 */}
          {attachedItems.some(item => !isImagePath(item.path)) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {attachedItems.map((item, i) => !isImagePath(item.path) && (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px',
                  background: item.type === 'folder' ? '#f0f5ff' : '#fff7e6',
                  borderRadius: 4,
                  border: item.type === 'folder' ? '1px solid #d6e4ff' : '1px solid #ffd591',
                  fontSize: 11,
                  maxWidth: '100%',
                }}>
                  {item.type === 'folder' ? (
                    <FolderOpenOutlined style={{ color: '#1677ff', fontSize: 11, flexShrink: 0 }} />
                  ) : (
                    <FileTextOutlined style={{ color: '#fa8c16', fontSize: 11, flexShrink: 0 }} />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, color: '#333' }}>
                    {item.path}
                  </span>
                  <CloseOutlined
                    onClick={() => setAttachedItems(prev => prev.filter((_, j) => j !== i))}
                    style={{ color: '#999', cursor: 'pointer', fontSize: 10, flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{
            background: '#fff',
            border: '1px solid #e4e9f0',
            borderRadius: 12,
            padding: '7px 8px',
            transition: 'border-color 0.2s',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#91caff' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e4e9f0' }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', minWidth: 0 }}>
              <Tooltip title={activeDocumentType ? `当前模板：${activeDocumentType}，点击更换` : '选择生成模板'}>
                <Button
                  size="small"
                  type={activeDocumentType ? 'default' : 'dashed'}
                  icon={<BookOutlined />}
                  onClick={() => { setRightPanelTab('templates'); setRightPanelCollapsed(false) }}
                  aria-label={activeDocumentType ? `当前模板：${activeDocumentType}，点击更换` : '选择模板'}
                  style={{
                    height: 32,
                    maxWidth: 154,
                    flexShrink: 1,
                    borderRadius: 8,
                    color: activeDocumentType ? '#1677ff' : '#64748b',
                    borderColor: activeDocumentType ? '#bae0ff' : '#d9d9d9',
                    background: activeDocumentType ? '#f0f7ff' : '#fff',
                    paddingInline: 9,
                  }}
                >
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeDocumentType || '选择模板'}
                  </span>
                </Button>
              </Tooltip>
              <TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={recognizingImages ? '正在识别图片…' : getTemplateInputPlaceholder(activeDocumentType)}
                disabled={recognizingImages}
                autoSize={{ minRows: 1, maxRows: 4 }}
                variant="borderless"
                aria-label="文档生成要求"
                style={{ fontSize: 13, padding: '5px 4px', resize: 'none', minWidth: 80 }}
              />
              <Dropdown menu={{ items: [{ key: 'folder', icon: <FolderOpenOutlined />, label: '选择文件夹' }, { key: 'file', icon: <FileTextOutlined />, label: '选择文件' }], onClick: ({ key }) => { if (key === 'folder') handleAttachFolder(); else handleAttachFiles() } }} trigger={['click']}>
                <Button icon={<FolderOpenOutlined />} title="选择文件或文件夹" style={{ height: 32, width: 32, borderRadius: 7, flexShrink: 0, color: attachedItems.length > 0 ? '#1677ff' : '#94a3b8', border: 'none', background: 'transparent', fontSize: 14 }} />
              </Dropdown>
              <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading} style={{ height: 32, minWidth: 68, borderRadius: 7, flexShrink: 0, fontSize: 13 }}>发送</Button>
            </div>
          </div>
        </div>
      </div>

      {/* 拖拽手柄：AI聊天 ↔ 预览 */}
      {!rightPanelCollapsed && <div
        onMouseDown={handleResizeStart('preview')}
        style={{
          width: 5,
          cursor: 'col-resize',
          background: 'transparent',
          flexShrink: 0,
          position: 'relative',
          zIndex: 5,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          left: 2,
          width: 1,
          background: '#e8e8e8',
        }} />
      </div>}

      {/* 右侧：文档预览 / 模板资源 */}
      <div style={{
        width: rightPanelCollapsed ? 42 : previewWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fbfaf7',
        transition: 'width .2s ease',
      }}>
        {/* 右侧面板头部 — 标签切换 */}
        <div style={{
          padding: '0',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'stretch',
          flexShrink: 0,
        }}>
          {!rightPanelCollapsed && <div
            onClick={() => setRightPanelTab('preview')}
            style={{
              flex: 1,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: rightPanelTab === 'preview' ? '2px solid #43836a' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: rightPanelTab === 'preview' ? '#f3f8f4' : 'transparent',
              transition: 'all 0.2s',
            }}
          >
            <FilePdfOutlined style={{ color: rightPanelTab === 'preview' ? '#43836a' : '#999', fontSize: 13 }} />
            <Text style={{ fontSize: 12, fontWeight: rightPanelTab === 'preview' ? 600 : 400, color: rightPanelTab === 'preview' ? '#356e58' : '#666' }}>
              文档预览
            </Text>
          </div>}
          {!rightPanelCollapsed && <div
            onClick={() => setRightPanelTab('templates')}
            style={{
              flex: 1,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: rightPanelTab === 'templates' ? '2px solid #43836a' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: rightPanelTab === 'templates' ? '#f3f8f4' : 'transparent',
              transition: 'all 0.2s',
            }}
          >
            <BookOutlined style={{ color: rightPanelTab === 'templates' ? '#43836a' : '#999', fontSize: 13 }} />
            <Text style={{ fontSize: 12, fontWeight: rightPanelTab === 'templates' ? 600 : 400, color: rightPanelTab === 'templates' ? '#356e58' : '#666' }}>
              模板资源
            </Text>
          </div>}
          <Button type="text" size="small" onClick={() => setRightPanelCollapsed(value => !value)} title={rightPanelCollapsed ? '展开右侧面板' : '收起右侧面板'} style={{ width: 40, height: 38, color: '#777' }}>
            {rightPanelCollapsed ? '‹' : '›'}
          </Button>
        </div>

        {!rightPanelCollapsed && activeDocumentType && (activeDocumentType === '监理周报' || activeDocumentType === '监理月报') && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #edf1f5', background: '#fafcff' }}>
            <Text strong style={{ fontSize: 12 }}>报告期数据</Text>
            <DatePicker.RangePicker
              size="small"
              allowClear={false}
              value={reportPeriod ? [dayjs(reportPeriod.start), dayjs(reportPeriod.end)] : undefined}
              onChange={(dates) => {
                if (dates?.[0] && dates?.[1]) setReportPeriod({ start: dates[0].format('YYYY-MM-DD'), end: dates[1].format('YYYY-MM-DD') })
              }}
              style={{ width: '100%', marginTop: 6 }}
            />
            <Text type="secondary" style={{ display: 'block', fontSize: 10, lineHeight: 1.45, marginTop: 5 }}>仅把该期间内已确认的进度、隐患、函件、影像带入生成；请先在进度台账确认导入结果。</Text>
          </div>
        )}

        {/* 内容区 */}
        {!rightPanelCollapsed && <div style={{ flex: 1, overflow: 'auto' }}>
          {rightPanelTab === 'preview' ? (
            /* ===== 文档预览 ===== */
            <>
              <div style={{
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
                flexShrink: 0,
                borderBottom: '1px solid #f5f5f5',
              }}>
                <Space size={4} style={{ flexWrap: 'wrap', rowGap: 4 }}>
                  {previewContent && (
                    <Text style={{ fontSize: 12, color: '#888' }}>{previewContent.docType}</Text>
                  )}
                  {previewContent && (() => {
                    const msgWordCount = (() => {
                      // 从最后一条 assistant 消息拿 wordCount（流式实时更新）
                      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
                      return lastAssistant?.wordCount ?? countEffectiveWords(previewContent.content)
                    })()
                    const minWords = Math.max(getMinWordCount(previewContent.docType), getDocumentRuleMinWords(previewContent.docType, projectConfig.documentRules))
                    const ok = msgWordCount >= minWords
                    return (
                      <Tag
                        color={ok ? 'success' : 'warning'}
                        style={{ fontSize: 11, lineHeight: '18px', marginLeft: 8 }}
                        title={`当前 ${msgWordCount} 字${minWords > 0 ? `，要求 ≥ ${minWords} 字` : ''}`}
                      >
                        {ok ? `✓ ${msgWordCount}` : `${msgWordCount}/${minWords} 建议`}
                      </Tag>
                    )
                  })()}
                </Space>
                <Space size={4}>
                  {previewContent && (
                    <>
                      <Button
                        size="small"
                        type="text"
                        icon={editMode ? <CloseOutlined /> : <EditOutlined />}
                        onClick={() => {
                          if (editMode) {
                            setEditMode(false)
                          } else {
                            setEditableContent(previewContent.content)
                            setEditMode(true)
                          }
                        }}
                        style={{ fontSize: 12 }}
                      >
                        {editMode ? '取消' : '编辑'}
                      </Button>
                      {previewContent && (() => {
                        const msgWordCount = (() => {
                          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
                          return lastAssistant?.wordCount ?? countEffectiveWords(previewContent.content)
                        })()
                        const minWords = Math.max(getMinWordCount(previewContent.docType), getDocumentRuleMinWords(previewContent.docType, projectConfig.documentRules))
                        const insufficient = minWords > 0 && msgWordCount < minWords
                        return (
                          <Tooltip title={insufficient ? `当前 ${msgWordCount} 字，建议 ${minWords} 字；可先保存，或在编辑中补充。` : undefined}>
                            <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave} loading={generating}>
                              {generating ? '保存中...' : '保存'}
                            </Button>
                          </Tooltip>
                        )
                      })()}
                      <Button
                        size="small"
                        type="text"
                        icon={<EyeOutlined />}
                        title="保存到临时目录并用本地办公软件打开预览"
                        loading={generating}
                        onClick={async () => {
                          if (!currentProject || !previewContent) return
                          const { docType } = previewContent
                          const content = stripCalibrationStatement(editMode ? editableContent : previewContent.content)
                          const subject = extractSubject(previewContent.userInput || lastInput)
                          // 走虚竹 v2.0 文件名
                          const fileNameInfo = await generateFileName(docType, currentProject.name, subject || docType)
                          // 预览版加 .preview 后缀（v1.1.1 修复：不再走 __preview__/ 子目录，直接放正式目录让老板能看到）
                          const previewFileName = fileNameInfo.fileName.replace(/\.docx$/, '.preview.docx')
                          setGenerating(true)
                          try {
                            const result = await window.electronAPI.saveDoc({
                              projectPath: currentProject.path,
                              subDir: fileNameInfo.subDir || getDocSavePath(docType),
                              fileName: previewFileName,
                              content,
                              docType,
                              projectName: currentProject.name,
                              userInput: previewContent.userInput || lastInput,
                              preview: true,
                            })
                            if (result.success && result.path) {
                              window.electronAPI.openFile(result.path)
                              message.success('已在本地办公软件打开预览版（文件名带 .preview 后缀）')
                            } else {
                              message.error('保存失败：' + (result.error || '未知错误'))
                            }
                          } catch (e: any) {
                            message.error('预览失败：' + (e?.message || '未知错误'))
                          } finally {
                            setGenerating(false)
                          }
                        }}
                      >
                        预览
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        icon={<FilePdfOutlined />}
                        onClick={async () => {
                          if (!currentProject || !previewContent) return
                          const content = editMode ? editableContent : previewContent.content
                          const subject = extractSubject(previewContent.userInput || lastInput)
                          const fileNameInfo = await generateFileName(previewContent.docType, currentProject.name, subject || previewContent.docType)
                          const fileName = fileNameInfo.fileName
                          const subDir = fileNameInfo.subDir || getDocSavePath(previewContent.docType)
                          setGenerating(true)
                          try {
                            const result = await window.electronAPI.exportPDF({
                              projectPath: currentProject.path,
                              subDir,
                              fileName,
                              content,
                              docType: previewContent.docType,
                              projectName: currentProject.name,
                              userInput: subject,
                              customSummary: subject,
                            })
                            if (result.success) {
                              message.success('PDF 已导出')
                              if (result.path) window.electronAPI.openFile(result.path)
                            } else {
                              message.error('导出失败：' + (result.error || '未知错误'))
                            }
                          } catch (e: any) {
                            message.error('导出失败：' + e.message)
                          }
                          setGenerating(false)
                        }}
                        style={{ fontSize: 12 }}
                      >
                        导出 PDF
                      </Button>
                    </>
                  )}
                </Space>
              </div>

              <div style={{ padding: 16 }}>
                {previewContent ? (
                  <>
                    {Array.isArray(previewContent.meta?.fieldPlan) && previewContent.meta.fieldPlan.length > 0 && (() => {
                      const plan = previewContent.meta.fieldPlan as any[]
                      const resolved = plan.filter(item => item.status === 'resolved').length
                      const expanded = plan.filter(item => item.status === 'expand').length
                      const unresolved = plan.filter(item => item.status === 'unresolved').length
                      const manual = plan.filter(item => item.status === 'manual').length
                      return <div style={{ background: '#f6f8fa', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                        <Space size={6} wrap><Text strong style={{ fontSize: 12 }}>字段解析</Text><Tag color="green">自动取得 {resolved}</Tag><Tag color="blue">AI扩写 {expanded}</Tag>{unresolved > 0 && <Tag color="orange">待补充 {unresolved}</Tag>}{manual > 0 && <Tag>人工字段 {manual}</Tag>}</Space>
                        <Text type="secondary" style={{ display: 'block', marginTop: 5, fontSize: 11 }}>普通字段缺失不阻止生成；自动值和用户事实优先，AI仅扩写允许的叙述字段。</Text>
                      </div>
                    })()}
                    {savedPath && (
                      <div style={{
                        background: '#f6ffed',
                        borderRadius: 6,
                        padding: '8px 12px',
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <span style={{ fontSize: 11, color: '#52c41a', flex: 1, wordBreak: 'break-all' }}>
                          ✓ 已保存
                        </span>
                        <Button
                          size="small"
                          icon={<FolderOpenOutlined />}
                          onClick={() => window.electronAPI?.openFile(savedPath)}
                        >
                          打开文件
                        </Button>
                      </div>
                    )}

                    {/* 编辑模式：TextArea */}
                    {editMode ? (
                      <Input.TextArea
                        value={editableContent}
                        onChange={(e) => setEditableContent(e.target.value)}
                        style={{
                          fontSize: 13,
                          lineHeight: 2,
                          minHeight: 400,
                          fontFamily: 'inherit',
                          padding: 16,
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <DocumentLayoutPreview
                        docType={previewContent.docType}
                        content={previewContent.content}
                        projectName={currentProject?.name || ''}
                        projectConfig={projectConfig}
                      />
                    )}

                    {!editMode && (
                      <div style={{ marginTop: 12, padding: '8px 12px', background: '#f6f8fa', borderRadius: 6, fontSize: 11, color: '#888' }}>
                        此处按系统交付版式展示字段与正文；项目配置中已有的单位、人员和编号会自动回填，未配置的字段保持空白，可在后续编辑时补充。
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
                    <FilePdfOutlined style={{ fontSize: 40, marginBottom: 12, color: '#d9d9d9' }} />
                    <div style={{ fontSize: 13, color: '#999' }}>文档预览</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      数据查询和问答模式下不显示预览
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2, color: '#ccc' }}>
                      输入「出一份整改通知书」等指令生成文档
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ===== 模板资源 ===== */
            <div style={{ padding: 12 }}>
              {/* 搜索框 */}
              <Input
                size="small"
                placeholder="搜索模板..."
                prefix={<SearchOutlined style={{ color: '#bbb' }} />}
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                style={{ marginBottom: 8, borderRadius: 6, fontSize: 12 }}
                allowClear
              />

              {templateLoading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Spin size="small" />
                  <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>加载模板目录...</div>
                </div>
              ) : generationTemplates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
                  <BookOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 8 }} />
                  <div style={{ fontSize: 12, color: '#999' }}>暂无模板资源</div>
                </div>
              ) : (
                <div>
                  {(() => {
                    const keyword = templateSearch.trim().toLowerCase()
                    const currentType = projectConfig.projectType || ''
                    const visible = generationTemplates.filter(item => {
                      const professionalMatch = item.scope !== 'professional'
                        || item.projectType === currentType
                        || item.projectTypeLabel === currentType
                      const searchMatch = !keyword || `${item.name}${item.docType}${item.projectType || ''}`.toLowerCase().includes(keyword)
                      return professionalMatch && searchMatch
                    })
                    const statusPriority: Record<string, number> = { needs_update: 0, missing_file: 0, pending_fields: 1, pending_rules: 1, ready: 2, system: 3 }
                    const sortByStatus = (items: GenerationTemplate[]) => [...items].sort((a, b) => {
                      const aStatus = getTemplateStatusBadge({ ...a, readOnly: a.scope === 'system' })
                      const bStatus = getTemplateStatusBadge({ ...b, readOnly: b.scope === 'system' })
                      return (statusPriority[aStatus.key] ?? 9) - (statusPriority[bStatus.key] ?? 9) || String(a.name || a.docType).localeCompare(String(b.name || b.docType), 'zh-CN')
                    })
                    const groups = [
                      { key: 'personal', label: '私人模板库', items: visible.filter(item => item.scope === 'personal') },
                      { key: 'general', label: '通用模板', items: visible.filter(item => item.scope === 'global' || item.scope === 'system') },
                      { key: 'professional', label: `当前项目模板库${currentType ? ` · ${currentType}` : ''}`, items: visible.filter(item => item.scope === 'professional') },
                      { key: 'other', label: '其他模板', items: visible.filter(item => item.scope === 'other') },
                    ].map(group => ({ ...group, items: sortByStatus(group.items) })).filter(group => group.key === 'personal' || group.items.length)
                    if (!groups.length) return <div style={{ padding: 28, textAlign: 'center', color: '#999', fontSize: 12 }}>没有匹配的模板</div>
                    const treeData = groups.map(group => ({
                      key: `group:${group.key}`,
                      selectable: false,
                      title: <Space size={6}><Text strong style={{ fontSize: 12 }}>{group.label}</Text><Text type="secondary" style={{ fontSize: 10 }}>{group.items.length}</Text></Space>,
                      children: group.items.length ? group.items.map(template => {
                        const badge = getTemplateStatusBadge({ ...template, readOnly: template.scope === 'system' })
                        return ({
                        key: template.id,
                        isLeaf: true,
                        title: <Dropdown
                          trigger={['contextMenu']}
                          menu={{ items: [
                            { key: 'preview', label: '打开模板预览', icon: <EyeOutlined /> },
                            { key: 'rules', label: '进入 AI 扩写规则', icon: <RobotOutlined /> },
                            ...(template.scope !== 'system' ? [{ key: 'delete', label: '移到系统废纸篓', icon: <DeleteOutlined />, danger: true }] : []),
                          ], onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation()
                            if (key === 'preview') window.electronAPI.openTemplatePreview(template.path, template.sourceName || template.name)
                            if (key === 'rules') navigate(buildTemplateRuleEditorUrl({
                              pathname: location.pathname,
                              search: location.search,
                              docType: template.docType,
                              templateId: template.id,
                              input,
                            }))
                            if (key === 'delete') void window.electronAPI.deleteLibraryTemplate(template.id).then(async result => {
                              if (!result.ok) return message.error(result.error || '删除模板失败')
                              if (selectedGenerationTemplateId === template.id) setSelectedGenerationTemplateId('')
                              message.success('模板文件已移到系统废纸篓，可从废纸篓恢复')
                              await loadTemplateCatalog()
                            })
                          } }}
                        >
                          <div onContextMenu={event => event.stopPropagation()} style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
                            <Text ellipsis style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{template.name || template.docType}</Text>
                            <Tag color={badge.color} title={badge.title} style={{ margin: '0 0 0 6px', padding: '0 5px', lineHeight: '17px', height: 18, fontSize: 9, flexShrink: 0 }}>{badge.label}</Tag>
                          </div>
                        </Dropdown>,
                      })}) : [{ key: `empty:${group.key}`, selectable: false, disabled: true, isLeaf: true, title: <Text type="secondary" style={{ fontSize: 11 }}>暂无私人模板，可在模板中心另存</Text> }],
                    }))
                    const badges = visible.map(template => getTemplateStatusBadge({ ...template, readOnly: template.scope === 'system' }))
                    const readyCount = badges.filter(item => item.key === 'ready' || item.key === 'system').length
                    const pendingCount = badges.length - readyCount
                    return <><div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '0 2px 8px', fontSize: 10, color: '#8c8c8c' }}><span>{visible.length} 个模板</span><span>·</span><span style={{ color: '#389e0d' }}>{readyCount} 已就绪</span>{pendingCount > 0 && <><span>·</span><span style={{ color: '#d46b08' }}>{pendingCount} 待处理</span></>}</div><Tree
                      blockNode
                      showLine={{ showLeafIcon: false }}
                      defaultExpandedKeys={[]}
                      selectedKeys={selectedGenerationTemplateId ? [selectedGenerationTemplateId] : []}
                      treeData={treeData}
                      onSelect={keys => {
                        const id = String(keys[0] || '')
                        const template = generationTemplates.find(item => item.id === id)
                        if (template) selectGenerationTemplate(template)
                      }}
                      style={{ fontSize: 12 }}
                    /></>
                  })()}
                  <Button block type="text" size="small" onClick={() => navigate('/template-center')} style={{ marginTop: 6, color: '#64748b' }}>管理模板</Button>
                </div>
              )}
            </div>
          )}
        </div>}
      </div>
    </div>
  )
}

// 模板资源树渲染
const PROJECT_TYPE_COLORS: Record<string, string> = {
  '通用类型模板': '#666',
  '通信工程': '#1677ff',
  '信息化工程': '#52c41a',
  '电力工程': '#fa8c16',
  '监理规划': '#722ed1',
}

// 获取项目类型图标颜色
function getCategoryColor(displayName: string): string {
  for (const [key, color] of Object.entries(PROJECT_TYPE_COLORS)) {
    if (displayName.includes(key)) return color
  }
  return '#666'
}

function renderTemplateNode(
  item: TemplateItem,
  expanded: Set<string>,
  setExpanded: (s: Set<string>) => void,
  search: string,
  depth: number = 0,
) {
  // 搜索过滤
  if (search) {
    const lowerSearch = search.toLowerCase()
    const matches = (item.displayName || item.name).toLowerCase().includes(lowerSearch)
    const childMatches = item.children?.some((c: TemplateItem) => {
      const name = (c.displayName || c.name).toLowerCase()
      return name.includes(lowerSearch)
    })
    if (!matches && !childMatches && item.type === 'item') return null
    if (item.type === 'category' && !matches && !childMatches) {
      // 如果文件夹和子项都不匹配，隐藏
      const allChildrenHidden = item.children?.every((c: TemplateItem) => {
        const name = (c.displayName || c.name).toLowerCase()
        return !name.includes(lowerSearch)
      })
      if (allChildrenHidden) return null
    }
  }

  if (item.type === 'item') {
    return (
      <div
        key={item.path}
        onClick={() => window.electronAPI?.openFile(item.path)}
        style={{
          padding: '5px 8px',
          paddingLeft: 12 + depth * 16,
          cursor: 'pointer',
          borderRadius: 4,
          fontSize: 12,
          color: '#555',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <FileTextOutlined style={{ color: '#1677ff', fontSize: 11, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.displayName || item.name}
        </span>
      </div>
    )
  }

  // category
  const isExpanded = expanded.has(item.path)
  const catColor = getCategoryColor(item.displayName || item.name)
  const displayName = item.displayName || item.name
  const catName = stripLeadingNum(displayName)

  return (
    <div key={item.path}>
      <div
        onClick={() => {
          const next = new Set(expanded)
          if (isExpanded) next.delete(item.path)
          else next.add(item.path)
          setExpanded(next)
        }}
        style={{
          padding: '5px 8px',
          paddingLeft: 8 + depth * 16,
          cursor: 'pointer',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: depth === 0 ? 600 : 500,
          color: depth === 0 ? catColor : '#555',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{
          fontSize: 9,
          color: '#bbb',
          transition: 'transform 0.2s',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}>
          ▶
        </span>
        {depth === 0 ? (
          <BookOutlined style={{ color: catColor, fontSize: 12, flexShrink: 0 }} />
        ) : (
          <FolderOpenOutlined style={{ color: '#bbb', fontSize: 11, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {catName}
        </span>
        {item.docxCount != null && (
          <Tag style={{
            fontSize: 10,
            lineHeight: '16px',
            height: 16,
            padding: '0 5px',
            borderRadius: 8,
            margin: 0,
            border: 'none',
            background: '#f0f0f0',
            color: '#999',
            flexShrink: 0,
          }}>
            {item.docxCount}
          </Tag>
        )}
      </div>
      {isExpanded && item.children && (
        <div>
          {item.children.length > 0 ? (
            item.children.map((child: TemplateItem) => renderTemplateNode(child, expanded, setExpanded, search, depth + 1))
          ) : (
            <div style={{ padding: '8px 12px', paddingLeft: 12 + depth * 16, fontSize: 12, color: '#bbb', fontStyle: 'italic' }}>
              暂无模板，可上传
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 去掉末尾的编号后缀（如 "18_通信工程" → 仅用于 Tree 展示）
function stripLeadingNum(name: string): string {
  return name.replace(/^\d+_/, '')
}

// 只有模板字段可分段；正文里的【依据：…】、【注意】等是正文内容的一部分。
// 这与主进程的模板填充规则保持一致，避免右侧预览和实际 Word 出现不同结果。
function parsePreviewSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const knownKeys = new Set(['项目名称', '文件编号', '致单位', '事由', '主题', '正文内容', '正文', '内容'])
  const markers = [...String(content || '').matchAll(/【([^】]+)】/g)]
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    const key = marker[1].trim()
    if (!knownKeys.has(key)) continue
    const nextField = markers.slice(index + 1).find(item => knownKeys.has(item[1].trim()))
    const end = nextField ? nextField.index : content.length
    const value = content.slice(marker.index! + marker[0].length, end).trim()
    if (value) sections[key] = value
  }
  return sections
}

function DocumentLayoutPreview({ docType, content, projectName, projectConfig }: { docType: string; content: string; projectName: string; projectConfig: { ownerUnit?: string; contractor?: string; supervisorUnit?: string; chiefEngineer?: string } }) {
  const sections = parsePreviewSections(content)
  const field = (...keys: string[]) => keys.map(key => sections[key]).find(value => value) || ''
  const meta = docType === '监理周报' || docType === '监理月报'
    ? [['项目名称', projectName], ['建设单位', projectConfig.ownerUnit || ''], ['施工单位', projectConfig.contractor || ''], ['监理单位', projectConfig.supervisorUnit || ''], ['总监理工程师', projectConfig.chiefEngineer || '']]
    : [['项目名称', projectName], ['文件编号', field('文件编号')], ['致单位', field('致单位') || projectConfig.contractor || ''], ['事由', field('事由', '主题')]]
  const body = field('正文内容', '内容', '正文') || content.replace(/【[^】]+】/g, '').trim()
  const displayValue = (value: string) => value && !/(数据待核对|签发前请核对)/.test(value) ? value : ''
  return <div style={{ background: '#fff', border: '1px solid #e1e7ef', borderRadius: 8, minHeight: 300, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15, 23, 42, .03)' }}>
    <div style={{ padding: '20px 20px 12px', textAlign: 'center', fontSize: 18, fontWeight: 700, letterSpacing: 3, color: '#1f2937' }}>{docType === '整改通知书' ? '监 理 整 改 通 知 书' : docType === '安全通知书' ? '监 理 安 全 通 知 书' : docType}</div>
    <div style={{ margin: '0 20px', display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', border: '1px solid #dfe5ed', fontSize: 12 }}>
      {meta.flatMap(([label, value]) => [<div key={`${label}-label`} style={{ padding: '7px 8px', background: '#f7f9fc', borderBottom: '1px solid #e8edf3', color: '#64748b', fontWeight: 600 }}>{label}</div>, <div key={`${label}-value`} style={{ padding: '7px 9px', borderBottom: '1px solid #e8edf3', color: value ? '#334155' : '#9aa7b8' }}>{displayValue(value)}</div>])}
    </div>
    <div style={{ padding: '16px 20px 22px', fontSize: 13, lineHeight: 2, color: '#374151', whiteSpace: 'pre-wrap' }}>{body || '待补充正文内容'}</div>
  </div>
}

/** 轻量 Markdown 渲染 — 将 **粗体**、`代码` 转为 HTML */
function renderMarkdown(text: string): string {
  // 转义 HTML 特殊字符
  let s = stripThinkingContent(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // **粗体**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // `行内代码`
  s = s.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;font-family:inherit">$1</code>')
  // 换行
  s = s.replace(/\n/g, '<br>')
  return s
}

/** 将 DirTree 节点展平为文件路径列表（相对路径） */
function flattenFileTree(node: any): string[] {
  const result: string[] = []
  function walk(n: any, prefix: string) {
    if (!n) return
    if (n.type === 'file') {
      result.push(prefix + n.name)
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child, prefix + (n.name || '') + '/')
      }
    }
  }
  walk(node, '')
  return result
}

// 数据看板 — 将 dataTools 返回的结构化数据渲染为可读表格
function DataPreviewTable({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data)

  if (entries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
        <div style={{ fontSize: 12 }}>暂无数据</div>
      </div>
    )
  }

  return (
    <div>
      {entries.map(([toolId, toolData]) => {
        if (!toolData || typeof toolData !== 'object') return null
        const toolLabel = toolId
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())

        // 提取非数组的摘要字段
        const summaryFields = Object.entries(toolData).filter(
          ([k, v]) => !Array.isArray(v) && typeof v !== 'object'
        )

        // 提取数组详情
        const detailArrays = Object.entries(toolData).filter(
          ([k, v]) => Array.isArray(v) && v.length > 0
        )

        return (
          <div key={toolId} style={{ marginBottom: 16, background: '#fafafa', borderRadius: 8, padding: 12, border: '1px solid #f0f0f0' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#333', marginBottom: 8 }}>{toolLabel}</div>

            {/* 摘要值 */}
            {summaryFields.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {summaryFields.map(([k, v]) => (
                  <div key={k} style={{
                    background: '#fff',
                    border: '1px solid #e8e8e8',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}>
                    <div style={{ color: '#999', fontSize: 10 }}>{k}</div>
                    <div style={{ color: '#333', fontWeight: 500 }}>{String(v ?? '—')}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 表格详情 */}
            {detailArrays.map(([key, arr]) => {
              if (!Array.isArray(arr) || arr.length === 0) return null
              const columns = Object.keys(arr[0] || {})

              return (
                <div key={key} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{key}</div>
                  <div style={{
                    background: '#fff',
                    borderRadius: 6,
                    border: '1px solid #e8e8e8',
                    overflow: 'hidden',
                    fontSize: 11,
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f6f8fa' }}>
                          {columns.map(col => (
                            <th key={col} style={{
                              padding: '4px 8px',
                              textAlign: 'left',
                              fontWeight: 500,
                              color: '#666',
                              borderBottom: '1px solid #e8e8e8',
                              fontSize: 10,
                              whiteSpace: 'nowrap',
                            }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(arr as any[]).slice(0, 10).map((row, ri) => (
                          <tr key={ri}>
                            {columns.map(col => {
                              const val = row[col]
                              return (
                                <td key={col} style={{
                                  padding: '4px 8px',
                                  borderBottom: ri < arr.length - 1 ? '1px solid #f5f5f5' : 'none',
                                  color: '#555',
                                  fontSize: 10,
                                  maxWidth: 120,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {val === null || val === undefined ? '—' : String(val)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {arr.length > 10 && (
                          <tr>
                            <td colSpan={columns.length} style={{
                              padding: '4px 8px',
                              fontSize: 10,
                              color: '#999',
                              textAlign: 'center',
                            }}>
                              ...还有 {arr.length - 10} 条记录
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

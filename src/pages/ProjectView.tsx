import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Typography, Input, Button, Space, Spin, Modal, Form, Select, Tag, App, Dropdown, Tooltip, Checkbox, Popover } from 'antd'
import { SendOutlined, RobotOutlined, FileTextOutlined, SaveOutlined, ReloadOutlined, FilePdfOutlined, SettingOutlined, FolderOpenOutlined, HomeOutlined, EditOutlined, CloseOutlined, SearchOutlined, BookOutlined, EyeOutlined, ControlOutlined } from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { identifyDocType, identifyMode, buildChatPrompt, inferDataTools, postProcessTimeFields, postProcessFabricationGuard, sanitizeUnsupportedLogParticipants, generateFileName, getDocSavePath, providerConfigs, buildDocPrompt, callAI, extractSubject, stripCalibrationStatement, sanitizeFieldValue, sanitizeLetterStyle } from '../services/aiService'
import { PROJECT_TYPE_OPTIONS, getProjectTypeProfile, normalizeProjectType, normalizeTags } from '../shared/projectProfile.mjs'
import { countEffectiveWords, getMinWordCount } from '../shared/docTypeMinWords'
import { getApplicableRulePacks, getDocumentRuleMinWords, normalizeDocumentRules, RULE_PACKS } from '../shared/documentRules.mjs'
import type { SessionMode } from '../services/aiService'
import DirTree from '../components/DirTree'
import type { DirNode, TemplateItem } from '../vite-env'
import { useElectronAPI } from '../hooks/useElectronAPI'
import ProjectTemplateCenterModal from '../components/ProjectTemplateCenterModal'

const { Text } = Typography
const { TextArea } = Input

const WRITING_DOCUMENT_TYPES = ['监理日志', '监理周报', '监理月报', '整改通知书', '工程联系单']

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  docType?: string
  rawData?: Record<string, any>
  wordCount?: number  // v1.0.0：AI 扩写字数实时统计
  timestamp: Date
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
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [projectConfig, setProjectConfig] = useState<{ contractor: string; ownerUnit: string; supervisorUnit: string; chiefEngineer: string; projectType: string; projectTypeCode?: string; projectTags?: string[]; projectFeatures?: string; projectPhase?: string; documentRules?: { rulePackIds?: string[]; additionalInstruction?: string }; templateOverrides?: Record<string, { path: string; sourceName?: string; updatedAt?: string }>; templateSelections?: Record<string, string | null> }>({
    contractor: '',
    ownerUnit: '',
    supervisorUnit: '',
    chiefEngineer: '',
    projectType: '未分类', projectTypeCode: 'unclassified', projectTags: [], projectFeatures: '', projectPhase: '',
  })
  const [configForm] = Form.useForm()
  const [editMode, setEditMode] = useState(false)
  const [editableContent, setEditableContent] = useState('')
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'templates' | 'rules'>('preview')
  const [activeDocumentType, setActiveDocumentType] = useState<string>()
  const [templateCatalog, setTemplateCatalog] = useState<TemplateItem[]>([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [templateSearch, setTemplateSearch] = useState('')
  const [projectTemplateCenterOpen, setProjectTemplateCenterOpen] = useState(false)
  const [templateLibrary, setTemplateLibrary] = useState<Array<{ id: string; name: string; docType: string; scope: 'global' | 'professional'; projectType: string; sourceName: string; path: string; fields?: string[] }>>([])
  const [treeWidth, setTreeWidth] = useState(260)
  const [previewWidth, setPreviewWidth] = useState(380)
  const [attachedItems, setAttachedItems] = useState<Array<{ type: 'folder' | 'file'; path: string }>>([])
  const [writingSetupOpen, setWritingSetupOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  const selectWritingDocument = (docType: string) => {
    setActiveDocumentType(docType)
    setRightPanelTab('rules')
    setWritingSetupOpen(false)
    setInput(previous => {
      const prefix = `写${docType}：`
      return previous.startsWith('写') && previous.includes('：') ? prefix : previous || prefix
    })
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 0)
  }

  const activeRulePacks = activeDocumentType
    ? getApplicableRulePacks(activeDocumentType, projectConfig.documentRules)
    : []

  const updateRulePack = async (ruleId: string, enabled: boolean) => {
    if (!currentProject) return
    const current = normalizeDocumentRules(projectConfig.documentRules)
    const rulePackIds = enabled
      ? [...new Set([...current.rulePackIds, ruleId])]
      : current.rulePackIds.filter(id => id !== ruleId)
    const next = normalizeDocumentRules({ ...current, rulePackIds })
    const result = await window.electronAPI.saveProjectDocumentRules(currentProject.path, next)
    if (!result.success) {
      message.error(result.error || '规则保存失败')
      return
    }
    setProjectConfig(prev => ({ ...prev, documentRules: result.documentRules }))
  }

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

  // 加载目录树（显示所有项目）
  useEffect(() => {
    if (projectRoot && apiReady) {
      loadDirTree(projectRoot)
    }
  }, [projectRoot, apiReady, loadDirTree])

  // 加载项目配置
  useEffect(() => {
    if (currentProject) {
      loadProjectConfig()
    }
  }, [currentProject, loadProjectConfig])

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

  // 消费 URL ?docType= 参数，预填输入框
  useEffect(() => {
    const docType = searchParams.get('docType')
    const prefill = searchParams.get('input')
    if (prefill) {
      setInput(prefill)
    } else if (docType) {
      const templateDocTypes = ['整改通知书', '安全通知书', '工程联系单', '停工令', '会议纪要', '监理周报', '监理月报', '监理日志']
      if (templateDocTypes.includes(docType)) {
        setInput(`生成一份${docType}`)
      } else {
        setInput(docType)
      }
    }
  }, [searchParams])

  const loadTemplateCatalog = async () => {
    if (!window.electronAPI) return
    setTemplateLoading(true)
    try {
      const catalog = await window.electronAPI.getTemplateCatalog()
      setTemplateCatalog(catalog || [])
    } catch (e) {
      console.error('[ProjectView] Failed to load template catalog:', e)
    }
    setTemplateLoading(false)
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

  const handleSaveConfig = async () => {
    const values = await configForm.validateFields()
    if (!currentProject || !window.electronAPI) return
    try {
      const nextConfig = { ...projectConfig, ...values }
      const result = await window.electronAPI.writeProjectConfig(currentProject.path, nextConfig)
      if (!result || !result.success) {
        message.error('保存失败：' + (result?.error || '服务端返回异常'))
        return
      }
      setProjectConfig(nextConfig)
      setConfigModalOpen(false)
      message.success('项目配置已保存')
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
  }

  const handleAssignProjectTemplate = async (docType: string) => {
    if (!currentProject || !window.electronAPI) return
    const sourcePath = await window.electronAPI.selectTemplateFile()
    if (!sourcePath) return
    const result = await window.electronAPI.assignProjectTemplate(currentProject.path, docType, sourcePath)
    if (!result.success || !result.templateOverride) {
      message.error('模板替换失败：' + (result.error || '未知错误'))
      return
    }
    setProjectConfig(prev => ({
      ...prev,
      templateOverrides: { ...(prev.templateOverrides || {}), [docType]: result.templateOverride! },
    }))
    message.success(`${docType} 已切换为项目专用模板`)
  }

  const loadTemplateLibrary = async () => {
    if (!window.electronAPI) return
    setTemplateLibrary(await window.electronAPI.listTemplateLibrary())
  }

  const handleSelectLibraryTemplate = async (docType: string, templateId: string | null) => {
    if (!currentProject || !window.electronAPI) return
    const result = await window.electronAPI.selectProjectTemplate(currentProject.path, docType, templateId)
    if (!result.success) {
      message.error('模板选择失败：' + (result.error || '未知错误'))
      return
    }
    setProjectConfig(prev => ({ ...prev, templateSelections: { ...(prev.templateSelections || {}), [docType]: templateId } }))
    message.success(templateId ? `${docType} 已选择模板中心版本` : `${docType} 已恢复自动匹配`)
  }

  // 发送消息 — 支持 CHAT / DATA_QUERY / DOC / HYBRID 四模式
  const handleSend = useCallback(async () => {
    if (!apiReady) {
      message.error('系统正在初始化，请稍候...')
      return
    }

    const trimmedInput = input.trim()
    if (!trimmedInput || loading) return

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

    // ==== 照片归档模式（直接调 photo:aiArchive，不走 AI 流）====
    const attachedFolder = attachedItems.find(i => i.type === 'folder')
    if (attachedFolder && (trimmedInput.includes('整理照片') || trimmedInput.includes('照片归档') || trimmedInput.includes('照片存档')) && currentProject) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
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
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content, timestamp: new Date() }])
      } catch (e: any) {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: `❌ 整理出错：${e.message}`, timestamp: new Date() }])
      }
      setAttachedItems([])
      setProgressStage('')
      setLoading(false)
      return
    }

    // ==== 意图分类 ====
    const { mode, docType, dataToolIds } = identifyMode(trimmedInput)
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
      message.warning('请先在“项目配置”中选择项目类型；未分类项目不能生成正式文档', 4)
      setLoading(false)
      setProgressStage('')
      return
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
    const postProcessCtx = { docType: docType || '通用文档', holidayType }
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedInput + (attachedItems.length > 0 ? '\n\n【附件】\n' + attachSummary : ''),
      timestamp: new Date(),
    }])
    setInput('')
    setLoading(true)
    setProgressStage('analyzing')

    // 提前挂一个 assistant 占位消息
    const assistantId = (Date.now() + 1).toString()
    const showDocType = mode === 'DOC' || mode === 'HYBRID' ? docType : undefined
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      docType: showDocType,
      timestamp: new Date(),
    }])

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
        documentRules: projectConfig.documentRules,
      } : undefined

      // ==== 附件信息注入 AI 上下文 ====
      let attachContext = ''
      if (attachedItems.length > 0) {
        const parts: string[] = []
        for (const item of attachedItems) {
          if (item.type === 'folder') {
            try {
              const tree = await window.electronAPI.getDirTree(item.path, 5)
              if (tree) {
                const files = flattenFileTree(tree)
                if (files.length > 0) {
                  parts.push(`【文件夹】${item.path}\n  文件清单：\n${files.map((f, i) => `    ${i + 1}. ${f}`).join('\n')}`)
                } else {
                  parts.push(`【文件夹】${item.path}（空文件夹）`)
                }
              }
            } catch {
              parts.push(`【文件夹】${item.path}（读取失败）`)
            }
          } else {
            // 读取文件内容供 AI 分析
            try {
              const fc = await window.electronAPI.readFileContent(item.path)
              if (fc.success && fc.type === 'text' && fc.content) {
                const note = fc.truncated ? '\n  (内容较长已截断，仅显示前50KB)' : ''
                parts.push(`【文件】${item.path}\n  ---- 文件内容 ----\n${fc.content}${note}`)
              } else if (fc.success && fc.type === 'image') {
                parts.push(`【图片】${item.path}（图片文件，大小：${(fc.size || 0) / 1024 > 1024 ? ((fc.size || 0) / 1024 / 1024).toFixed(1) + 'MB' : ((fc.size || 0) / 1024).toFixed(0) + 'KB'}）`)
              } else {
                parts.push(`【文件】${item.path}（${fc.note || '暂不支持内容解析'}）`)
              }
            } catch {
              parts.push(`【文件】${item.path}（读取失败）`)
            }
          }
        }
        if (parts.length > 0) {
          attachContext = `\n\n【附件内容】\n${parts.join('\n\n')}\n\n请根据以上附件内容给出分析或建议。如果是文件清单，建议每个文件应归档到项目下哪个子目录。`
        }
      }

      // ==== 按模式构建 messages ====
      let aiMessages: { role: string; content: string }[]
      const userContent = attachContext ? trimmedInput + attachContext : trimmedInput
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
            }
          } catch (e) {
            console.warn('[ProjectView] 模板字段契约读取失败，继续使用文种规则:', e)
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

      const aiCfg = {
        provider: currentSettings.aiProvider as any,
        // 不再传 apiKey —— 主进程自己持有（脱敏设计）
        baseUrl: currentSettings.baseUrl,
        model: currentSettings.model,
      }

      // 构造 IPC 参数（apiKey 已在主进程持有，前端不再传入；新签名的 AIOptions 已将 apiKey 改为可选）
      const ipcParams = {
        ...aiCfg,
        mode,
        projectName: currentProject?.name,
        dataToolIds,
        messages: aiMessages,
      }

      // 优先走流式 —— 套 30 秒超时，避免主进程 hang 时 await 永不返回
      const streamable = await Promise.race([
        window.electronAPI.callAIStream(ipcParams),
        new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ success: false, error: '启动 AI 流式超时（30秒）' }), 30000)
        ),
      ])

      if (streamable.success) {
        const { requestId } = streamable
        let accumulated = ''

        let offChunk = () => {}
        let offEnd = () => {}
        let ended = false
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            if (ended) return
            ended = true
            offChunk()
            offEnd()
            aiStreamCleanupRef.current = null
            resolve()
          }
          offChunk = window.electronAPI.onAIStreamChunk((data) => {
            if (data.requestId !== requestId) return
            if (data.type === 'content' && data.content) {
              accumulated += data.content
              setMessages(prev => prev.map(m => m.id === assistantId ? {
                ...m,
                content: accumulated,
                wordCount: countEffectiveWords(accumulated),
              } : m))
            } else if (data.type === 'error') {
              message.error(data.error || 'AI 流式错误')
            }
          })
          offEnd = window.electronAPI.onAIStreamEnd((data) => {
            if (data.requestId !== requestId) return
            cleanup()
          })
          aiStreamCleanupRef.current = cleanup

          // 安全网：5 分钟超时
          setTimeout(() => {
            if (!ended) cleanup()
          }, 300000)
        })

        // 后处理：先跑反编造守门员（捕获原始日期），再处理时间字段占位符
        const guardResult = postProcessFabricationGuard(accumulated)
        if (guardResult.warnings.length > 0) {
          message.warning(`⚠️ ${guardResult.warnings.join('；')}，已替换为占位符请补充`, 5)
        }
        accumulated = stripCalibrationStatement(postProcessTimeFields(guardResult.content, postProcessCtx))
        if (docType === '监理日志') accumulated = sanitizeUnsupportedLogParticipants(accumulated, trimmedInput)

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
              const reRequestId = `retry-${Date.now()}`
              const retryResult = await window.electronAPI.callAIStream({
                ...aiCfg,
                mode: 'CHAT',  // 续写走 CHAT 模式避免再次走 DOC 复杂提示
                projectName: currentProject?.name,
                messages: [
                  ...aiMessages,
                  { role: 'assistant', content: accumulated },
                  { role: 'user', content: extraUserMsg },
                ],
              })
              if (!retryResult.success) {
                console.error('[AI] 续写启动失败:', retryResult.error)
                message.error(`续写启动失败：${retryResult.error || '未知错误'}，当前字数 ${wordCount}/${minWords}`)
              } else if (retryResult.requestId) {
                console.log('[AI] 续写流式已启动 requestId:', retryResult.requestId)
                await new Promise<void>((resolve) => {
                  let retryAcc = ''
                  let retryEnded = false
                  const cleanup = () => { if (retryEnded) return; retryEnded = true; offChunk(); offEnd(); resolve() }
                  const offChunk = window.electronAPI.onAIStreamChunk((d) => {
                    if (d.requestId !== retryResult.requestId) return
                    if (d.type === 'content' && d.content) {
                      retryAcc += d.content
                      const merged = accumulated + '\n' + retryAcc
                      setMessages(prev => prev.map(m => m.id === assistantId ? {
                        ...m,
                        content: merged,
                        wordCount: countEffectiveWords(merged),
                      } : m))
                    } else if (d.type === 'error') {
                      console.error('[AI] 续写流式 chunk error:', d.error)
                      message.error(`续写中断：${d.error || '未知错误'}`)
                    }
                  })
                  const offEnd = window.electronAPI.onAIStreamEnd((d) => {
                    if (d.requestId !== retryResult.requestId) return
                    console.log(`[AI] 续写完成，追加 ${retryAcc.length} 字符`)
                    if (retryAcc) {
                      accumulated = accumulated + '\n' + retryAcc
                      const mergedFinal = postProcessTimeFields(
                        postProcessFabricationGuard(accumulated).content,
                        postProcessCtx
                      )
                      accumulated = docType === '监理日志' ? sanitizeUnsupportedLogParticipants(mergedFinal, trimmedInput) : mergedFinal
                      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m))
                    } else {
                      console.warn('[AI] 续写流式结束但 retryAcc 为空')
                    }
                    cleanup()
                  })
                  // 续写也限 90 秒
                  setTimeout(() => {
                    if (!retryEnded) {
                      console.warn('[AI] 续写 90s 超时')
                      cleanup()
                    }
                  }, 90000)
                })
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

        // v1.2.4（2026-06-29）：预览前对【事由】【主题】字段值兜底剥前缀
        //   老板反馈 v1.2.3 双重冒号还在 → 模板渲染走 templateService 已修，
        //   但预览面板直接显示 AI 原文，需要前端再清洗一次
        //   只对【事由】【主题】【标题】【摘要】字段清洗，不动正文
        if (mode === 'DOC' || mode === 'HYBRID') {
          accumulated = accumulated.replace(
            /【(事由|主题|标题|摘要)】\s*([\s\S]*?)(?=【|$)/g,
            (m, k, v) => `【${k}】${sanitizeFieldValue(v.trim())}`
          )
          // v1.2.7（2026-06-29 老板反馈）：信件语体清理（"尊敬的..."/"此致敬礼"）
          //   全文扫一遍，覆盖正文任意位置
          accumulated = sanitizeLetterStyle(accumulated)
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m))
        }

        // DOC / HYBRID 模式显示文档预览
        if (mode === 'DOC' || mode === 'HYBRID') {
          setProgressStage('processing')
          setPreviewContent({ docType: docType || '通用文档', content: accumulated, userInput: trimmedInput })
          setSavedPath('')
        } else if (mode === 'DATA_QUERY' && currentProject && dataToolIds?.length) {
          setPreviewContent(null)
          setSavedPath('')
          try {
            const raw = await window.electronAPI.dataQuery({
              projectName: currentProject.name,
              toolIds: dataToolIds,
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
        return
      }

      // 流式失败降级非流式
      setProgressStage('generating')
      const result = await callAI(aiCfg, aiMessages, {
        mode,
        projectName: currentProject?.name,
        dataToolIds,
      })
      if (!result.success) throw new Error(result.error || 'AI 调用失败')

      let aiContent = stripCalibrationStatement(result.content || '')
      // 后处理：先跑反编造守门员（捕获原始日期），再处理时间字段占位符
      const guardResult = postProcessFabricationGuard(aiContent)
      if (guardResult.warnings.length > 0) {
        message.warning(`⚠️ ${guardResult.warnings.join('；')}，已替换为占位符请补充`, 5)
      }
      aiContent = postProcessTimeFields(guardResult.content, postProcessCtx)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: aiContent } : m))

      // v1.2.0：AI 扩写字数软警告（与流式路径同源，老板 2026-06-27 反馈内容过简）
      if (mode === 'DOC' || mode === 'HYBRID') {
        const wordCount = countEffectiveWords(aiContent)
        const minWords = Math.max(getMinWordCount(docType || ''), getDocumentRuleMinWords(docType || '', projectConfig.documentRules))
        if (wordCount < minWords) message.warning(`⚠️ AI 仅输出 ${wordCount} 字（要求 ≥ ${minWords} 字），建议补充现场事实后重新生成`, 6)
      }

      // v1.2.4（2026-06-29）：非流式降级路径同样兜底剥【事由】前缀
      if (mode === 'DOC' || mode === 'HYBRID') {
        aiContent = aiContent.replace(
          /【(事由|主题|标题|摘要)】\s*([\s\S]*?)(?=【|$)/g,
          (m, k, v) => `【${k}】${sanitizeFieldValue(v.trim())}`
        )
        // v1.2.7（2026-06-29 老板反馈）：信件语体清理（覆盖全文，含正文）
        aiContent = sanitizeLetterStyle(aiContent)
        if (docType === '监理日志') aiContent = sanitizeUnsupportedLogParticipants(aiContent, trimmedInput)
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: aiContent } : m))
      }

      if (mode === 'DOC' || mode === 'HYBRID') {
        setProgressStage('processing')
        setPreviewContent({ docType: docType || '通用文档', content: aiContent, userInput: trimmedInput })
        setSavedPath('')
      } else if (mode === 'DATA_QUERY' && currentProject && dataToolIds?.length) {
        setPreviewContent(null)
        setSavedPath('')
        try {
          const raw = await window.electronAPI.dataQuery({
            projectName: currentProject.name,
            toolIds: dataToolIds,
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

    } catch (e: any) {
      setProgressStage('')
      message.error(e.message || '处理失败，请检查网络和 API Key')
    }

    setAttachedItems([])
    setLoading(false)
  }, [input, loading, apiReady, currentProject, projectConfig, messages])

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

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        if (projectRoot) loadDirTree(projectRoot)
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
    <div ref={containerRef} style={{ display: 'flex', height: '100%', gap: 0, overflow: 'hidden' }}>
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
        <div style={{
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
              icon={<SettingOutlined />}
              onClick={() => {
                configForm.setFieldsValue(projectConfig)
                loadTemplateLibrary()
                setConfigModalOpen(true)
              }}
              title="项目配置"
            />
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => loadDirTree(projectRoot)}
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
              onRefresh={() => loadDirTree(projectRoot)}
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
      <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* 聊天头部 — 模式感知 */}
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}>
          <RobotOutlined style={{ color: '#1677ff', fontSize: 13 }} />
          <Text strong style={{ fontSize: 12 }}>AI 助手</Text>
          <Text type="secondary" style={{ fontSize: 11, marginRight: 4 }}>— 问规范 · 查数据 · 写文档</Text>
          {/* 项目选择器：决定所有 AI 辅助的工作项目 */}
          <Select
            size="small"
            value={currentProject?.path || undefined}
            placeholder="选定项目"
            style={{ minWidth: 160, maxWidth: 220 }}
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
        </div>

        {/* 消息区域 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
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
                  alignItems: msg.role === 'user' ? 'flex-start' : 'flex-end',
                }}
              >
                <div style={{
                  maxWidth: '92%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: msg.role === 'user' ? '#f6f8fa' : '#1677ff',
                  color: msg.role === 'user' ? '#333' : '#fff',
                  boxShadow: msg.role === 'user' ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}>
                  {msg.role === 'user' ? (
                    <span style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{msg.content}</span>
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      style={{ fontSize: 13, lineHeight: 1.8 }}
                    />
                  )}
                  {msg.rawData && (
                    <div style={{ marginTop: 12 }}>
                      <DataPreviewTable data={msg.rawData} />
                    </div>
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

        {/* 输入区域 */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid #f0f0f0',
          background: '#fafafa',
        }}>
          {/* 文书设置默认隐藏，避免输入区被规则占满；点击后以紧凑浮层调整。 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>输入现场事实、事项或具体要求，AI 将按当前项目资料生成。</Text>
            <Popover
              trigger="click"
              placement="topRight"
              open={writingSetupOpen}
              onOpenChange={setWritingSetupOpen}
              content={<div style={{ width: 360 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12 }}>文书设置</Text>
                  <Button type="link" size="small" style={{ padding: 0, height: 20, fontSize: 11 }} onClick={() => { setConfigModalOpen(true); setWritingSetupOpen(false) }}>项目资料</Button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {WRITING_DOCUMENT_TYPES.map(docType => <Tag key={docType} color={docType === activeDocumentType ? 'blue' : undefined} onClick={() => selectWritingDocument(docType)} style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}>{docType}</Tag>)}
                </div>
                {activeDocumentType ? <>
                  <div style={{ padding: '5px 7px', marginBottom: 7, background: '#fafafa', color: '#777', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>已读取：{projectConfig.projectType || '未分类'}{projectConfig.projectTags?.length ? ` · ${projectConfig.projectTags.join('、')}` : ''}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {activeRulePacks.slice(0, 5).map(pack => <Tag color="blue" key={pack.id} style={{ margin: 0, fontSize: 10 }}>{pack.minWords ? `≥${pack.minWords}字 · ` : ''}{pack.label}</Tag>)}
                    <Button type="link" size="small" style={{ padding: 0, height: 18, fontSize: 11 }} onClick={() => { setRightPanelTab('rules'); setWritingSetupOpen(false) }}>详细调整</Button>
                  </div>
                </> : <Text type="secondary" style={{ fontSize: 11 }}>请选择文种，自动加载对应规则。</Text>}
              </div>}
            >
              <Button size="small" type={activeDocumentType ? 'default' : 'primary'} icon={<ControlOutlined />} style={{ fontSize: 11 }}>
                {activeDocumentType || '文书设置'}
              </Button>
            </Popover>
          </div>

          {/* 附件项目展示条 */}
          {attachedItems.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {attachedItems.map((item, i) => (
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
            display: 'flex',
            gap: 6,
            background: '#fff',
            border: '1px solid #e8e8e8',
            borderRadius: 10,
            padding: '6px 6px 6px 14px',
            alignItems: 'flex-end',
            transition: 'border-color 0.2s',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1677ff' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e8e8e8' }}
          >
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="输入需求：查数据、问规范、写文档…"
              autoSize={{ minRows: 1, maxRows: 4 }}
              variant="borderless"
              style={{ fontSize: 13, padding: 0, resize: 'none' }}
            />
            <Dropdown
              menu={{
                items: [
                  { key: 'folder', icon: <FolderOpenOutlined />, label: '选择文件夹' },
                  { key: 'file', icon: <FileTextOutlined />, label: '选择文件' },
                ],
                onClick: ({ key }) => { if (key === 'folder') handleAttachFolder(); else handleAttachFiles() },
              }}
              trigger={['click']}
            >
              <Button
                icon={<FolderOpenOutlined />}
                title="选择文件或文件夹"
                style={{
                  height: 34,
                  width: 34,
                  borderRadius: 8,
                  flexShrink: 0,
                  color: attachedItems.length > 0 ? '#1677ff' : '#bbb',
                  border: 'none',
                  background: 'transparent',
                  fontSize: 14,
                }}
              />
            </Dropdown>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={loading}
              style={{
                height: 34,
                minWidth: 72,
                borderRadius: 8,
                flexShrink: 0,
                fontSize: 13,
              }}
            >
              发送
            </Button>
          </div>
        </div>
      </div>

      {/* 拖拽手柄：AI聊天 ↔ 预览 */}
      <div
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
      </div>

      {/* 右侧：文档预览 / 模板资源 */}
      <div style={{
        width: previewWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      }}>
        {/* 右侧面板头部 — 标签切换 */}
        <div style={{
          padding: '0',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'stretch',
          flexShrink: 0,
        }}>
          <div
            onClick={() => setRightPanelTab('preview')}
            style={{
              flex: 1,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: rightPanelTab === 'preview' ? '2px solid #1677ff' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: rightPanelTab === 'preview' ? '#f0f5ff' : 'transparent',
              transition: 'all 0.2s',
            }}
          >
            <FilePdfOutlined style={{ color: rightPanelTab === 'preview' ? '#1677ff' : '#999', fontSize: 13 }} />
            <Text style={{ fontSize: 12, fontWeight: rightPanelTab === 'preview' ? 600 : 400, color: rightPanelTab === 'preview' ? '#1677ff' : '#666' }}>
              文档预览
            </Text>
          </div>
          <div style={{ width: 1, background: '#f0f0f0' }} />
          <div
            onClick={() => setRightPanelTab('templates')}
            style={{
              flex: 1,
              padding: '8px 12px',
              cursor: 'pointer',
              borderBottom: rightPanelTab === 'templates' ? '2px solid #1677ff' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: rightPanelTab === 'templates' ? '#f0f5ff' : 'transparent',
              transition: 'all 0.2s',
            }}
          >
            <BookOutlined style={{ color: rightPanelTab === 'templates' ? '#1677ff' : '#999', fontSize: 13 }} />
            <Text style={{ fontSize: 12, fontWeight: rightPanelTab === 'templates' ? 600 : 400, color: rightPanelTab === 'templates' ? '#1677ff' : '#666' }}>
              模板资源
            </Text>
          </div>
          <div style={{ width: 1, background: '#f0f0f0' }} />
          <div onClick={() => setRightPanelTab('rules')} style={{ flex: 1, padding: '8px 8px', cursor: 'pointer', borderBottom: rightPanelTab === 'rules' ? '2px solid #1677ff' : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: rightPanelTab === 'rules' ? '#f0f5ff' : 'transparent' }}>
            <ControlOutlined style={{ color: rightPanelTab === 'rules' ? '#1677ff' : '#999', fontSize: 13 }} />
            <Text style={{ fontSize: 12, fontWeight: rightPanelTab === 'rules' ? 600 : 400, color: rightPanelTab === 'rules' ? '#1677ff' : '#666' }}>扩写规则</Text>
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {rightPanelTab === 'rules' ? <div style={{ padding: 12 }}>
            <Text strong style={{ fontSize: 13 }}>{activeDocumentType ? `${activeDocumentType}规则` : '选择文种后配置规则'}</Text>
            <Text type="secondary" style={{ display: 'block', margin: '4px 0 10px', fontSize: 11, lineHeight: 1.5 }}>勾选即保存为本项目默认；生成时自动带入，无需编写提示词。</Text>
            {activeDocumentType ? <>
              <div style={{ marginBottom: 8 }}>
                <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>项目默认</Tag>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>本次生成可直接使用</Text>
              </div>
              {['通用底线', activeDocumentType === '监理日志' ? '监理日志' : activeDocumentType === '监理周报' ? '监理周报' : activeDocumentType === '监理月报' ? '监理月报' : '通知与函件'].map(group => {
                const packs = RULE_PACKS.filter(pack => pack.group === group && (!pack.docTypes || pack.docTypes.includes(activeDocumentType)))
                if (!packs.length) return null
                const selectedIds = normalizeDocumentRules(projectConfig.documentRules).rulePackIds
                return <div key={group} style={{ border: '1px solid #f0f0f0', marginBottom: 8, borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ padding: '6px 8px', background: '#fafafa', fontSize: 11, fontWeight: 600 }}>{group}</div>
                  {packs.map(pack => <div key={pack.id} style={{ padding: '7px 8px', borderTop: '1px solid #f5f5f5' }}>
                    <Checkbox checked={selectedIds.includes(pack.id)} onChange={event => updateRulePack(pack.id, event.target.checked)} style={{ fontSize: 12, lineHeight: 1.35 }}>
                      {pack.label}{pack.minWords ? <Tag color="blue" style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px' }}>≥{pack.minWords}字</Tag> : null}
                    </Checkbox>
                    <Text type="secondary" style={{ display: 'block', margin: '2px 0 0 23px', fontSize: 10, lineHeight: 1.45 }}>{pack.description}</Text>
                  </div>)}
                </div>
              })}
              <Button block size="small" onClick={() => setConfigModalOpen(true)}>补充项目长期要求</Button>
            </> : <Button size="small" type="primary" onClick={() => selectWritingDocument('监理日志')}>从监理日志开始</Button>}
          </div> : rightPanelTab === 'preview' ? (
            /* ===== 文档预览 ===== */
            <>
              <div style={{
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                borderBottom: '1px solid #f5f5f5',
              }}>
                <Space size={4}>
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
                        color={ok ? 'success' : 'error'}
                        style={{ fontSize: 11, lineHeight: '18px', marginLeft: 8 }}
                        title={`当前 ${msgWordCount} 字${minWords > 0 ? `，要求 ≥ ${minWords} 字` : ''}`}
                      >
                        {ok ? `✓ ${msgWordCount}` : `${msgWordCount}/${minWords}`}
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
                          <Tooltip title={insufficient ? `当前 ${msgWordCount} 字，不足 ${minWords} 字` : undefined}>
                            <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave} loading={generating} disabled={insufficient}>
                              {generating ? '保存中...' : (insufficient ? `不足 ${minWords} 字` : '保存')}
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
                      /* 预览模式：格式化展示 */
                      <div style={{
                        background: '#fff',
                        border: '1px solid #e8e8e8',
                        borderRadius: 8,
                        padding: 20,
                        minHeight: 300,
                        fontSize: 13,
                        lineHeight: 2,
                      }}>
                        {previewContent.content.split('\n').map((line, i) => {
                          if (!line.trim()) return <div key={i} style={{ height: 8 }} />
                          const isTitle = /^[一二三四五六七八九十]+[、.]/.test(line.trim())
                          const isSubTitle = /^[（(][一二三四五六七八九十][）)]/.test(line.trim())
                          return (
                            <div key={i} style={{
                              fontWeight: isTitle ? 600 : isSubTitle ? 500 : 400,
                              fontSize: isTitle ? 14 : 13,
                              marginBottom: 4,
                              color: isTitle ? '#333' : isSubTitle ? '#444' : '#555',
                            }}>
                              {line}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {!editMode && (
                      <div style={{ marginTop: 12, padding: '8px 12px', background: '#f6f8fa', borderRadius: 6, fontSize: 11, color: '#888' }}>
                        确认无误后点击「保存」
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
              ) : templateCatalog.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
                  <BookOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 8 }} />
                  <div style={{ fontSize: 12, color: '#999' }}>暂无模板资源</div>
                </div>
              ) : (
                <div>
                  {templateCatalog.map(item => renderTemplateNode(item, expandedCategories, setExpandedCategories, templateSearch))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 项目配置弹窗 */}
      <Modal
        title="项目配置"
        open={configModalOpen}
        onOk={handleSaveConfig}
        onCancel={() => setConfigModalOpen(false)}
        okText="保存"
        width={400}
      >
        <Form
          form={configForm}
          layout="vertical"
          style={{ paddingTop: 16 }}
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
            配置后生成文档时自动填入模板中的 {'{{'}建设单位{'}}'}、{'{{'}施工单位{'}}'}、{'{{'}监理单位{'}}'}、{'{{'}总监姓名{'}}'} 等占位符
          </Text>
          <Form.Item name="ownerUnit" label="建设单位">
            <Input placeholder="如：XX投资集团" />
          </Form.Item>
          <Form.Item name="contractor" label="施工单位">
            <Input placeholder="如：XX建设集团有限公司" />
          </Form.Item>
          <Form.Item name="supervisorUnit" label="监理单位">
            <Input placeholder="如：XX项目管理有限公司" />
          </Form.Item>
          <Form.Item name="chiefEngineer" label="总监理工程师">
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item name="projectType" label="项目类型">
            <Select
              options={PROJECT_TYPE_OPTIONS.map(item => ({ value: item.label, label: item.label }))}
            />
          </Form.Item>
          <Form.Item name="projectTags" label="专业标签（可自定义）">
            <Select mode="tags" placeholder="如：机房、网络、安防" options={getProjectTypeProfile(projectConfig.projectType).suggestedTags.map(tag => ({ value: tag, label: tag }))} />
          </Form.Item>
          <Form.Item name="projectFeatures" label="项目特点 / 建设范围">
            <Input.TextArea rows={2} placeholder="只填写已确认的建设范围、系统和约束；AI 会以此为事实边界。" />
          </Form.Item>
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 2 }}>
            <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12 }}>项目模板</Text>
              <Button type="link" size="small" icon={<BookOutlined />} onClick={() => setProjectTemplateCenterOpen(true)}>管理项目模板</Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', fontSize: 11, margin: '0 0 8px' }}>
              在这里为当前项目指定模板库版本或上传专属模板，不影响其他项目。
            </Text>
            <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text strong style={{ fontSize: 12 }}>文书规则</Text>
              <Button type="link" size="small" icon={<ControlOutlined />} onClick={() => { setRightPanelTab('rules'); setConfigModalOpen(false) }}>在 AI 写文书区设置</Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              用勾选规则包控制数据来源、日志、周报和月报写法；不需要自行写提示词。
            </Text>
          </div>
        </Form>
      </Modal>

      <ProjectTemplateCenterModal open={projectTemplateCenterOpen} onClose={() => { setProjectTemplateCenterOpen(false); loadProjectConfig() }} project={{ name: currentProject.name, path: currentProject.path, projectType: projectConfig.projectType, templateOverrides: projectConfig.templateOverrides, templateSelections: projectConfig.templateSelections }} />
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
          {item.children?.map((child: TemplateItem) => renderTemplateNode(child, expanded, setExpanded, search, depth + 1))}
        </div>
      )}
    </div>
  )
}

// 去掉末尾的编号后缀（如 "18_通信工程" → 仅用于 Tree 展示）
function stripLeadingNum(name: string): string {
  return name.replace(/^\d+_/, '')
}

/** 轻量 Markdown 渲染 — 将 **粗体**、`代码` 转为 HTML */
function renderMarkdown(text: string): string {
  // 转义 HTML 特殊字符
  let s = text
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

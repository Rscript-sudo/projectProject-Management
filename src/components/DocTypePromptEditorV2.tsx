import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, App, Button, Collapse, Empty, Input, InputNumber, Modal, Segmented,
  Select, Space, Spin, Switch, Tag, Typography,
} from 'antd'
import {
  ApartmentOutlined, CheckCircleFilled, CheckOutlined, EyeOutlined,
  FileSearchOutlined, LeftOutlined, ReloadOutlined, RightOutlined,
  SaveOutlined, ThunderboltFilled, ArrowLeftOutlined, FolderOpenOutlined, PlayCircleOutlined,
  PlusOutlined, DeleteOutlined,
} from '@ant-design/icons'
import { getDefaultPrompts, mergeDocTypePrompt } from '../shared/docTypePrompts'
import type { DocTypeConfig, GlobalRule } from '../shared/docTypePrompts'
import { BUILTIN_DOC_TYPES } from '../shared/builtinDocTypes'
import { useSettingsStore } from '../stores/useSettingsStore'
import { callAI, generateDocTypePrompt, analyzeTemplateStructure } from '../services/aiService'
import type { SuggestedField } from '../services/aiService'

const { Text, Title } = Typography

type FillMode = 'project' | 'system' | 'ai' | 'keep'
type FieldConfig = {
  mode: FillMode
  source: string
  requirement: string
  minWords: number
  maxWords: number
  antiFabrication: boolean
}

type PlaceholderPlacement = {
  field: string
  anchor?: string
  position: 'before' | 'after'
  tableIndex?: number
  rowIndex?: number
  cellIndex?: number
}

const SYSTEM_FIELDS = ['日期', '星期几', '天气', '气温', '当前时间', '编制日期']
// 项目通用字段：新建项目时已写入项目基本信息，生成时直接从项目资料读取，不调 AI
const PROJECT_FIELDS = [
  '项目名称', '工程名称', '项目编号', '文件编号', '编号', '文号',
  '致单位', '致送单位', '建设单位', '建设方', '甲方', '业主单位', '业主',
  '施工单位', '施工单位名称', '乙方', '承建单位',
  '监理单位', '监理公司', '项目监理机构', '监理机构',
  '总监理工程师', '总监姓名', '总监理',
  '项目类型', '工程类型',
]

const EMPTY_CONFIG: FieldConfig = {
  mode: 'ai', source: '用户输入与项目资料', requirement: '',
  minWords: 80, maxWords: 300, antiFabrication: true,
}

const FIELD_HINTS: Record<string, string> = {
  项目名称: '从项目资料读取正式全称，不得改写或推测。',
  日期: '优先采用用户提供或项目资料中的日期；缺失时标注待确认。',
  星期几: '根据已确认日期计算，不得自行假定日期。',
  天气: '仅整理用户输入或现场资料中明确记录的天气。',
  气温: '保留原始数值和单位，缺失时标注待确认。',
  施工部位: '写明楼栋、楼层、轴线或具体作业面，信息不足不得补造。',
  参与人员: '列出已提供的单位、岗位与姓名，不增加未出现人员。',
  今日内容: '按时间或工序归纳当天完成事项，突出可核验事实。',
  核心工作落实: '围绕质量、进度、安全的检查结果和落实情况展开。',
  协调解决情况: '写明问题、协调对象、处理结论及后续责任。',
  其他事项: '仅记录不属于前述栏目但确有依据的重要事项。',
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char)
}

function sanitizeTemplateHtml(html: string) {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  documentNode.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,textarea,select').forEach(node => node.remove())
  documentNode.body.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on') || name === 'srcdoc' || ((name === 'href' || name === 'src') && !/^(data:image\/|https?:|#)/i.test(value))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return documentNode.body.innerHTML
}

function injectMappedPlaceholder(html: string, placement: PlaceholderPlacement, selectedField: string) {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const createButton = () => {
    const button = documentNode.createElement('button')
    button.type = 'button'
    button.className = `placeholder ai${placement.field === selectedField ? ' selected' : ''}`
    button.dataset.field = placement.field
    button.textContent = `{{${placement.field}}}`
    const badge = documentNode.createElement('span')
    badge.textContent = 'AI扩写'
    button.appendChild(badge)
    return button
  }
  if (Number.isInteger(placement.tableIndex) && Number.isInteger(placement.rowIndex) && Number.isInteger(placement.cellIndex)) {
    const table = documentNode.body.querySelectorAll('table')[placement.tableIndex!] as HTMLTableElement | undefined
    const row = table?.rows[placement.rowIndex!]
    const cell = row?.cells[placement.cellIndex!]
    if (cell) {
      const paragraph = cell.querySelector('p') || cell
      paragraph.appendChild(createButton())
      return documentNode.body.innerHTML
    }
  }
  const anchor = String(placement.anchor || '').trim()
  if (!anchor) return html
  const walker = documentNode.createTreeWalker(documentNode.body, NodeFilter.SHOW_TEXT)
  let textNode: Text | null = walker.nextNode() as Text | null
  while (textNode) {
    const raw = textNode.nodeValue || ''
    const index = raw.indexOf(anchor)
    if (index >= 0 && textNode.parentElement && !textNode.parentElement.closest('[data-field]')) {
      const button = createButton()
      const splitAt = placement.position === 'before' ? index : index + anchor.length
      const after = textNode.splitText(splitAt)
      after.parentNode?.insertBefore(button, after)
      return documentNode.body.innerHTML
    }
    textNode = walker.nextNode() as Text | null
  }
  return html
}

function defaultFieldConfig(field: string): FieldConfig {
  const mode: FillMode = SYSTEM_FIELDS.includes(field) ? 'system' : PROJECT_FIELDS.includes(field) ? 'project' : 'ai'
  return {
    ...EMPTY_CONFIG,
    mode,
    source: mode === 'system' ? '系统自动计算' : mode === 'project' ? '项目资料' : '用户输入与项目资料',
    requirement: FIELD_HINTS[field] || `围绕“${field}”提取可核验事实，按模板语气整理；信息不足时标注待确认。`,
  }
}

export default function DocTypePromptEditorV2({ initialDocType, templateId, onBack }: { initialDocType?: string; templateId?: string; onBack?: () => void }) {
  const { message } = App.useApp()
  const { docTypePromptOverrides, globalRulesOverrides, applyCustomTypes, customDocTypes } = useSettingsStore()
  const defaults = useMemo(() => getDefaultPrompts(), [])
  const docTypes = useMemo(() => [
    ...BUILTIN_DOC_TYPES.map(label => ({ key: label, label })),
    ...(customDocTypes || []).map(item => ({ key: item.code, label: item.label })),
  ], [customDocTypes])

  const [activeKey, setActiveKey] = useState('')
  const [draft, setDraft] = useState<DocTypeConfig | null>(null)
  const [globalDraft, setGlobalDraft] = useState<Record<string, GlobalRule>>({})
  const [template, setTemplate] = useState<{ id?: string; name: string; path: string; fields: string[]; content: string; html: string; isSystem?: boolean } | null>(null)
  // 初始扫描字段快照——用于"保存模板"时计算占位符增删差异，写回原模板文件
  const [initialFields, setInitialFields] = useState<string[]>([])
  const [availableTemplates, setAvailableTemplates] = useState<{ id: string; name: string; scope: string; source: string }[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [configs, setConfigs] = useState<Record<string, FieldConfig>>({})
  const [selectedField, setSelectedField] = useState('')
  const [step, setStep] = useState(2)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [inlineAnchor, setInlineAnchor] = useState('')
  const [inlineLocator, setInlineLocator] = useState<Pick<PlaceholderPlacement, 'tableIndex' | 'rowIndex' | 'cellIndex'> | null>(null)
  const [inlineEditorPosition, setInlineEditorPosition] = useState<{ left: number; top: number } | null>(null)
  const [pendingPlacements, setPendingPlacements] = useState<PlaceholderPlacement[]>([])
  const [deletedFields, setDeletedFields] = useState<Array<{ field: string; config: FieldConfig; placement?: PlaceholderPlacement }>>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestedFields, setSuggestedFields] = useState<SuggestedField[]>([])
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([])
  const [recognitionError, setRecognitionError] = useState('')
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [personalTemplateName, setPersonalTemplateName] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  const activeItem = docTypes.find(item => item.key === activeKey)
  const activeIndex = docTypes.findIndex(item => item.key === activeKey)
  const defaultDoc = useMemo(() => activeKey ? mergeDocTypePrompt(defaults.docTypes[activeKey], undefined) : null, [activeKey, defaults])

  useEffect(() => {
    const match = initialDocType && docTypes.find(item => item.key === initialDocType || item.label === initialDocType)
    if (match) setActiveKey(match.key)
    else if (!activeKey && docTypes[0]) setActiveKey(docTypes[0].key)
  }, [docTypes, initialDocType])

  useEffect(() => {
    if (!activeKey) return
    const override = docTypePromptOverrides?.[activeKey] as any
    const base = defaults.docTypes[activeKey]
    const next: DocTypeConfig = base
      ? (mergeDocTypePrompt(base, override) || {
          key: activeKey, mode: 'B', minWords: 600, systemTemplate: '', userTemplate: '',
          fields: [], hardConstraints: [], extras: {},
        })
      : {
          key: activeKey, mode: 'B', minWords: override?.minWords ?? 600,
          systemTemplate: override?.systemTemplate ?? '', userTemplate: override?.userTemplate ?? '',
          fields: override?.fields ?? [], hardConstraints: override?.hardConstraints ?? [], extras: override?.extras ?? {},
        }
    setDraft(next)
    const saved = ((next.extras as any)?.fieldConfigs || {}) as Record<string, FieldConfig>
    const legacy = ((next.extras as any)?.fieldRules || {}) as Record<string, string>
    const keys = (next.fields || []).map(field => typeof field === 'string' ? field : field.key)
    const merged: Record<string, FieldConfig> = {}
    for (const key of keys) merged[key] = { ...defaultFieldConfig(key), ...(saved[key] || {}), requirement: saved[key]?.requirement || legacy[key] || defaultFieldConfig(key).requirement }
    setConfigs(merged)
  }, [activeKey, defaults, docTypePromptOverrides])

  useEffect(() => {
    const merged: Record<string, GlobalRule> = {}
    for (const [key, value] of Object.entries(defaults.globalRules)) {
      merged[key] = { ...value, ...(globalRulesOverrides?.[key] || {}) }
    }
    setGlobalDraft(merged)
  }, [defaults, globalRulesOverrides])

  const loadTemplate = async (requestedTemplateId?: string) => {
    if (!activeItem?.label) return
    setLoadingTemplate(true)
    try {
      const [library, system] = await Promise.all([window.electronAPI.listTemplateLibrary(), window.electronAPI.listSystemTemplates()])
      // 列出当前文种所有可用模板（私人库 > 专业库 > 通用库 > 系统预置）
      const matched = [
        ...library.filter(t => t.docType === activeItem.label && t.scope === 'personal').map(t => ({ id: t.id, name: `${t.name}（私人库）`, scope: t.scope, source: 'personal' })),
        ...library.filter(t => t.docType === activeItem.label && t.scope === 'professional').map(t => ({ id: t.id, name: `${t.name}（专业库·${t.projectTypeLabel || t.projectType}）`, scope: t.scope, source: 'professional' })),
        ...library.filter(t => t.docType === activeItem.label && t.scope === 'global').map(t => ({ id: t.id, name: `${t.name}（通用库）`, scope: t.scope, source: 'global' })),
        ...system.filter(t => t.docType === activeItem.label).map(t => ({ id: t.id, name: `${t.name}`, scope: t.scope, source: 'system' })),
      ]
      setAvailableTemplates(matched)
      // 选中规则：传入 templateId > 已选 > 默认第一个（优先 personal）
      const targetId = requestedTemplateId || templateId || selectedTemplateId || matched[0]?.id
      const found = library.find(item => item.id === targetId)
        || system.find(item => item.id === targetId)
        || library.find(item => item.docType === activeItem.label)
        || system.find(item => item.docType === activeItem.label)
      if (!found?.path) {
        setTemplate(null)
        setRecognitionError('当前文种没有可识别的模板文件。你可以手动设定占位符，或添加模板后重试识别。')
        return
      }
      setSelectedTemplateId(found.id)
      const isSystem = found.scope === 'system' || !!(found as any).readOnly
      // 字段扫描与可视预览同时加载。任何来源的模板都使用同一套映射界面，
      // 不再出现“文件已加载但内容区仍为空”的割裂状态。
      const [scanResult, parsed] = await Promise.all([
        window.electronAPI.getTemplateFields(found.path),
        window.electronAPI.readFileContent(found.path),
      ])
      const scannedFields = scanResult?.ok ? (scanResult.fields || []) : (found.fields || [])
      const fields = [...new Set([...(found.fields || []), ...scannedFields])]
      const compactContent = parsed?.success ? (parsed.content || '')
        .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''
      setRecognitionError(fields.length ? '' : '没有识别到占位符。可手动设定字段，或让 AI 重新分析模板结构。')
      setTemplate({ id: found.id, name: found.sourceName || activeItem.label, path: found.path, fields, content: compactContent, html: parsed?.success ? parsed.html || '' : '', isSystem })
      setPendingPlacements([])
      setDeletedFields([])
      setInlineAnchor('')
      setInlineLocator(null)
      setInlineEditorPosition(null)
      setInitialFields(fields)
      const next = { ...configs }
      for (const field of fields) if (!next[field]) next[field] = defaultFieldConfig(field)
      setConfigs(next)
      setSelectedField(current => fields.includes(current) ? current : fields[0] || '')
      setStep(fields.length ? 2 : 1)
    } catch (error: any) {
      const detail = `模板读取失败：${error?.message || error}`
      setRecognitionError(detail)
      message.error(detail)
    } finally {
      setLoadingTemplate(false)
    }
  }

  // 重新加载预览：用于解析器临时失败后的手动重试。
  const [previewLoading, setPreviewLoading] = useState(false)
  const loadPreview = async () => {
    if (!template?.path || template.content) return
    setPreviewLoading(true)
    try {
      const parsed = await window.electronAPI.readFileContent(template.path)
      if (parsed.success) {
        const compactContent = (parsed.content || '')
          .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        setTemplate(prev => prev ? { ...prev, content: compactContent, html: parsed.html || '' } : prev)
      }
    } catch (error: any) {
      message.error(`预览加载失败：${error?.message || error}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => { loadTemplate() }, [activeItem?.label, templateId])

  const fields = template?.fields || Object.keys(configs)
  useEffect(() => { if (!selectedField && fields[0]) setSelectedField(fields[0]) }, [fields, selectedField])
  const current = configs[selectedField] || defaultFieldConfig(selectedField)

  const grouped = useMemo(() => ({
    '基础信息': fields.filter(field => PROJECT_FIELDS.includes(field)),
    '系统字段': fields.filter(field => SYSTEM_FIELDS.includes(field)),
    'AI 扩写字段': fields.filter(field => !PROJECT_FIELDS.includes(field) && !SYSTEM_FIELDS.includes(field)),
  }), [fields])

  const updateConfig = (patch: Partial<FieldConfig>) => {
    if (!selectedField) return
    setConfigs(prev => ({ ...prev, [selectedField]: { ...(prev[selectedField] || defaultFieldConfig(selectedField)), ...patch } }))
  }

  // 映射区就地添加字段：先点模板位置，再直接输入字段名。
  const addField = () => {
    const name = newFieldName.trim()
    if (!name) { message.warning('请输入字段名'); return }
    if (fields.includes(name)) { message.warning('该字段已存在'); return }
    setConfigs(prev => ({ ...prev, [name]: defaultFieldConfig(name) }))
    if (template) setTemplate(prev => prev ? { ...prev, fields: [...(prev.fields || []), name] } : prev)
    if (inlineAnchor || inlineLocator) setPendingPlacements(prev => [...prev.filter(item => item.field !== name), { field: name, anchor: inlineAnchor || undefined, position: 'after', ...(inlineLocator || {}) }])
    setDeletedFields(prev => prev.filter(item => item.field !== name))
    setSelectedField(name)
    setNewFieldName('')
    setInlineAnchor('')
    setInlineLocator(null)
    setInlineEditorPosition(null)
    message.success(`已在所选位置添加字段「${name}」`)
  }

  // 删除后保留本次编辑会话内的恢复记录，避免误删后只能重新扫描。
  const removeField = (field: string) => {
    const placement = pendingPlacements.find(item => item.field === field)
    setDeletedFields(prev => [...prev.filter(item => item.field !== field), {
      field,
      config: configs[field] || defaultFieldConfig(field),
      placement,
    }])
    setConfigs(prev => { const next = { ...prev }; delete next[field]; return next })
    if (template) setTemplate(prev => prev ? { ...prev, fields: (prev.fields || []).filter(f => f !== field) } : prev)
    setPendingPlacements(prev => prev.filter(item => item.field !== field))
    if (selectedField === field) setSelectedField(fields.find(item => item !== field) || '')
    message.success(`已删除占位符「${field}」，保存前可撤销恢复`)
  }

  const restoreLastDeletedField = () => {
    const removed = deletedFields[deletedFields.length - 1]
    if (!removed) return
    setConfigs(prev => ({ ...prev, [removed.field]: removed.config }))
    setTemplate(prev => prev ? { ...prev, fields: [...new Set([...(prev.fields || []), removed.field])] } : prev)
    if (removed.placement) setPendingPlacements(prev => [...prev.filter(item => item.field !== removed.field), removed.placement!])
    setDeletedFields(prev => prev.slice(0, -1))
    setSelectedField(removed.field)
    message.success(`已恢复占位符「${removed.field}」`)
  }

  // AI 分析模板结构：先加载内容，再调 AI 识别可填充位置 + 建议占位符
  const analyzeTemplate = async () => {
    if (!activeItem?.label || !template?.path) return
    setAnalyzing(true)
    try {
      // 1. 先加载模板内容（mammoth 解析，可能慢，但 AI 分析必须读内容）
      let content = template.content
      if (!content) {
        const parsed = await window.electronAPI.readFileContent(template.path)
        if (!parsed.success || !parsed.content) throw new Error('模板内容读取失败')
        content = (parsed.content || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        setTemplate(prev => prev ? { ...prev, content, html: parsed.html || '' } : prev)
      }
      // 2. 调 AI 分析
      const settings = await window.electronAPI.getSettings()
      const result = await analyzeTemplateStructure(
        { provider: (settings.aiProvider as any) || 'deepseek', baseUrl: settings.baseUrl || '', model: settings.model || '' },
        activeItem.label,
        content,
        fields,
      )
      if (!result.success || !result.fields?.length) throw new Error(result.error || 'AI 未识别出字段')
      setRecognitionError('')
      setSuggestedFields(result.fields)
      setSelectedSuggestions(result.fields.map(f => f.name))
      setAnalyzeOpen(true)
    } catch (error: any) {
      const detail = `AI 模板识别失败：${error?.message || error}`
      setRecognitionError(detail)
      message.error(detail)
    } finally {
      setAnalyzing(false)
    }
  }

  // 确认导入勾选的建议字段，并把 {{占位符}} 按 anchorText 回写到模板内容
  const importSuggestions = () => {
    const picked = suggestedFields.filter(f => selectedSuggestions.includes(f.name))
    const newFields: string[] = []
    for (const f of picked) {
      if (fields.includes(f.name)) continue
      setConfigs(prev => ({ ...prev, [f.name]: {
        mode: f.mode, source: f.mode === 'system' ? '系统自动计算' : f.mode === 'project' ? '项目资料' : '用户输入与项目资料',
        requirement: f.hint, minWords: 80, maxWords: 300, antiFabrication: true,
      } }))
      newFields.push(f.name)
    }
    const placements = picked
      .filter(f => !fields.includes(f.name) && f.anchorText)
      .map(f => ({ field: f.name, anchor: f.anchorText.trim(), position: (f.insertPosition === 'before' ? 'before' : 'after') as 'before' | 'after' }))
    setPendingPlacements(prev => [
      ...prev.filter(item => !placements.some(next => next.field === item.field)),
      ...placements,
    ])
    // 纯文本预览同步插入，HTML 预览由 pendingPlacements 统一绘制可点击标记。
    let insertedCount = 0
    setTemplate(prev => {
      if (!prev) return prev
      let content = prev.content
      if (!content) {
        return { ...prev, fields: [...new Set([...(prev.fields || []), ...picked.map(f => f.name)])] }
      }
      for (const f of picked) {
        if (!f.anchorText) continue
        const placeholder = `{{${f.name}}}`
        if (content.includes(placeholder)) continue
        // 精确匹配
        let idx = content.indexOf(f.anchorText)
        // 兜底：去掉空白后模糊匹配（mammoth 解析的纯文本空白可能跟 AI 看到的不一致）
        if (idx < 0) {
          const compactContent = content.replace(/\s+/g, '')
          const compactAnchor = f.anchorText.replace(/\s+/g, '')
          const compactIdx = compactContent.indexOf(compactAnchor)
          if (compactIdx >= 0) {
            // 把 compact 位置映射回原 content（找第一个空白压缩后等于 compactAnchor 的区间）
            let start = 0, walk = 0
            while (walk < compactIdx) { while (start < content.length && /\s/.test(content[start])) start++; if (walk < compactIdx) { start++; walk++ } }
            // 简单处理：用 compactAnchor 在原 content 里找最接近的子串
            idx = content.indexOf(f.anchorText.trim())
          }
        }
        if (idx < 0) continue
        if (f.insertPosition === 'before') {
          content = content.slice(0, idx) + placeholder + content.slice(idx)
        } else if (f.insertPosition === 'replace') {
          const afterAnchor = content.slice(idx + f.anchorText.length)
          const replaced = afterAnchor.replace(/^[\s_（）()]+/, placeholder)
          content = content.slice(0, idx + f.anchorText.length) + replaced
        } else {
          content = content.slice(0, idx + f.anchorText.length) + placeholder + content.slice(idx + f.anchorText.length)
        }
        insertedCount++
      }
      return { ...prev, content, fields: [...new Set([...(prev.fields || []), ...picked.map(f => f.name)])] }
    })
    if (newFields.length) {
      setSelectedField(newFields[0])
      message.success(`已导入 ${newFields.length} 个建议字段${insertedCount ? `，${insertedCount} 个占位符已回写到预览` : '（占位符需到预览界面手动插入）'}`)
    } else {
      message.info('没有新字段可导入')
    }
    setAnalyzeOpen(false)
  }

  const switchDoc = (offset: number) => {
    if (!docTypes.length) return
    setActiveKey(docTypes[(Math.max(activeIndex, 0) + offset + docTypes.length) % docTypes.length].key)
  }

  const save = async (saveAsPersonal = false) => {
    if (!draft || !activeKey) return
    setSaving(true)
    try {
      const locked = fields.filter(field => configs[field]?.mode === 'ai')
      const lines = locked.map(field => {
        const c = configs[field] || defaultFieldConfig(field)
        return `- 【${field}】：来源=${c.source}；要求=${c.requirement}；篇幅=${c.minWords}-${c.maxWords}字；${c.antiFabrication ? '禁止编造，信息不足标注“待确认”' : '允许依据上下文合理整理'}`
      })
      const lockBlock = lines.length ? `【占位符锁定规则】\n仅填充以下 AI 扩写占位符，其他模板内容保持不变：\n${lines.join('\n')}\n【/占位符锁定规则】\n\n` : ''
      const cleanSystem = draft.systemTemplate.replace(/【占位符锁定规则】[\s\S]*?【\/占位符锁定规则】\s*/g, '')
      const contractLines = fields.map(field => {
        const c = configs[field] || defaultFieldConfig(field)
        if (c.mode === 'ai') return `- 【${field}】${c.requirement}；建议 ${c.minWords}-${c.maxWords} 字；${c.antiFabrication ? '禁止编造，信息不足时标注“待确认”。' : ''}`
        if (c.mode === 'keep') return `- 【${field}】保持原模板内容，不进行填充或改写。`
        return `- 【${field}】由${c.source || (c.mode === 'system' ? '系统' : '项目资料')}自动填充，AI 不得改写或推测。`
      })
      const contractBlock = `【字段逐项规则】\n${contractLines.join('\n')}`
      const synchronizedSystem = /【字段逐项规则】[\s\S]*?(?=\n\n【)/.test(cleanSystem)
        ? cleanSystem.replace(/【字段逐项规则】[\s\S]*?(?=\n\n【)/, contractBlock)
        : `${contractBlock}\n\n${cleanSystem}`
      const nextDraft = {
        ...draft,
        systemTemplate: lockBlock + synchronizedSystem,
        fields: locked.map(key => ({ key, required: true })),
        extras: { ...(draft.extras || {}), fieldConfigs: configs, fieldRules: Object.fromEntries(locked.map(key => [key, configs[key]?.requirement || ''])) },
      }
      const nextOverrides = { ...(docTypePromptOverrides || {}) } as Record<string, any>
      nextOverrides[activeKey] = {
        systemTemplate: nextDraft.systemTemplate, userTemplate: nextDraft.userTemplate,
        minWords: nextDraft.minWords, fields: nextDraft.fields, extras: nextDraft.extras,
      }
      const nextRules: Record<string, any> = {}
      for (const [key, rule] of Object.entries(globalDraft)) {
        const base = defaults.globalRules[key]
        const patch: Record<string, any> = {}
        if (rule.enabled !== base.enabled) patch.enabled = rule.enabled
        if (rule.content !== base.content) patch.content = rule.content
        if (Object.keys(patch).length) nextRules[key] = patch
      }
      const settings = await window.electronAPI.getSettings()
      const result = await window.electronAPI.setSettings({ ...settings, docTypePromptOverrides: nextOverrides, globalRulesOverrides: Object.keys(nextRules).length ? nextRules : null })
      if (!result.success) throw new Error(result.error || '未知错误')
      const overrides = await window.electronAPI.listDocTypePromptOverrides()
      applyCustomTypes(await window.electronAPI.listCustomProjectTypes(), await window.electronAPI.listCustomDocTypes(), overrides?.docTypes || null, overrides?.globalRules || null)
      setDraft(nextDraft)

      // v1.3.4：把占位符增删写回原模板文件（docx/xlsx）
      // 对比 initialFields（初始扫描）与当前 fields，计算 add/remove 差异
      if (template?.path) {
        const currentFields = fields
        const addFields = currentFields.filter(f => !initialFields.includes(f))
        const removeFields = initialFields.filter(f => !currentFields.includes(f))
        if (addFields.length || removeFields.length || saveAsPersonal) {
          try {
            const saveRes = await window.electronAPI.saveTemplateContent({
              path: template.path,
              addFields,
              removeFields,
              placements: pendingPlacements.filter(item => addFields.includes(item.field)),
              docType: activeItem?.label || activeKey,
              templateId: template.id,
              saveAsPersonal: saveAsPersonal || template.isSystem,
              name: personalTemplateName.trim() || `${activeItem?.label || activeKey}私人模板`,
            })
            if (saveRes?.ok) {
              // 系统模板会被克隆到企业库，更新 template 指向新路径
              if (saveRes.clonedToLibrary) {
                setTemplate(prev => prev ? { ...prev, path: saveRes.path!, id: saveRes.clonedToLibrary.id, isSystem: false } : prev)
                setSelectedTemplateId(saveRes.clonedToLibrary.id)
                message.success(saveAsPersonal ? '已另存为私人模板' : '系统模板只读，已复制到私人模板库并保存')
              } else {
                message.success(`已把 ${addFields.length + removeFields.length} 个占位符变更写回模板文件`)
              }
              // 更新初始字段快照为保存后的字段
              if (saveRes.fields) setInitialFields(saveRes.fields)
              setPendingPlacements([])
            } else {
              message.warning(`模板文件保存失败：${saveRes?.error || '未知错误'}（规则已保存，但模板文件未更新）`)
            }
          } catch (saveErr: any) {
            message.warning(`模板文件保存异常：${saveErr?.message || saveErr}（规则已保存，但模板文件未更新）`)
          }
        }
      }

      setStep(3)
      setSaveAsOpen(false)
      setPersonalTemplateName('')
      if (!template?.path || !(fields.filter(f => !initialFields.includes(f)).length || initialFields.filter(f => !fields.includes(f)).length)) {
        message.success('规则已保存，并已接入 AI 扩写')
      }
    } catch (error: any) {
      message.error(`保存失败：${error?.message || error}`)
    } finally { setSaving(false) }
  }

  const aiOrganize = async () => {
    if (!draft || !activeItem) return
    setGenerating(true)
    try {
      const settings = await window.electronAPI.getSettings()
      const result = await generateDocTypePrompt({ provider: (settings.aiProvider as any) || 'deepseek', baseUrl: settings.baseUrl || '', model: settings.model || '' }, activeItem.label, template?.content || '', fields)
      if (!result.success || !result.prompt) throw new Error(result.error || '生成失败')
      setDraft(prev => prev ? { ...prev, ...result.prompt } : prev)
      const next = { ...configs }
      for (const field of fields) next[field] = { ...(next[field] || defaultFieldConfig(field)), requirement: FIELD_HINTS[field] || next[field]?.requirement || defaultFieldConfig(field).requirement }
      setConfigs(next)
      message.success('AI 已整理字段规则，请确认后保存')
    } catch (error: any) { message.error(`AI 整理失败：${error?.message || error}`) }
    finally { setGenerating(false) }
  }

  const optimizeSelectedField = async () => {
    if (!selectedField || !activeItem) return
    setGenerating(true)
    try {
      const settings = await window.electronAPI.getSettings()
      const result = await callAI(
        { provider: (settings.aiProvider as any) || 'deepseek', baseUrl: settings.baseUrl || '', model: settings.model || '' },
        [
          { role: 'system', content: '你是工程文档模板规则设计助手。只返回一段可直接保存的字段扩写要求，不要标题、解释或 Markdown。要求必须说明信息来源、应包含的内容、组织顺序、缺失信息处理和禁止编造。' },
          { role: 'user', content: `文种：${activeItem.label}\n字段：${selectedField}\n当前要求：${current.requirement}\n模板上下文：${(template?.content || '').slice(0, 3000)}` },
        ],
      )
      if (!result.success || !result.content?.trim()) throw new Error(result.error || '模型未返回规则')
      updateConfig({ requirement: result.content.trim() })
      message.success(`已优化“${selectedField}”字段规则`)
    } catch (error: any) { message.error(`字段规则优化失败：${error?.message || error}`) }
    finally { setGenerating(false) }
  }

  const renderContent = () => {
    if (!template?.content) return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#999' }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <Button type="primary" size="large" icon={<ThunderboltFilled />} loading={analyzing} onClick={analyzeTemplate} style={{ marginBottom: 12 }}>AI 分析模板结构</Button>
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.7 }}>用大模型识别模板里的空白位置和可填充点，自动建议占位符字段（含写作提示和处理方式）</div>
        <Button type="link" size="small" icon={<EyeOutlined />} loading={previewLoading} onClick={loadPreview} style={{ marginTop: 8 }}>仅加载预览不分析</Button>
      </div>
    </div>
    return template.content.split(/(\{\{[^}]+\}\})/g).map((part, index) => {
      const match = part.match(/^\{\{([^}]+)\}\}$/)
      if (!match) return <span key={index}>{part}</span>
      const field = match[1].trim()
      if (!fields.includes(field)) return null
      const selected = field === selectedField
      return <button key={`${field}-${index}`} onClick={() => setSelectedField(field)} style={{ border: selected ? '1px solid #1677ff' : '1px solid #f0b04f', background: selected ? '#e8f3ff' : '#fff7e8', color: selected ? '#0958d9' : '#ad6800', borderRadius: 5, padding: '1px 5px', margin: '1px 2px', cursor: 'pointer', fontWeight: 600 }}>{part}</button>
    })
  }

  const decoratedTemplateHtml = useMemo(() => {
    if (!template?.html) return ''
    let safe = sanitizeTemplateHtml(template.html)
    safe = safe.replace(/\{\{([^}]+)\}\}/g, (_whole, rawField) => {
      const field = String(rawField).trim()
      if (!fields.includes(field)) return ''
      const mode = configs[field]?.mode || defaultFieldConfig(field).mode
      const selected = field === selectedField
      const tone = mode === 'ai' ? 'ai' : mode === 'keep' ? 'keep' : 'auto'
      const escapedField = escapeHtmlAttribute(field)
      return `<button type="button" class="placeholder ${tone}${selected ? ' selected' : ''}" data-field="${escapedField}">{{${escapedField}}}${mode === 'ai' ? '<span>AI扩写</span>' : ''}</button>`
    })
    for (const placement of pendingPlacements) safe = injectMappedPlaceholder(safe, placement, selectedField)
    return safe
  }, [template?.html, configs, selectedField, pendingPlacements, fields])

  const shell: React.CSSProperties = { background: '#fff' }
  const paneTitle: React.CSSProperties = { padding: '13px 16px', borderBottom: '1px solid #edf0f3', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }

  return <div style={{ ...shell, overflow: 'auto', minWidth: 0, minHeight: '100%' }}>
    <div className="template-editor-header">
      <Space size={12} wrap style={{ minWidth: 0 }}>
        {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
        <span style={{ width: 30, height: 30, display: 'inline-grid', placeItems: 'center', borderRadius: 7, color: '#fff', background: '#1677ff' }}><FileSearchOutlined /></span>
        <Title level={4} className="template-editor-title" style={{ margin: 0 }} title={`${activeItem?.label || '模板'} · AI扩写规则`}>{activeItem?.label || '模板'} · AI扩写规则</Title>
        <Select showSearch value={activeKey || undefined} onChange={setActiveKey} optionFilterProp="label" variant="borderless" style={{ width: 150 }} options={docTypes.map(item => ({ value: item.key, label: item.label }))} />
        {availableTemplates.length > 0 && <Select value={selectedTemplateId || undefined} onChange={(id) => { setSelectedTemplateId(id); void loadTemplate(id) }} variant="borderless" style={{ width: 220 }} options={availableTemplates.map(t => ({ value: t.id, label: t.name }))} placeholder="选择模板来源" />}
      </Space>
      <Space wrap className="template-editor-actions">
        <Button icon={<FolderOpenOutlined />} disabled={!template?.path} onClick={() => template?.path && window.electronAPI.openFile(template.path)}>用 Word/WPS 编辑源文件</Button>
        <Button icon={<ReloadOutlined />} disabled={!template?.path} onClick={() => loadTemplate(selectedTemplateId)}>源文件保存后重新载入</Button>
        <Button type="primary" ghost icon={<ThunderboltFilled />} loading={analyzing} onClick={analyzeTemplate}>AI 分析模板结构</Button>
        <Button icon={<ReloadOutlined />} onClick={() => loadTemplate(selectedTemplateId)}>重新扫描</Button>
        <Button icon={<PlayCircleOutlined />} onClick={() => setPreviewOpen(true)}>测试生成</Button>
        <Button icon={<SaveOutlined />} loading={saving} disabled={!template?.path} onClick={() => { setPersonalTemplateName(`${activeItem?.label || activeKey}私人模板`); setSaveAsOpen(true) }}>另存为私人模板</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save(false)}>保存并启用</Button>
      </Space>
    </div>
    <div style={{ padding: '12px 24px 11px', borderBottom: '1px solid #edf0f3' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 720, margin: '0 auto' }}>
        {[['1', '扫描模板字段'], ['2', '配置扩写规则'], ['3', '校验并保存']].map(([number, label], index) => {
          const done = step > Number(number), active = step === Number(number)
          return <div key={number} style={{ position: 'relative', textAlign: 'center', color: active ? '#1677ff' : done ? '#389e0d' : '#8c8c8c', fontWeight: active ? 700 : 500 }}>
            {index > 0 && <span style={{ position: 'absolute', height: 1, background: done || active ? '#91caff' : '#e5e8eb', left: '-50%', right: '50%', top: 13 }} />}
            <span style={{ position: 'relative', zIndex: 1, display: 'inline-grid', placeItems: 'center', width: 27, height: 27, borderRadius: 99, color: done || active ? '#fff' : '#777', background: done ? '#52c41a' : active ? '#1677ff' : '#f0f2f5' }}>{done ? <CheckOutlined /> : number}</span>
            <div style={{ marginTop: 4, fontSize: 13 }}>{label}</div>
            <div style={{ marginTop: 1, fontSize: 11, fontWeight: 400, color: active ? '#1677ff' : done ? '#52c41a' : '#999' }}>{done ? '已完成' : active ? '进行中' : '待进行'}</div>
          </div>
        })}
      </div>
    </div>

    {recognitionError && <Alert
      type="warning" showIcon closable style={{ margin: '12px 22px 0' }}
      message="模板识别未完成"
      description={<Space wrap><Text>{recognitionError}</Text><Button size="small" icon={<PlusOutlined />} onClick={() => message.info('请在下方“原始模板映射”中点击要插入的位置')}>自定义占位符</Button><Button size="small" type="primary" ghost icon={<ReloadOutlined />} loading={analyzing} onClick={analyzeTemplate}>重试 AI 模板识别</Button></Space>}
      onClose={() => setRecognitionError('')}
    />}
    <Spin spinning={loadingTemplate}>
      <div className="template-editor-grid">
        <section style={{ borderRight: '1px solid #edf0f3', background: '#fbfcfe' }}>
          <div style={paneTitle}><span><ApartmentOutlined /> 占位符结构</span><Space size={6}><Tag color="blue">{fields.length} 个</Tag>{deletedFields.length > 0 && <Button size="small" type="link" onClick={restoreLastDeletedField}>撤销删除（{deletedFields.length}）</Button>}<Button size="small" type="link" icon={<PlusOutlined />} onClick={() => message.info('请直接点击右侧模板中的目标段落或单元格')}>定位添加</Button></Space></div>
          <div style={{ padding: 12 }}>
            {Object.entries(grouped).map(([group, items]) => items.length > 0 && <div key={group} style={{ marginBottom: 15 }}>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 700 }}>{group}</Text>
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {items.map(field => <div key={field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 7, padding: '8px 9px', cursor: 'pointer', color: field === selectedField ? '#0958d9' : '#30343b', background: field === selectedField ? '#e8f3ff' : 'transparent' }} onClick={() => setSelectedField(field)}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field}</span>
                  <Space size={4}>
                    <span style={{ fontSize: 11, color: configs[field]?.mode === 'ai' ? '#1677ff' : '#999' }}>{configs[field]?.mode === 'ai' ? 'AI' : configs[field]?.mode === 'project' ? '资料' : configs[field]?.mode === 'system' ? '系统' : '保留'}</span>
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger onClick={(e) => { e.stopPropagation(); removeField(field) }} style={{ padding: '0 2px', minWidth: 20 }} />
                  </Space>
                </div>)}
              </div>
            </div>)}
            {!fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未扫描到占位符，可手动添加" />}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #e7ebf0', display: 'flex', justifyContent: 'space-between' }}><Text type="secondary">共 {fields.length} 个占位符</Text><Text type="secondary">已配置 {fields.filter(field => !!configs[field]?.requirement).length}</Text></div>
          </div>
        </section>

        <section style={{ borderRight: '1px solid #edf0f3' }}>
          <div style={paneTitle}><span><EyeOutlined /> 原始模板映射</span><Text type="secondary" style={{ fontSize: 11 }}>本页编辑占位符；表头、边框、合并单元格请在 Word/WPS 修改后重新载入</Text></div>
          <div className="template-mapping-canvas" style={{ padding: '16px 22px', background: '#f6f7f9', minHeight: 0 }}>
            <div className="template-preview-scroll" ref={previewRef}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 14 }}>{template?.name || '未关联模板文件'}</Text>
              {decoratedTemplateHtml ? <div
                className="docx-template-preview"
                onClick={event => {
                  const clicked = event.target as HTMLElement
                  const target = clicked.closest<HTMLElement>('[data-field]')
                  if (target?.dataset.field) { setSelectedField(target.dataset.field); return }
                  const anchorElement = clicked.closest<HTMLElement>('td,th,p')
                  const anchor = (anchorElement?.innerText || clicked.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)
                  const cell = clicked.closest<HTMLTableCellElement>('td,th')
                  let locator: Pick<PlaceholderPlacement, 'tableIndex' | 'rowIndex' | 'cellIndex'> | null = null
                  if (cell) {
                    const row = cell.parentElement as HTMLTableRowElement | null
                    const table = cell.closest<HTMLTableElement>('table')
                    const previewRoot = previewRef.current?.querySelector('.docx-template-preview')
                    if (row && table && previewRoot) locator = {
                      tableIndex: [...previewRoot.querySelectorAll('table')].indexOf(table),
                      rowIndex: [...table.rows].indexOf(row),
                      cellIndex: [...row.cells].indexOf(cell),
                    }
                  }
                  if (anchor || locator) {
                    const preview = previewRef.current
                    const targetRect = (anchorElement || clicked).getBoundingClientRect()
                    const previewRect = preview?.getBoundingClientRect()
                    setInlineAnchor(anchor)
                    setInlineLocator(locator)
                    setNewFieldName('')
                    if (preview && previewRect) setInlineEditorPosition({
                      left: Math.max(12, Math.min(targetRect.left - previewRect.left + preview.scrollLeft, preview.scrollWidth - 310)),
                      top: targetRect.bottom - previewRect.top + preview.scrollTop + 6,
                    })
                  }
                }}
                dangerouslySetInnerHTML={{ __html: decoratedTemplateHtml }}
              /> : renderContent()}
              {(inlineAnchor || inlineLocator) && inlineEditorPosition && <div className="template-inline-field-popover" style={{ left: inlineEditorPosition.left, top: inlineEditorPosition.top }}>
                <Input size="small" autoFocus value={newFieldName} onChange={event => setNewFieldName(event.target.value)} onPressEnter={addField} placeholder="占位符名称，回车添加" />
                <Button size="small" type="primary" onClick={addField}>添加</Button>
                <Button size="small" type="text" onClick={() => { setInlineAnchor(''); setInlineLocator(null); setInlineEditorPosition(null); setNewFieldName('') }}>取消</Button>
              </div>}
            </div>
          </div>
        </section>

        <section>
          <div style={paneTitle}><span><FileSearchOutlined style={{ color: '#722ed1' }} /> {selectedField || '字段'} · {current.mode === 'ai' ? 'AI扩写' : '字段设置'}</span>{selectedField && <Tag color={current.requirement ? 'success' : 'default'}>{current.requirement ? '已配置' : '待配置'}</Tag>}</div>
          <div style={{ padding: 16, display: 'grid', gap: 15 }}>
            {!selectedField ? <Empty description="请从左侧选择字段" /> : <>
              <div><Text strong>处理方式</Text><Segmented block style={{ marginTop: 7 }} value={current.mode} onChange={value => updateConfig({ mode: value as FillMode })} options={[{ label: '自动填充', value: 'project' }, { label: 'AI扩写', value: 'ai' }, { label: '保持原样', value: 'keep' }]} /></div>
              <div><Text strong>信息来源</Text><Input value={current.source} onChange={event => updateConfig({ source: event.target.value })} style={{ marginTop: 7 }} placeholder="例如：用户输入、项目资料、系统字段" /></div>
              <div><Text strong>AI 扩写要求</Text><Input.TextArea value={current.requirement} onChange={event => updateConfig({ requirement: event.target.value })} autoSize={{ minRows: 4, maxRows: 7 }} style={{ marginTop: 7 }} placeholder="写清填充依据、表达重点及禁止事项；保存后自动同步到系统提示词" /></div>
              <div><Text strong>建议篇幅</Text><Space style={{ marginTop: 7 }}><InputNumber min={0} value={current.minWords} onChange={value => updateConfig({ minWords: Number(value) || 0 })} />—<InputNumber min={0} value={current.maxWords} onChange={value => updateConfig({ maxWords: Number(value) || 0 })} /> 字</Space></div>
              <div style={{ padding: 12, borderRadius: 8, background: '#fff7e8', display: 'flex', justifyContent: 'space-between' }}><span><CheckCircleFilled style={{ color: '#fa8c16', marginRight: 7 }} />防止编造</span><Switch checked={current.antiFabrication} onChange={value => updateConfig({ antiFabrication: value })} /></div>
              <Button type="primary" ghost icon={<ThunderboltFilled />} loading={generating} onClick={optimizeSelectedField}>AI 优化此字段规则</Button>
            </>}
          </div>
        </section>
      </div>
    </Spin>

    <div style={{ borderTop: '1px solid #edf0f3', background: '#fbfcfe' }}>
      <Collapse ghost items={[{ key: 'constraints', label: <Space><Text strong>全局写作约束</Text><Text type="secondary">反编造铁律、扩写约束和段落格式（点击查看具体内容）</Text></Space>, children: <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
        <Collapse size="small" items={Object.entries(globalDraft).map(([key, rule]) => ({
          key,
          label: <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}><Text strong>{rule.label || key}</Text><Switch size="small" checked={rule.enabled} onClick={(_, event) => event.stopPropagation()} onChange={enabled => setGlobalDraft(prev => ({ ...prev, [key]: { ...rule, enabled } }))} /></div>,
          children: <Input.TextArea value={rule.content} onChange={event => setGlobalDraft(prev => ({ ...prev, [key]: { ...rule, content: event.target.value } }))} autoSize={{ minRows: key === 'ANTI_FABRICATION_RULES' ? 10 : 6, maxRows: 16 }} />,
        }))} />
      </div> }, { key: 'prompts', label: <Space><Text strong>文种完整提示词</Text><Text type="secondary">供 AI 引擎执行，普通用户通常无需修改</Text></Space>, children: <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
        <div><Space><Text strong>系统提示词</Text><Tag color="blue">字段规则保存时自动同步</Tag></Space><Input.TextArea value={draft?.systemTemplate || ''} onChange={event => setDraft(prev => prev ? { ...prev, systemTemplate: event.target.value } : prev)} autoSize={{ minRows: 6, maxRows: 14 }} style={{ marginTop: 7 }} /></div>
        <div><Text strong>用户侧要求</Text><Input.TextArea value={draft?.userTemplate || ''} onChange={event => setDraft(prev => prev ? { ...prev, userTemplate: event.target.value } : prev)} autoSize={{ minRows: 4, maxRows: 10 }} style={{ marginTop: 7 }} /></div>
      </div> }]} />
      <div style={{ borderTop: '1px solid #edf0f3', padding: '12px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">{template ? `已关联：${template.name} · ${fields.length} 个占位符` : '当前未关联模板文件，请先在模板中心上传并扫描'}</Text>
        <Space><Button onClick={() => setPromptOpen(true)} icon={<EyeOutlined />}>查看完整规则</Button><Button type="primary" ghost icon={<FileSearchOutlined />} onClick={() => { setStep(3); setPreviewOpen(true) }}>下一步：检查并保存</Button></Space>
      </div>
    </div>

    <Modal title="模板字段校验" width={860} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => { setPreviewOpen(false); setStep(3) }}>校验完成</Button>}>
      <p>模板字段：{fields.length} 个；AI 扩写字段：{fields.filter(field => configs[field]?.mode === 'ai').length} 个。</p>
      <p style={{ color: '#666', fontSize: 13 }}>下方预览显示模板原文，<span style={{ color: '#1677ff', fontWeight: 600 }}>蓝色高亮</span>为已插入的 <code>{'{{占位符}}'}</code>。新增字段请回到“原始模板映射”中直接点击目标位置。</p>
      {!template?.content && <Button type="link" size="small" icon={<EyeOutlined />} loading={previewLoading} onClick={loadPreview}>加载模板预览内容</Button>}
      {template?.content && <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14, background: '#fafbfc', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8 }}>
        {template.content.split(/(\{\{[^}]+\}\})/g).map((seg, i) => seg.startsWith('{{') && seg.endsWith('}}')
          ? <span key={i} style={{ color: '#1677ff', fontWeight: 600, background: '#e6f4ff', padding: '0 3px', borderRadius: 3 }}>{seg}</span>
          : <span key={i}>{seg}</span>)}
      </div>}
    </Modal>
    <Modal title="完整提示词预览" width={820} open={promptOpen} onCancel={() => setPromptOpen(false)} footer={null}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 560, overflow: 'auto', background: '#f6f8fa', padding: 16 }}>{`【系统提示词】\n${draft?.systemTemplate || ''}\n\n【用户侧要求】\n${draft?.userTemplate || ''}`}</pre></Modal>
    <Modal title="另存为私人模板" open={saveAsOpen} confirmLoading={saving} onCancel={() => setSaveAsOpen(false)} onOk={() => save(true)} okText="另存" cancelText="取消">
      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>保存为独立副本，不修改系统、通用或专业模板。当前占位符和扩写规则会一起保留。</Text>
      <Input value={personalTemplateName} onChange={event => setPersonalTemplateName(event.target.value)} placeholder="私人模板名称" onPressEnter={() => save(true)} />
    </Modal>
    <Modal title={`AI 建议字段（${suggestedFields.length} 个）`} width={680} open={analyzeOpen} onCancel={() => setAnalyzeOpen(false)}
      footer={<Space><Button onClick={() => setAnalyzeOpen(false)}>取消</Button><Button type="primary" onClick={importSuggestions}>导入勾选字段（{selectedSuggestions.length}）</Button></Space>}>
      <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>AI 已分析模板结构，识别出以下可填充位置。勾选要导入的字段，导入后可在右侧配置扩写规则。</div>
      <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
        {suggestedFields.map(f => {
          const checked = selectedSuggestions.includes(f.name)
          const exists = fields.includes(f.name)
          return <div key={f.name} style={{ padding: '10px 14px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'flex-start', gap: 10, background: checked ? '#f6ffed' : 'transparent' }}>
            <input type="checkbox" checked={checked} disabled={exists} onChange={e => setSelectedSuggestions(prev => e.target.checked ? [...prev, f.name] : prev.filter(n => n !== f.name))} style={{ marginTop: 4 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text strong>{f.name}</Text>
                <Tag color={f.mode === 'ai' ? 'blue' : f.mode === 'project' ? 'green' : f.mode === 'system' ? 'orange' : 'default'}>{f.mode === 'ai' ? 'AI扩写' : f.mode === 'project' ? '项目资料' : f.mode === 'system' ? '系统' : '保持'}</Tag>
                {exists && <Tag color="red">已存在</Tag>}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{f.hint}</div>
              <div style={{ fontSize: 11, color: '#999' }}>依据：{f.reason}</div>
            </div>
          </div>
        })}
      </div>
    </Modal>
  </div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, App, Button, Collapse, Empty, Input, InputNumber, Modal, Segmented,
  Select, Space, Spin, Switch, Tag, Typography,
} from 'antd'
import {
  ApartmentOutlined, CheckCircleFilled, CheckOutlined, EyeOutlined,
  FileSearchOutlined, LeftOutlined, ReloadOutlined, RightOutlined,
  SaveOutlined, ThunderboltFilled, ArrowLeftOutlined, FolderOpenOutlined, PlayCircleOutlined,
  PlusOutlined, DeleteOutlined, DownOutlined, LockOutlined,
} from '@ant-design/icons'
import { getDefaultPrompts, mergeDocTypePrompt } from '../shared/docTypePrompts'
import type { DocTypeConfig } from '../shared/docTypePrompts'
import { BUILTIN_DOC_TYPES } from '../shared/builtinDocTypes'
import { useSettingsStore } from '../stores/useSettingsStore'
import { generateDocTypePrompt, analyzeTemplateStructure, generateFieldExpansionRule } from '../services/aiService'
import type { SuggestedField } from '../services/aiService'
import { stripThinkingContent } from '../shared/aiOutput.mjs'
import { buildTemplateStructureMap, deriveTemplateFieldSuggestions, reconcileTemplateFieldPlacements } from '../shared/templateStructureMap.mjs'
import { mergeTemplateAnalysisFields, normalizeTemplateFieldSuggestions, resolveReloadedTemplateFields, suggestPlaceholderNames } from '../shared/templateFieldSuggestions.mjs'
import { buildFieldContract } from '../shared/fieldResolution.mjs'

const { Text, Title } = Typography

type FillMode = 'project' | 'system' | 'ai' | 'keep'
type FieldConfig = {
  mode: FillMode
  source: string
  requirement: string
  required: boolean
  minWords: number
  maxWords: number
  antiFabrication: boolean
  missingInfoPolicy: '留空' | '待确认'
  semanticType?: string
  fillMode?: string
  expansionLevel?: 'exact' | 'normalize' | 'summarize' | 'contextual' | 'advisory' | 'none'
  requiredForGeneration?: boolean
  requiredForDelivery?: boolean
  sourcePriority?: string[]
  dependencies?: string[]
  forbiddenAssertions?: string[]
}

type PlaceholderPlacement = {
  field: string
  anchor?: string
  position: 'before' | 'after' | 'replace'
  tableIndex?: number
  rowIndex?: number
  cellIndex?: number
  paragraphIndex?: number
}

const SYSTEM_FIELDS = ['日期', '日期范围', '周数', '月份', '星期几', '当前时间', '编制日期']
const EXTERNAL_FIELDS = ['天气', '气温', '温度']
const HUMAN_SIGNOFF_FIELDS = ['施工单位签名', '监理单位签名', '建设单位签名', '监理单位签章', '施工单位签章', '签名日期']
// 项目通用字段：新建项目时已写入项目基本信息，生成时直接从项目资料读取，不调 AI
const PROJECT_FIELDS = [
  '项目名称', '工程名称', '项目编号', '文件编号', '编号', '文号',
  '致单位', '致送单位', '建设单位', '建设方', '甲方单位', '甲方', '业主单位', '业主',
  '施工单位', '施工单位名称', '乙方单位', '乙方', '承建单位',
  '监理单位', '监理公司', '项目监理机构', '监理机构',
  '总监理工程师', '总监姓名', '总监理',
  '项目类型', '工程类型',
]

const EMPTY_CONFIG: FieldConfig = {
  mode: 'ai', source: '用户输入与项目资料', requirement: '',
  required: false, minWords: 80, maxWords: 300, antiFabrication: true, missingInfoPolicy: '留空',
}

const FIELD_HINTS: Record<string, string> = {
  项目名称: '从项目资料读取正式全称，不得改写或推测。',
  日期: '优先采用用户提供或项目资料中的日期；缺失时标注待确认。',
  星期几: '根据已确认日期计算，不得自行假定日期。',
  天气: '优先采用用户或现场资料中的实况；未提供时根据项目实施区域和业务日期自动查询。历史实况、当日数据和预报必须区分，不得猜测。',
  气温: '优先保留现场记录的原始数值和单位；未提供时根据项目实施区域和业务日期自动查询最低/最高气温。',
  施工部位: '从用户事实归纳实际作业范围；可写“光缆线路沿线及交接箱安装点位”等类别性部位，不得补造楼栋、道路、桩号或精确地址。',
  参与人员: '列出已提供的单位、岗位与姓名，不增加未出现人员。',
  今日内容: '按时间或工序归纳当天完成事项，突出可核验事实。',
  核心工作落实: '围绕已知施工内容简单扩写控制重点；已实施检查必须有事实来源，没有检查事实时只能写后续关注点或建议核对事项。',
  协调解决情况: '优先整理已知协调事实；未提供协调对象或结果时不得补造，可留空或写成后续需要关注的接口衔接事项。',
  其他事项: '可结合当前工序补充成品保护、资料整理、安全关注和后续工作建议，但不得写成已经完成的检查或整改事实。',
}

function normalizeTemplateFieldConfig(field: string, config: FieldConfig): FieldConfig {
  const enrich = (value: FieldConfig): FieldConfig => {
    const contract = buildFieldContract(field, value)
    return {
      ...value,
      semanticType: contract.semanticType,
      fillMode: contract.fillMode,
      expansionLevel: contract.expansionLevel,
      requiredForGeneration: contract.requiredForGeneration,
      requiredForDelivery: contract.requiredForDelivery,
      sourcePriority: contract.sourcePriority,
      dependencies: contract.dependencies,
      forbiddenAssertions: contract.forbiddenAssertions,
    }
  }
  if (HUMAN_SIGNOFF_FIELDS.includes(field)) {
    return enrich({ ...config, mode: 'keep', fillMode: 'manual', expansionLevel: 'none', source: '人工签章', requirement: '', required: false, minWords: 0, maxWords: 0, missingInfoPolicy: '留空' })
  }
  if (field.startsWith('表格行')) {
    const label = field.replace(/^表格行/, '')
    const requirement = label === '其它情况'
      ? '仅根据用户已提供事实填写差异或其它情况；没有明确说明时留空，不得推测原因。'
      : `仅提取当前明细行的“${label}”原始值，保留数值和单位；用户未提供时留空，不得补造。`
    return enrich({ ...config, mode: 'ai', fillMode: 'fact-extraction', expansionLevel: label === '其它情况' ? 'summarize' : 'exact', source: '用户输入中的明确事实', requirement, required: false, minWords: 0, maxWords: label === '其它情况' ? 120 : 40, antiFabrication: true, missingInfoPolicy: '留空' })
  }
  // 文件路径是用户选择/上传的资源引用，不是可由模型“扩写”的正文。
  // 强制归为自动填充，避免模型生成不存在的本地路径。
  if (/^(?:图|图片|照片|附件)\d*(?:文件)?路径$/.test(field)) {
    return enrich({ ...config, mode: 'project', fillMode: 'fact-extraction', expansionLevel: 'exact', source: '用户上传附件或项目资料', requirement: '只使用用户已选择或项目中已归档的真实文件路径；没有对应文件时留空。', required: false, minWords: 0, maxWords: 0, antiFabrication: true, missingInfoPolicy: '留空' })
  }
  if (field === '局点名称') {
    return enrich({ ...config, requirement: '仅提取用户明确提供的局点名称；未提供时留空，不得用项目名称代替。', required: false, minWords: 0, maxWords: 40, missingInfoPolicy: '留空' })
  }
  return enrich(config)
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

function injectMappedPlaceholder(html: string, placement: PlaceholderPlacement, selectedField: string, mode: FillMode = 'ai') {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  // A DOCX placeholder may be split across multiple Word runs. Once mammoth
  // reconstructs it, the decorated HTML already contains data-field even when
  // an older field scan missed it. Never draw a pending placement a second time.
  if ([...documentNode.body.querySelectorAll<HTMLElement>('[data-field]')]
    .some(element => element.dataset.field === placement.field)) return html
  const createButton = () => {
    const button = documentNode.createElement('button')
    button.type = 'button'
    button.className = `placeholder ${mode === 'ai' ? 'ai' : 'keep'}${placement.field === selectedField ? ' selected' : ''}`
    button.dataset.field = placement.field
    button.textContent = `{{${placement.field}}}`
    const badge = documentNode.createElement('span')
    badge.textContent = mode === 'ai' ? 'AI扩写' : mode === 'project' ? '项目资料' : mode === 'system' ? '系统填充' : '保持原样'
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
  if (Number.isInteger(placement.paragraphIndex)) {
    const paragraph = documentNode.body.querySelectorAll('p')[placement.paragraphIndex!] as HTMLParagraphElement | undefined
    if (paragraph) {
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
  const mode: FillMode = SYSTEM_FIELDS.includes(field) || EXTERNAL_FIELDS.includes(field) ? 'system' : PROJECT_FIELDS.includes(field) ? 'project' : 'ai'
  return normalizeTemplateFieldConfig(field, {
    ...EMPTY_CONFIG,
    mode,
    source: EXTERNAL_FIELDS.includes(field) ? '现场记录优先；缺失时按项目位置和业务日期自动查询' : mode === 'system' ? '系统自动计算' : mode === 'project' ? '项目资料' : '用户输入与项目资料',
    requirement: FIELD_HINTS[field] || `围绕“${field}”提取可核验事实，按模板语气整理；信息不足时标注待确认。`,
    required: false,
    missingInfoPolicy: mode === 'ai' ? '留空' : '留空',
  })
}

function extractFieldContext(content: string, field: string, radius = 900) {
  if (!content.trim()) return ''
  const markers = [`{{${field}}}`, `【${field}】`, field]
  const indexes = markers.map(marker => content.indexOf(marker)).filter(index => index >= 0)
  const index = indexes.length ? Math.min(...indexes) : -1
  if (index < 0) return content.slice(0, radius * 2)
  const start = Math.max(0, index - radius)
  const end = Math.min(content.length, index + field.length + 4 + radius)
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
}

export default function DocTypePromptEditorV2({ initialDocType, templateId, onBack, onSaved }: { initialDocType?: string; templateId?: string; onBack?: () => void; onSaved?: () => void }) {
  const { message } = App.useApp()
  const { docTypePromptOverrides, applyCustomTypes, customDocTypes } = useSettingsStore()
  const defaults = useMemo(() => getDefaultPrompts(), [])
  const docTypes = useMemo(() => [
    ...BUILTIN_DOC_TYPES.map(label => ({ key: label, label, projectType: null as string | null })),
    ...(customDocTypes || []).map(item => ({ key: item.code, label: item.label, projectType: item.projectType })),
  ], [customDocTypes])

  const [activeKey, setActiveKey] = useState('')
  const [draft, setDraft] = useState<DocTypeConfig | null>(null)
  const [template, setTemplate] = useState<{ id?: string; name: string; path: string; fields: string[]; content: string; html: string; isSystem?: boolean; projectType?: string } | null>(null)
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
  const [inlineLocator, setInlineLocator] = useState<Pick<PlaceholderPlacement, 'tableIndex' | 'rowIndex' | 'cellIndex' | 'paragraphIndex'> | null>(null)
  const [inlineEditorPosition, setInlineEditorPosition] = useState<{ left: number; top: number } | null>(null)
  const [locatingField, setLocatingField] = useState(false)
  const [inlineExistingField, setInlineExistingField] = useState('')
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
  const templateLoadRequestRef = useRef(0)

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
    const saved = ((next.extras as any)?.fieldConfigs || {}) as Record<string, Partial<FieldConfig>>
    const legacy = ((next.extras as any)?.fieldRules || {}) as Record<string, string>
    // `next.fields` 是 AI 输出契约，只列出需要模型生成的字段；项目资料、系统字段、
    // 保持原样字段则完整保存在 extras.fieldConfigs。加载时必须取并集，否则保存一次后
    // 非 AI 字段会从规则编辑器消失，造成“模板实际有 7 个字段，界面只剩 5 个”的假象。
    const contractKeys = (next.fields || []).map(field => typeof field === 'string' ? field : field.key)
    const keys = [...new Set([...contractKeys, ...Object.keys(saved)])]
    const merged: Record<string, FieldConfig> = {}
    for (const key of keys) {
      const fieldContract = (next.fields || []).find(field => (typeof field === 'string' ? field : field.key) === key) as any
      merged[key] = normalizeTemplateFieldConfig(key, {
        ...defaultFieldConfig(key),
        required: fieldContract?.required === true,
        minWords: fieldContract?.minWords ?? defaultFieldConfig(key).minWords,
        maxWords: fieldContract?.maxWords ?? defaultFieldConfig(key).maxWords,
        ...(saved[key] || {}),
        requirement: saved[key]?.requirement || legacy[key] || defaultFieldConfig(key).requirement,
      })
    }
    setConfigs(merged)
  }, [activeKey, defaults, docTypePromptOverrides])

  const loadTemplate = async (requestedTemplateId?: string, requestedDocTypeLabel?: string) => {
    const docTypeLabel = requestedDocTypeLabel || activeItem?.label
    if (!docTypeLabel) return
    const requestId = ++templateLoadRequestRef.current
    setLoadingTemplate(true)
    try {
      const [library, system] = await Promise.all([window.electronAPI.listTemplateLibrary(), window.electronAPI.listSystemTemplates()])
      if (requestId !== templateLoadRequestRef.current) return
      // 列出当前文种所有可用模板（私人库 > 专业库 > 通用库 > 系统预置）
      const matched = [
        ...library.filter(t => t.docType === docTypeLabel && t.scope === 'personal').map(t => ({ id: t.id, name: `${t.name}（私人库）`, scope: t.scope, source: 'personal' })),
        ...library.filter(t => t.docType === docTypeLabel && t.scope === 'professional').map(t => ({ id: t.id, name: `${t.name}（专业库·${t.projectTypeLabel || t.projectType}）`, scope: t.scope, source: 'professional' })),
        ...library.filter(t => t.docType === docTypeLabel && t.scope === 'global').map(t => ({ id: t.id, name: `${t.name}（通用库）`, scope: t.scope, source: 'global' })),
        ...system.filter(t => t.docType === docTypeLabel).map(t => ({ id: t.id, name: `${t.name}`, scope: t.scope, source: 'system' })),
      ]
      setAvailableTemplates(matched)
      // 只能沿用当前文种内的模板 ID；切换文种时，上一文种的 selectedTemplateId 必须失效。
      const preferredTemplateId = requestedTemplateId || templateId || selectedTemplateId
      const targetId = matched.some(item => item.id === preferredTemplateId) ? preferredTemplateId : matched[0]?.id
      const found = library.find(item => item.id === targetId && item.docType === docTypeLabel)
        || system.find(item => item.id === targetId && item.docType === docTypeLabel)
        || library.find(item => item.docType === docTypeLabel)
        || system.find(item => item.docType === docTypeLabel)
      if (!found?.path) {
        setTemplate(null)
        setSelectedTemplateId('')
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
      if (requestId !== templateLoadRequestRef.current) return
      // 重载必须以源文件当前扫描结果为真相源。旧登记字段只能在扫描失败时兜底，
      // 不能取并集，否则在 Word/WPS 中删除或改名的字段会永久残留。
      const fields = resolveReloadedTemplateFields(Boolean(scanResult?.ok), scanResult?.fields || [], found.fields || [])
      const compactContent = parsed?.success ? (parsed.content || '')
        .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''
      setRecognitionError(fields.length ? '' : '没有识别到占位符。可手动设定字段，或让 AI 重新分析模板结构。')
      setTemplate({ id: found.id, name: found.sourceName || docTypeLabel, path: found.path, fields, content: compactContent, html: parsed?.success ? parsed.html || '' : '', isSystem, projectType: (found as any).projectTypeLabel || (found as any).projectType || activeItem?.projectType || '通用' })
      setPendingPlacements([])
      setDeletedFields([])
      setInlineAnchor('')
      setInlineLocator(null)
      setInlineEditorPosition(null)
      setInitialFields(fields)
      setConfigs(previous => Object.fromEntries(fields.map(field => [
        field,
        normalizeTemplateFieldConfig(field, previous[field] || defaultFieldConfig(field)),
      ])))
      setSelectedField(current => fields.includes(current) ? current : fields[0] || '')
      setStep(fields.length ? 2 : 1)
    } catch (error: any) {
      if (requestId !== templateLoadRequestRef.current) return
      const detail = `模板读取失败：${error?.message || error}`
      setRecognitionError(detail)
      message.error(detail)
    } finally {
      if (requestId === templateLoadRequestRef.current) setLoadingTemplate(false)
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

  // 直接重读当前页面绑定的精确文件路径，不重新经过模板优先级选择。
  // 这避免“点了重新载入，却因为同文种存在多份模板而又加载回旧文件”。
  const reloadCurrentTemplateSource = async () => {
    if (!template?.path) return
    setLoadingTemplate(true)
    try {
      const [scanResult, parsed] = await Promise.all([
        window.electronAPI.getTemplateFields(template.path),
        window.electronAPI.readFileContent(template.path),
      ])
      if (!scanResult?.ok) throw new Error(scanResult?.error || '占位符扫描失败')
      if (!parsed?.success) throw new Error(parsed?.error || '模板正文读取失败')
      const fields = resolveReloadedTemplateFields(true, scanResult.fields || [], [])
      const compactContent = (parsed.content || '')
        .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      setTemplate(previous => previous ? { ...previous, fields, content: compactContent, html: parsed.html || '' } : previous)
      setConfigs(previous => Object.fromEntries(fields.map(field => [
        field,
        normalizeTemplateFieldConfig(field, previous[field] || defaultFieldConfig(field)),
      ])))
      setInitialFields(fields)
      setSelectedField(current => fields.includes(current) ? current : fields[0] || '')
      setPendingPlacements([])
      setDeletedFields([])
      setInlineAnchor('')
      setInlineLocator(null)
      setInlineEditorPosition(null)
      setLocatingField(false)
      setRecognitionError(fields.length ? '' : '源文件中没有识别到占位符')
      message.success(`已从当前源文件重新载入：${fields.length} 个占位符`)
    } catch (error: any) {
      message.error(`重新载入失败：${error?.message || error}`)
    } finally {
      setLoadingTemplate(false)
    }
  }

  // 内置模板在首次安装时已复制到用户文档目录，是可编辑的企业默认模板。
  // 安装包内文件仅作为恢复种子；日常修改必须始终绑定当前这份运行时文件。
  const openEditableTemplateSource = async () => {
    if (!template?.path) return
    try {
      const opened = await window.electronAPI.openFile(template.path)
      if (!opened?.success) throw new Error(opened?.error || '无法打开模板文件')
      if (template.isSystem) message.info('正在编辑内置模板的用户工作副本；保存后请回到这里重新载入')
    } catch (error: any) {
      message.error(`打开模板失败：${error?.message || error}`)
    }
  }

  useEffect(() => {
    if (!activeItem?.label) return
    setTemplate(null)
    setAvailableTemplates([])
    setSelectedTemplateId('')
    setSelectedField('')
    void loadTemplate(undefined, activeItem.label)
  }, [activeItem?.label, templateId])

  const fields = template?.fields || Object.keys(configs)
  const inlineSuggestedNames = useMemo(
    () => suggestPlaceholderNames(inlineAnchor, fields, suggestedFields),
    [inlineAnchor, fields, suggestedFields],
  )
  useEffect(() => { if (!selectedField && fields[0]) setSelectedField(fields[0]) }, [fields, selectedField])
  const current = configs[selectedField] || defaultFieldConfig(selectedField)

  const grouped = useMemo(() => ({
    '基础信息': fields.filter(field => configs[field]?.mode === 'project'),
    '系统字段': fields.filter(field => configs[field]?.mode === 'system'),
    'AI 扩写字段': fields.filter(field => configs[field]?.mode === 'ai'),
    '人工或固定内容': fields.filter(field => configs[field]?.mode === 'keep'),
  }), [fields, configs])
  // 默认收起分组，先展示整体字段结构；用户需要时再逐组展开编辑。
  const [collapsedFieldGroups, setCollapsedFieldGroups] = useState<Set<string>>(
    () => new Set(['基础信息', '系统字段', 'AI 扩写字段', '人工或固定内容']),
  )

  const toggleFieldGroup = (group: string) => {
    setCollapsedFieldGroups(previous => {
      const next = new Set(previous)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const updateConfig = (patch: Partial<FieldConfig>) => {
    if (!selectedField) return
    setConfigs(prev => ({ ...prev, [selectedField]: { ...(prev[selectedField] || defaultFieldConfig(selectedField)), ...patch } }))
  }

  // 映射区就地添加字段：先点模板位置，再从系统/AI 建议中选择字段名。
  const addField = () => {
    const name = newFieldName.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
    if (!name) { message.warning('请输入占位符名称'); return }
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
    setInlineExistingField('')
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
      let html = template.html
      if (!content || !html) {
        const parsed = await window.electronAPI.readFileContent(template.path)
        if (!parsed.success || !parsed.content) throw new Error('模板内容读取失败')
        content = (parsed.content || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
        html = parsed.html || ''
        setTemplate(prev => prev ? { ...prev, content, html } : prev)
      }
      // 2. 本地识别只作失败兜底，不能冒充“AI 分析”并提前结束。
      //    AI 必须重新核对已有占位符的字段规则，同时发现模板新增的空白填值位。
      const localFields = reconcileTemplateFieldPlacements(
        normalizeTemplateFieldSuggestions(deriveTemplateFieldSuggestions(content, html) as unknown as SuggestedField[]),
        html,
      ) as unknown as SuggestedField[]
      const settings = await window.electronAPI.getSettings()
      const result = await analyzeTemplateStructure(
        { provider: (settings.aiProvider as any) || 'deepseek', baseUrl: settings.baseUrl || '', model: settings.model || '' },
        activeItem.label,
        content,
        fields,
        buildTemplateStructureMap(html),
      )
      const analyzedFields = result.success && result.fields?.length
        ? reconcileTemplateFieldPlacements(result.fields, html) as SuggestedField[]
        : localFields
      if (!analyzedFields.length && !fields.length) throw new Error(result.error || 'AI 未识别出字段')
      const reconciledFields = mergeTemplateAnalysisFields(fields, analyzedFields, field => {
        const currentConfig = configs[field] || defaultFieldConfig(field)
        return {
          name: field,
          label: field,
          mode: currentConfig.mode,
          hint: currentConfig.requirement,
          reason: result.success ? '模板已有占位符，AI 本次漏报，已保留当前规则供复核' : 'AI 分析失败，已使用当前字段规则兜底',
          anchorText: `{{${field}}}`,
          insertPosition: 'after',
          rule: currentConfig,
        } as SuggestedField
      }) as SuggestedField[]
      setRecognitionError('')
      setSuggestedFields(reconciledFields)
      setSelectedSuggestions(reconciledFields.map(f => f.name))
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
    let refreshedCount = 0
    const nextConfigs = { ...configs }
    for (const f of picked) {
      const existed = fields.includes(f.name)
      nextConfigs[f.name] = normalizeTemplateFieldConfig(f.name, {
        mode: f.mode,
        requirement: f.rule?.requirement || f.hint,
        required: f.rule?.required === true,
        minWords: f.rule?.minWords ?? (f.mode === 'ai' ? 80 : 0),
        maxWords: f.rule?.maxWords ?? (f.mode === 'ai' ? 300 : 80),
        antiFabrication: f.rule?.antiFabrication !== false,
        missingInfoPolicy: f.rule?.missingInfoPolicy || (f.mode === 'ai' ? '待确认' : '留空'),
        source: f.rule?.source || (f.mode === 'system' ? '系统自动计算' : f.mode === 'project' ? '项目资料' : '用户输入与项目资料'),
        semanticType: f.rule?.semanticType,
        fillMode: f.rule?.fillMode,
        expansionLevel: f.rule?.expansionLevel,
        requiredForGeneration: f.rule?.requiredForGeneration === true,
        requiredForDelivery: f.rule?.requiredForDelivery === true || f.rule?.required === true,
        sourcePriority: f.rule?.sourcePriority,
        dependencies: f.rule?.dependencies,
        forbiddenAssertions: f.rule?.forbiddenAssertions,
      })
      if (existed) refreshedCount += 1
      else newFields.push(f.name)
    }
    setConfigs(nextConfigs)
    const placements = picked
      .filter(f => !fields.includes(f.name) && (f.anchorText || [f.tableIndex, f.rowIndex, f.cellIndex].every(Number.isInteger)))
      .map(f => ({
        field: f.name,
        anchor: f.anchorText.trim(),
        position: (f.insertPosition === 'before' ? 'before' : f.insertPosition === 'replace' ? 'replace' : 'after') as 'before' | 'after' | 'replace',
        tableIndex: f.tableIndex,
        rowIndex: f.rowIndex,
        cellIndex: f.cellIndex,
      }))
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
    if (newFields.length) setSelectedField(newFields[0])
    message.success(`已更新 ${refreshedCount} 个现有字段规则${newFields.length ? `，并导入 ${newFields.length} 个新字段` : ''}，请核对后保存`)
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
      const cleanedConfigs = Object.fromEntries(Object.entries(configs).map(([field, config]) => [field, normalizeTemplateFieldConfig(field, {
        ...config,
        source: stripThinkingContent(config.source).trim(),
        requirement: stripThinkingContent(config.requirement).trim(),
      })])) as Record<string, FieldConfig>
      const locked = fields.filter(field => cleanedConfigs[field]?.mode === 'ai')
      const lines = locked.map(field => {
        const c = cleanedConfigs[field] || defaultFieldConfig(field)
        return `- 【${field}】：来源=${c.source}；要求=${c.requirement}；篇幅=${c.minWords}-${c.maxWords}字；${c.required ? '必填' : '可选'}；缺失时=${c.missingInfoPolicy}；${c.antiFabrication ? '禁止编造' : '允许依据上下文合理整理'}`
      })
      const lockBlock = lines.length ? `【占位符锁定规则】\n仅填充以下 AI 扩写占位符，其他模板内容保持不变：\n${lines.join('\n')}\n【/占位符锁定规则】\n\n` : ''
      const cleanSystem = draft.systemTemplate.replace(/【占位符锁定规则】[\s\S]*?【\/占位符锁定规则】\s*/g, '')
      const contractLines = fields.map(field => {
        const c = cleanedConfigs[field] || defaultFieldConfig(field)
        if (c.mode === 'ai') return `- 【${field}】${c.requirement}；${c.required ? '必填' : '可选'}；建议 ${c.minWords}-${c.maxWords} 字；信息不足时${c.missingInfoPolicy}；${c.antiFabrication ? '禁止编造。' : ''}`
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
        userTemplate: draft.userTemplate.trim() || '【任务】根据以下用户事实填写当前模板中允许 AI 扩写的字段。\n\n【用户事实】\n${userInput}\n\n只输出模板字段契约要求的【字段名】字段；信息不足时留空或标注“待确认”，不得编造。',
        fields: locked.map(key => ({
          key,
          required: cleanedConfigs[key]?.required === true,
          minWords: cleanedConfigs[key]?.minWords,
          maxWords: cleanedConfigs[key]?.maxWords,
        })),
        extras: { ...(draft.extras || {}), fieldConfigs: cleanedConfigs, fieldRules: Object.fromEntries(locked.map(key => [key, cleanedConfigs[key]?.requirement || ''])) },
      }
      const nextOverrides = { ...(docTypePromptOverrides || {}) } as Record<string, any>
      nextOverrides[activeKey] = {
        systemTemplate: nextDraft.systemTemplate, userTemplate: nextDraft.userTemplate,
        minWords: nextDraft.minWords, fields: nextDraft.fields, extras: nextDraft.extras,
      }
      const settings = await window.electronAPI.getSettings()
      const result = await window.electronAPI.setSettings({ ...settings, docTypePromptOverrides: nextOverrides })
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
              saveAsPersonal,
              name: personalTemplateName.trim() || `${activeItem?.label || activeKey}私人模板`,
            })
            if (saveRes?.ok) {
              // 系统模板会被克隆到企业库，更新 template 指向新路径
              if (saveRes.clonedToLibrary) {
                const marked = await window.electronAPI.markTemplateRuleConfigured(saveRes.clonedToLibrary.id)
                if (!marked?.ok) throw new Error(marked?.error || '私人模板规则状态保存失败')
                setTemplate(prev => prev ? { ...prev, path: saveRes.path!, id: saveRes.clonedToLibrary.id, isSystem: false } : prev)
                setSelectedTemplateId(saveRes.clonedToLibrary.id)
                message.success(saveAsPersonal ? '已另存为私人模板' : '模板及规则已保存')
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

      // 必须在模板文件和字段变更全部写回之后再确认规则版本；否则刷新字段会把刚保存的规则误判为过期。
      if (template?.id && !template.isSystem) {
        const marked = await window.electronAPI.markTemplateRuleConfigured(template.id)
        if (!marked?.ok) throw new Error(marked?.error || '模板规则状态保存失败')
      }

      setStep(3)
      setSaveAsOpen(false)
      setPersonalTemplateName('')
      if (!template?.path || !(fields.filter(f => !initialFields.includes(f)).length || initialFields.filter(f => !fields.includes(f)).length)) {
        message.success('规则已保存，并已接入 AI 扩写')
      }
      if (!saveAsPersonal) onSaved?.()
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
      for (const field of fields) next[field] = normalizeTemplateFieldConfig(field, { ...(next[field] || defaultFieldConfig(field)), requirement: FIELD_HINTS[field] || next[field]?.requirement || defaultFieldConfig(field).requirement })
      setConfigs(next)
      message.success('AI 已整理字段规则，请确认后保存')
    } catch (error: any) { message.error(`AI 整理失败：${error?.message || error}`) }
    finally { setGenerating(false) }
  }

  const generateSelectedFieldRule = async (mode: 'suggest' | 'polish') => {
    if (!selectedField || !activeItem) return
    setGenerating(true)
    try {
      const settings = await window.electronAPI.getSettings()
      const result = await generateFieldExpansionRule(
        { provider: (settings.aiProvider as any) || 'deepseek', baseUrl: settings.baseUrl || '', model: settings.model || '' },
        {
          operation: mode,
          docType: activeItem.label,
          projectType: template?.projectType,
          field: selectedField,
          userDescription: mode === 'polish' ? current.requirement : '',
          localContext: extractFieldContext(template?.content || '', selectedField),
          siblingFields: fields,
        },
      )
      if (!result.success || !result.rule) throw new Error(result.error || '模型未返回规则')
      updateConfig({
        mode: result.rule.mode,
        source: result.rule.source,
        requirement: result.rule.requirement,
        required: current.required,
        minWords: result.rule.minWords,
        maxWords: result.rule.maxWords,
        antiFabrication: result.rule.antiFabrication,
        missingInfoPolicy: current.missingInfoPolicy,
        expansionLevel: result.rule.expansionLevel || current.expansionLevel,
        requiredForGeneration: result.rule.requiredForGeneration === true,
        requiredForDelivery: result.rule.requiredForDelivery === true,
      })
      message.success(mode === 'suggest' ? `已建议“${selectedField}”字段规则` : `已润色“${selectedField}”字段规则`)
    } catch (error: any) { message.error(`字段规则生成失败：${error?.message || error}`) }
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
    for (const placement of pendingPlacements) safe = injectMappedPlaceholder(safe, placement, selectedField, configs[placement.field]?.mode || 'ai')
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
        {availableTemplates.length > 0 && <Select value={selectedTemplateId || undefined} onChange={(id) => { setSelectedTemplateId(id); void loadTemplate(id, activeItem?.label) }} variant="borderless" style={{ width: 220 }} options={availableTemplates.map(t => ({ value: t.id, label: t.name }))} placeholder="选择模板来源" />}
      </Space>
      <Space wrap className="template-editor-actions">
        <Button icon={<FolderOpenOutlined />} disabled={!template?.path} onClick={openEditableTemplateSource}>用 Word/WPS 编辑源文件</Button>
        <Button icon={<ReloadOutlined />} disabled={!template?.path} onClick={reloadCurrentTemplateSource}>源文件保存后重新载入</Button>
        <Button type="primary" ghost icon={<ThunderboltFilled />} loading={analyzing} onClick={analyzeTemplate}>AI 分析模板结构</Button>
        <Button icon={<ReloadOutlined />} onClick={() => loadTemplate(selectedTemplateId, activeItem?.label)}>重新扫描</Button>
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
          <div style={paneTitle}><span><ApartmentOutlined /> 占位符结构</span><Space size={6}><Tag color="blue">{fields.length} 个</Tag>{deletedFields.length > 0 && <Button size="small" type="link" onClick={restoreLastDeletedField}>撤销删除（{deletedFields.length}）</Button>}<Button size="small" type={locatingField ? 'primary' : 'link'} icon={<PlusOutlined />} onClick={() => { setLocatingField(value => !value); message.info(locatingField ? '已退出定位添加' : '定位模式已开启：请点击右侧模板中的目标段落或单元格') }}>{locatingField ? '退出定位' : '定位添加'}</Button></Space></div>
          <div className="placeholder-tree">
            {Object.entries(grouped).map(([group, items]) => {
              if (!items.length) return null
              const collapsed = collapsedFieldGroups.has(group)
              return <div className="placeholder-tree-group" key={group}>
                <button className="placeholder-tree-heading" type="button" aria-expanded={!collapsed} onClick={() => toggleFieldGroup(group)}>
                  <span className="placeholder-tree-chevron">{collapsed ? <RightOutlined /> : <DownOutlined />}</span>
                  <span className="placeholder-tree-heading-label">{group}</span>
                  <span className="placeholder-tree-count">{items.length}</span>
                </button>
                {!collapsed && <div className="placeholder-tree-children">
                {items.map(field => <div key={field} className={`placeholder-tree-item${field === selectedField ? ' selected' : ''}`} onClick={() => setSelectedField(field)}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field}</span>
                  <Space size={4}>
                    <span className={`placeholder-tree-mode ${configs[field]?.mode || 'ai'}`}>{configs[field]?.mode === 'ai' ? 'AI' : configs[field]?.mode === 'project' ? '资料' : configs[field]?.mode === 'system' ? '系统' : '保留'}</span>
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger onClick={(e) => { e.stopPropagation(); removeField(field) }} style={{ padding: '0 2px', minWidth: 20 }} />
                  </Space>
                </div>)}
              </div>}
            </div>})}
            {!fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未扫描到占位符，可定位后从建议中选择" />}
            <div className="placeholder-tree-summary"><Text type="secondary">共 {fields.length} 个占位符</Text><Text type="secondary">已配置 {fields.filter(field => !!configs[field]?.requirement).length}</Text></div>
          </div>
        </section>

        <section style={{ borderRight: '1px solid #edf0f3' }}>
          <div style={paneTitle}><span><EyeOutlined /> 原始模板映射</span><Text type="secondary" style={{ fontSize: 11 }}>本页编辑占位符；表头、边框、合并单元格请在 Word/WPS 修改后重新载入</Text></div>
          <div className="template-mapping-canvas" style={{ padding: '16px 22px', background: '#f6f7f9', minHeight: 0 }}>
            {locatingField && <Alert type="info" showIcon banner message="定位添加已开启：点击目标位置，可直接编辑 {{字段名}} 或采用本地建议" style={{ marginBottom: 10 }} />}
            <div className="template-preview-scroll" ref={previewRef}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 14 }}>{template?.name || '未关联模板文件'}</Text>
              {decoratedTemplateHtml ? <div
                className={`docx-template-preview${locatingField ? ' locating' : ''}`}
                onClick={event => {
                  const clicked = event.target as HTMLElement
                  const target = clicked.closest<HTMLElement>('[data-field]')
                  // Existing placeholders always take precedence over placement mode.
                  // Otherwise, after locating a blank paragraph, locatingField remains true
                  // and clicking an existing placeholder is incorrectly treated as a new
                  // paragraph placement, hiding the delete action.
                  if (target?.dataset.field) {
                    const field = target.dataset.field
                    setSelectedField(field)
                    setInlineExistingField(field)
                    setInlineAnchor('')
                    setInlineLocator(null)
                    const preview = previewRef.current
                    const targetRect = target.getBoundingClientRect()
                    const previewRect = preview?.getBoundingClientRect()
                    if (preview && previewRect) setInlineEditorPosition({
                      left: Math.max(12, Math.min(targetRect.left - previewRect.left + preview.scrollLeft, preview.scrollWidth - 330)),
                      top: targetRect.bottom - previewRect.top + preview.scrollTop + 6,
                    })
                    return
                  }
                  const anchorElement = clicked.closest<HTMLElement>('td,th,p')
                  const anchor = (anchorElement?.innerText || clicked.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)
                  const cell = clicked.closest<HTMLTableCellElement>('td,th')
                  let locator: Pick<PlaceholderPlacement, 'tableIndex' | 'rowIndex' | 'cellIndex' | 'paragraphIndex'> | null = null
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
                  if (!locator && anchorElement?.tagName === 'P') {
                    const previewRoot = previewRef.current?.querySelector('.docx-template-preview')
                    if (previewRoot) locator = {
                      paragraphIndex: [...previewRoot.querySelectorAll('p')].indexOf(anchorElement as HTMLParagraphElement),
                    }
                  }
                  if (anchor || locator) {
                    const preview = previewRef.current
                    const targetRect = (anchorElement || clicked).getBoundingClientRect()
                    const previewRect = preview?.getBoundingClientRect()
                    setInlineAnchor(anchor)
                    setInlineLocator(locator)
                    setInlineExistingField('')
                    const recommendations = suggestPlaceholderNames(anchor, fields, suggestedFields)
                    setNewFieldName(recommendations[0] || '')
                    if (preview && previewRect) setInlineEditorPosition({
                      left: Math.max(12, Math.min(targetRect.left - previewRect.left + preview.scrollLeft, preview.scrollWidth - 310)),
                      top: targetRect.bottom - previewRect.top + preview.scrollTop + 6,
                    })
                    setLocatingField(true)
                  }
                }}
                dangerouslySetInnerHTML={{ __html: decoratedTemplateHtml }}
              /> : renderContent()}
              {inlineExistingField && inlineEditorPosition && <div className="template-inline-field-popover" style={{ left: inlineEditorPosition.left, top: inlineEditorPosition.top }}>
                <Tag color="blue" style={{ margin: 0 }}>{`{{${inlineExistingField}}}`}</Tag>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { removeField(inlineExistingField); setInlineExistingField(''); setInlineEditorPosition(null) }}>删除占位符</Button>
                <Button size="small" type="text" onClick={() => { setInlineExistingField(''); setInlineEditorPosition(null) }}>取消</Button>
              </div>}
              {(inlineAnchor || inlineLocator) && !inlineExistingField && inlineEditorPosition && <div className="template-inline-field-popover editor" style={{ left: inlineEditorPosition.left, top: inlineEditorPosition.top }}>
                <Text strong style={{ fontSize: 12 }}>添加占位符</Text>
                <Input
                  size="small"
                  autoFocus
                  value={newFieldName}
                  onChange={event => setNewFieldName(event.target.value.replace(/[{}]/g, ''))}
                  onPressEnter={addField}
                  addonBefore="{{"
                  addonAfter="}}"
                  placeholder="字段名称"
                />
                {inlineSuggestedNames.length > 0 && <div className="template-placeholder-suggestions">
                  <Text type="secondary" style={{ fontSize: 11 }}>建议：</Text>
                  {inlineSuggestedNames.slice(0, 4).map(name => <Button key={name} size="small" type="link" onClick={() => setNewFieldName(name)}>{name}</Button>)}
                </div>}
                <div className="template-inline-field-actions">
                  <Button size="small" type="primary" disabled={!newFieldName.trim()} onClick={addField}>添加</Button>
                  <Button size="small" onClick={() => { setInlineAnchor(''); setInlineLocator(null); setInlineEditorPosition(null); setNewFieldName(''); setLocatingField(false) }}>取消</Button>
                </div>
              </div>}
            </div>
          </div>
        </section>

        <section>
          <div style={paneTitle}><span><FileSearchOutlined style={{ color: '#722ed1' }} /> {selectedField || '字段'} · {current.mode === 'ai' ? 'AI扩写' : '字段设置'}</span>{selectedField && <Tag color={current.requirement ? 'success' : 'default'}>{current.requirement ? '已配置' : '待配置'}</Tag>}</div>
          <div style={{ padding: 16, display: 'grid', gap: 15 }}>
            {!selectedField ? <Empty description="请从左侧选择字段" /> : <>
              <Alert type="info" showIcon message="这里只设置当前占位符的具体要求；所有文档共用的要求请返回模板中心，在“全局规则”中管理。" />
              <div><Text strong>处理方式</Text><Segmented block style={{ marginTop: 7 }} value={current.mode} onChange={value => {
                const mode = value as FillMode
                updateConfig({ mode, fillMode: mode === 'ai' ? 'ai-expansion' : mode === 'keep' ? 'manual' : mode === 'system' ? 'system-computed' : 'project-data' })
              }} options={[{ label: '自动填充', value: 'project' }, { label: '系统计算', value: 'system' }, { label: 'AI扩写', value: 'ai' }, { label: '人工留空', value: 'keep' }]} /></div>
              <div style={{ padding: 12, borderRadius: 8, background: '#f6f8fa', display: 'grid', gap: 5, fontSize: 12 }}>
                <div><Text strong>字段语义：</Text>{current.semanticType || buildFieldContract(selectedField, current).semanticType}</div>
                <div><Text strong>实际取数：</Text>{current.fillMode || buildFieldContract(selectedField, current).fillMode}</div>
                {!!current.dependencies?.length && <div><Text strong>依赖：</Text>{current.dependencies.join('、')}</div>}
              </div>
              <div><Text strong>信息来源</Text><Input value={current.source} onChange={event => updateConfig({ source: event.target.value })} style={{ marginTop: 7 }} placeholder="例如：用户输入、项目资料、系统字段" /></div>
              {current.mode === 'ai' && <div><Text strong>允许的扩写级别</Text><Select value={current.expansionLevel || 'contextual'} onChange={value => updateConfig({ expansionLevel: value })} style={{ marginTop: 7, width: '100%' }} options={[
                { value: 'exact', label: '仅原样提取' }, { value: 'normalize', label: '规范化表达' }, { value: 'summarize', label: '归纳重组' },
                { value: 'contextual', label: '结合项目特点简单扩写' }, { value: 'advisory', label: '可补充建议与后续关注点' },
              ]} /></div>}
              <div><Text strong>当前占位符的具体要求</Text><Input.TextArea value={current.requirement} onChange={event => updateConfig({ requirement: event.target.value })} autoSize={{ minRows: 4, maxRows: 7 }} style={{ marginTop: 7 }} placeholder="用简短命令写清内容重点、顺序和禁止事项" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><Text strong>缺失是否阻断</Text><Select style={{ marginTop: 7, width: '100%' }} value={current.requiredForGeneration ? 'generation' : current.requiredForDelivery || current.required ? 'delivery' : 'optional'} onChange={value => updateConfig({ requiredForGeneration: value === 'generation', requiredForDelivery: value === 'delivery' || value === 'generation', required: value !== 'optional' })} options={[{ label: '不阻断，仅提示', value: 'optional' }, { label: '交付前建议补充', value: 'delivery' }, { label: '生成前必须有（高风险）', value: 'generation' }]} /></div>
                <div><Text strong>信息缺失时</Text><Segmented block style={{ marginTop: 7 }} value={current.missingInfoPolicy} onChange={value => updateConfig({ missingInfoPolicy: value as FieldConfig['missingInfoPolicy'] })} options={[{ label: '留空', value: '留空' }, { label: '待确认', value: '待确认' }]} /></div>
              </div>
              <div><Text strong>建议篇幅</Text><Space style={{ marginTop: 7 }}><InputNumber min={0} value={current.minWords} onChange={value => updateConfig({ minWords: Number(value) || 0 })} />—<InputNumber min={0} value={current.maxWords} onChange={value => updateConfig({ maxWords: Number(value) || 0 })} /> 字</Space></div>
              <div style={{ padding: 12, borderRadius: 8, background: '#fff7e8', display: 'flex', justifyContent: 'space-between' }}><span><CheckCircleFilled style={{ color: '#fa8c16', marginRight: 7 }} />防止编造</span><Switch checked={current.antiFabrication} onChange={value => updateConfig({ antiFabrication: value })} /></div>
              <Space.Compact block>
                <Button block type="primary" ghost icon={<ThunderboltFilled />} loading={generating} onClick={() => generateSelectedFieldRule('suggest')}>AI 重新生成要求</Button>
                <Button block type="primary" icon={<ThunderboltFilled />} loading={generating} onClick={() => generateSelectedFieldRule('polish')} disabled={!current.requirement.trim()}>AI 优化当前要求</Button>
              </Space.Compact>
            </>}
          </div>
        </section>
      </div>
    </Spin>

    <div style={{ borderTop: '1px solid #edf0f3', background: '#fbfcfe' }}>
      <div style={{ borderTop: '1px solid #edf0f3', padding: '12px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">{template ? `已关联：${template.name} · ${fields.length} 个占位符` : '当前未关联模板文件，请先在模板中心上传并扫描'}</Text>
        <Space><Button onClick={() => setPromptOpen(true)} icon={<EyeOutlined />}>查看系统执行详情</Button><Button type="primary" ghost icon={<FileSearchOutlined />} onClick={() => { setStep(3); setPreviewOpen(true) }}>下一步：检查并保存</Button></Space>
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
    <Modal title="AI 执行规则（只读）" width={860} open={promptOpen} onCancel={() => setPromptOpen(false)} footer={null}>
      <Alert type="info" showIcon message={`AI 将按规则填写“${activeItem?.label || activeKey}”的 ${fields.filter(field => configs[field]?.mode === 'ai').length} 个扩写字段；项目资料、系统字段和模板固定内容不会交给 AI 改写。`} style={{ marginBottom: 16 }} />
      <div className="prompt-execution-summary">
        <div className="prompt-execution-flow">
          {['读取可信资料', '识别字段来源', '按专业规则扩写', '防编造检查', '写入实体模板'].map((label, index) => <div key={label} className="prompt-execution-flow__item"><span>{index + 1}</span>{label}</div>)}
        </div>
        <div className="prompt-layer-grid">
          <div className="prompt-layer-card is-locked"><div><LockOutlined /> 系统安全底线</div><Text type="secondary">防编造、输入隔离、审批与签章边界</Text><Tag color="blue">始终启用</Tag></div>
          <div className="prompt-layer-card"><div><CheckCircleFilled /> 全局文档规则</div><Text type="secondary">模板保护、受控整理、通用交付要求</Text><Tag color="green">3 项</Tag></div>
          <div className="prompt-layer-card"><div><ApartmentOutlined /> 业务专业规则</div><Text type="secondary">按项目类型加载对应专业 SOP</Text><Tag>{activeItem?.projectType || template?.projectType || '自动匹配'}</Tag></div>
          <div className="prompt-layer-card"><div><FileSearchOutlined /> 文种与字段规则</div><Text type="secondary">当前文种结构及每个占位符的具体要求</Text><Tag color="purple">{fields.length} 个字段</Tag></div>
        </div>
        <Collapse items={[{
          key: 'raw',
          label: <Space><Text strong>查看文种与字段原始规则（高级）</Text><Text type="secondary">生成时还会自动叠加上方各层规则</Text></Space>,
          children: <pre className="prompt-execution-raw">{`【文种与字段执行规则】\n${draft?.systemTemplate || ''}\n\n【任务输入模板】\n${draft?.userTemplate || ''}`}</pre>,
        }]} />
      </div>
    </Modal>
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

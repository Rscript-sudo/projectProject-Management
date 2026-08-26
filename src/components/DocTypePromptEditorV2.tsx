import { useEffect, useMemo, useState } from 'react'
import {
  App, Button, Collapse, Empty, Input, InputNumber, Modal, Segmented,
  Select, Space, Spin, Switch, Tag, Typography,
} from 'antd'
import {
  ApartmentOutlined, CheckCircleFilled, CheckOutlined, EyeOutlined,
  FileSearchOutlined, LeftOutlined, ReloadOutlined, RightOutlined,
  SaveOutlined, ThunderboltFilled, ArrowLeftOutlined, FolderOpenOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import { getDefaultPrompts, mergeDocTypePrompt } from '../shared/docTypePrompts'
import type { DocTypeConfig, GlobalRule } from '../shared/docTypePrompts'
import { BUILTIN_DOC_TYPES } from '../shared/builtinDocTypes'
import { useSettingsStore } from '../stores/useSettingsStore'
import { callAI, generateDocTypePrompt } from '../services/aiService'

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

const SYSTEM_FIELDS = ['日期', '星期几', '天气', '气温', '当前时间', '编制日期']
const PROJECT_FIELDS = ['项目名称', '工程名称', '文件编号', '致单位', '建设单位', '施工单位', '监理单位']

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
  const [template, setTemplate] = useState<{ id?: string; name: string; path: string; fields: string[]; content: string; html: string } | null>(null)
  const [configs, setConfigs] = useState<Record<string, FieldConfig>>({})
  const [selectedField, setSelectedField] = useState('')
  const [step, setStep] = useState(2)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)

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

  const loadTemplate = async () => {
    if (!activeItem?.label) return
    setLoadingTemplate(true)
    try {
      const [library, system] = await Promise.all([window.electronAPI.listTemplateLibrary(), window.electronAPI.listSystemTemplates()])
      const found = library.find(item => item.id === templateId)
        || library.find(item => item.docType === activeItem.label)
        || system.find(item => item.docType === activeItem.label)
      if (!found?.path) { setTemplate(null); return }
      const parsed = await window.electronAPI.readFileContent(found.path)
      const fields = [...new Set([...(found.fields || []), ...((parsed.content || '').match(/\{\{([^}]+)\}\}/g) || []).map(v => v.slice(2, -2).trim())])]
      const compactContent = (parsed.content || '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      setTemplate({ id: found.id, name: found.sourceName || parsed.fileName || activeItem.label, path: found.path, fields, content: parsed.success ? compactContent : '', html: parsed.success ? parsed.html || '' : '' })
      const next = { ...configs }
      for (const field of fields) if (!next[field]) next[field] = defaultFieldConfig(field)
      setConfigs(next)
      setSelectedField(current => fields.includes(current) ? current : fields[0] || '')
      setStep(fields.length ? 2 : 1)
    } catch (error: any) {
      message.error(`模板读取失败：${error?.message || error}`)
    } finally {
      setLoadingTemplate(false)
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

  const switchDoc = (offset: number) => {
    if (!docTypes.length) return
    setActiveKey(docTypes[(Math.max(activeIndex, 0) + offset + docTypes.length) % docTypes.length].key)
  }

  const save = async () => {
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
      setStep(3)
      message.success('规则已保存，并已接入 AI 扩写')
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
    if (!template?.content) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="模板暂无可预览文本" />
    return template.content.split(/(\{\{[^}]+\}\})/g).map((part, index) => {
      const match = part.match(/^\{\{([^}]+)\}\}$/)
      if (!match) return <span key={index}>{part}</span>
      const field = match[1].trim()
      const selected = field === selectedField
      return <button key={`${field}-${index}`} onClick={() => setSelectedField(field)} style={{ border: selected ? '1px solid #1677ff' : '1px solid #f0b04f', background: selected ? '#e8f3ff' : '#fff7e8', color: selected ? '#0958d9' : '#ad6800', borderRadius: 5, padding: '1px 5px', margin: '1px 2px', cursor: 'pointer', fontWeight: 600 }}>{part}</button>
    })
  }

  const decoratedTemplateHtml = useMemo(() => {
    if (!template?.html) return ''
    const safe = sanitizeTemplateHtml(template.html)
    return safe.replace(/\{\{([^}]+)\}\}/g, (_whole, rawField) => {
      const field = String(rawField).trim()
      const mode = configs[field]?.mode || defaultFieldConfig(field).mode
      const selected = field === selectedField
      const tone = mode === 'ai' ? 'ai' : mode === 'keep' ? 'keep' : 'auto'
      const escapedField = escapeHtmlAttribute(field)
      return `<button type="button" class="placeholder ${tone}${selected ? ' selected' : ''}" data-field="${escapedField}">{{${escapedField}}}${mode === 'ai' ? '<span>AI扩写</span>' : ''}</button>`
    })
  }, [template?.html, configs, selectedField])

  const shell: React.CSSProperties = { background: '#fff' }
  const paneTitle: React.CSSProperties = { padding: '13px 16px', borderBottom: '1px solid #edf0f3', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }

  return <div style={{ ...shell, overflow: 'hidden', minWidth: 1080, minHeight: '100%' }}>
    <div style={{ height: 58, padding: '0 22px', borderBottom: '1px solid #e6eaf0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Space size={12}>
        {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
        <span style={{ width: 30, height: 30, display: 'inline-grid', placeItems: 'center', borderRadius: 7, color: '#fff', background: '#1677ff' }}><FileSearchOutlined /></span>
        <Title level={4} style={{ margin: 0 }}>{activeItem?.label || '模板'} · AI扩写规则</Title>
        <Select showSearch value={activeKey || undefined} onChange={setActiveKey} optionFilterProp="label" variant="borderless" style={{ width: 150 }} options={docTypes.map(item => ({ value: item.key, label: item.label }))} />
      </Space>
      <Space>
        <Button icon={<FolderOpenOutlined />} disabled={!template?.path} onClick={() => template?.path && window.electronAPI.openPath(template.path)}>打开原文件</Button>
        <Button icon={<ReloadOutlined />} onClick={loadTemplate}>重新扫描</Button>
        <Button icon={<PlayCircleOutlined />} onClick={() => setPreviewOpen(true)}>测试生成</Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存并启用</Button>
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

    <Spin spinning={loadingTemplate}>
      <div style={{ display: 'grid', gridTemplateColumns: '270px minmax(430px, 1fr) 500px', minHeight: 650 }}>
        <section style={{ borderRight: '1px solid #edf0f3', background: '#fbfcfe' }}>
          <div style={paneTitle}><span><ApartmentOutlined /> 占位符结构</span><Tag color="blue">{fields.length} 个</Tag></div>
          <div style={{ padding: 12 }}>
            {Object.entries(grouped).map(([group, items]) => items.length > 0 && <div key={group} style={{ marginBottom: 15 }}>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 700 }}>{group}</Text>
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {items.map(field => <button key={field} onClick={() => setSelectedField(field)} style={{ border: 0, borderRadius: 7, padding: '8px 9px', textAlign: 'left', cursor: 'pointer', color: field === selectedField ? '#0958d9' : '#30343b', background: field === selectedField ? '#e8f3ff' : 'transparent', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{field}</span><span style={{ fontSize: 11, color: configs[field]?.mode === 'ai' ? '#1677ff' : '#999' }}>{configs[field]?.mode === 'ai' ? 'AI' : configs[field]?.mode === 'project' ? '资料' : configs[field]?.mode === 'system' ? '系统' : '保留'}</span>
                </button>)}
              </div>
            </div>)}
            {!fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未扫描到占位符" />}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #e7ebf0', display: 'flex', justifyContent: 'space-between' }}><Text type="secondary">共 {fields.length} 个占位符</Text><Text type="secondary">已配置 {fields.filter(field => !!configs[field]?.requirement).length}</Text></div>
          </div>
        </section>

        <section style={{ borderRight: '1px solid #edf0f3' }}>
          <div style={paneTitle}><span><EyeOutlined /> 原始模板映射</span><Button type="link" size="small" onClick={() => template?.path && window.electronAPI.openPath(template.path)}>打开原文件</Button></div>
          <div style={{ padding: '16px 22px', background: '#f6f7f9', minHeight: 594 }}>
            <div style={{ background: '#fff', height: 560, overflow: 'auto', padding: '22px 30px', border: '1px solid #dfe4ea', boxShadow: '0 3px 12px rgba(0,0,0,.05)', whiteSpace: 'pre-wrap', lineHeight: 1.72, fontSize: 14, color: '#20242a' }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 14 }}>{template?.name || '未关联模板文件'}</Text>
              {decoratedTemplateHtml ? <div
                className="docx-template-preview"
                onClick={event => {
                  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-field]')
                  if (target?.dataset.field) setSelectedField(target.dataset.field)
                }}
                dangerouslySetInnerHTML={{ __html: decoratedTemplateHtml }}
              /> : renderContent()}
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

    <Modal title="模板字段校验" open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => { setPreviewOpen(false); setStep(3) }}>校验完成</Button>}>
      <p>模板字段：{fields.length} 个；AI 扩写字段：{fields.filter(field => configs[field]?.mode === 'ai').length} 个。</p>
      <p>每个 AI 字段均保存独立的来源、写作要求、结构、篇幅和防编造设置。</p>
    </Modal>
    <Modal title="完整提示词预览" width={820} open={promptOpen} onCancel={() => setPromptOpen(false)} footer={null}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 560, overflow: 'auto', background: '#f6f8fa', padding: 16 }}>{`【系统提示词】\n${draft?.systemTemplate || ''}\n\n【用户侧要求】\n${draft?.userTemplate || ''}`}</pre></Modal>
  </div>
}

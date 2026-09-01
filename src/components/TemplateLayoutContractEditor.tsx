import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Empty, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd'

const { Text } = Typography

type FieldContract = {
  mode: 'inherit' | 'contract' | 'manual'
  format?: Record<string, any>
  override?: Record<string, any>
  collapseBlankLines?: boolean
  location?: string
  placements?: Array<{ kind: string; tableIndex?: number; rowIndex?: number; cellIndex?: number; paragraphIndex?: number; textOffset?: number; occurrenceIndex?: number; sheet?: string; cell?: string; exact?: boolean }>
  mappingConfidence?: number
  semanticPolicy?: Record<string, any>
}

type LayoutContract = {
  schemaVersion: number
  templateHash: string
  extractedAt?: string
  updatedAt?: string
  warnings?: string[]
  protectedAssets?: Record<string, string>
  fields: Record<string, FieldContract>
  choiceGroups?: Array<{ id: string; label: string; options: string[]; defaultValue?: string }>
  mapping?: { fieldCount: number; placementCount: number; exactPlacementCount: number; mappingStatus: string; unmappedFields?: string[] }
}

interface Props {
  open: boolean
  template: { path: string; docType: string; readOnly?: boolean } | null
  onClose: () => void
  onSaved?: () => void
}

const FONT_OPTIONS = ['继承模板', '仿宋', '仿宋_GB2312', '宋体', '黑体', '楷体_GB2312', 'PingFang SC', 'Songti SC', 'Heiti SC', 'Arial Unicode MS']

function clean(value: any) {
  return value === undefined || value === null || value === '' ? '—' : value
}

function formatSummary(format: Record<string, any> = {}) {
  const parts = [
    format.font && format.font !== 'inherit' ? format.font : null,
    format.fontSize ? `${format.fontSize}pt` : null,
    format.bold ? '加粗' : null,
    format.alignment && format.alignment !== 'inherit' ? ({ both: '两端', left: '左', center: '居中', right: '右' } as any)[format.alignment] || format.alignment : null,
    format.lineSpacing ? `行距${format.lineSpacing}pt` : null,
    format.firstLineIndent ? `首缩${format.firstLineIndent}pt` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '继承模板当前位置'
}

export default function TemplateLayoutContractEditor({ open, template, onClose, onSaved }: Props) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contract, setContract] = useState<LayoutContract | null>(null)
  const [filter, setFilter] = useState('')

  const load = async () => {
    if (!template?.path) return
    setLoading(true)
    try {
      const result = await window.electronAPI.getTemplateLayoutContract(template.path, template.docType)
      if (!result?.ok) throw new Error(result?.error || '版式合同读取失败')
      setContract(result.contract)
    } catch (error: any) {
      message.error(error?.message || '版式合同读取失败')
      setContract(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) void load() }, [open, template?.path])

  const updateField = (field: string, patch: Partial<FieldContract>) => {
    setContract(previous => previous ? {
      ...previous,
      fields: { ...previous.fields, [field]: { ...previous.fields[field], ...patch } },
    } : previous)
  }

  const updateOverride = (field: string, key: string, value: any) => {
    const current = contract?.fields[field]
    if (!current) return
    updateField(field, { override: { ...(current.override || {}), [key]: value } })
  }

  const rows = useMemo(() => Object.entries(contract?.fields || {})
    .filter(([field]) => !filter.trim() || field.includes(filter.trim()))
    .map(([field, value]) => ({ key: field, field, ...value })), [contract, filter])

  const exceptions = useMemo(() => {
    if (!contract) return []
    const result = [...(contract.warnings || [])]
    for (const [field, value] of Object.entries(contract.fields)) {
      if (!value.format?.font || value.format.font === 'inherit') result.push(`${field}：模板未明确记录字体，将由 Office/WPS 继承样式`)
      if (!value.format?.fontSize) result.push(`${field}：模板未明确记录字号，将继承所在样式`)
    }
    return result
  }, [contract])

  const save = async () => {
    if (!template || !contract) return
    setSaving(true)
    try {
      const fields = Object.fromEntries(Object.entries(contract.fields).map(([field, value]) => [field, {
        mode: value.mode,
        override: value.override || {},
        collapseBlankLines: value.collapseBlankLines !== false,
      }]))
      const result = await window.electronAPI.saveTemplateLayoutContract(template.path, template.docType, fields)
      if (!result?.ok) throw new Error(result?.error || '保存失败')
      setContract(result.contract)
      message.success('版式合同已保存，下一次生成将按新规则渲染')
      onSaved?.()
    } catch (error: any) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!template) return
    setSaving(true)
    try {
      const result = await window.electronAPI.resetTemplateLayoutContract(template.path, template.docType)
      if (!result?.ok) throw new Error(result?.error || '重置失败')
      setContract(result.contract)
      message.success('已重新从模板提取版式，所有字段恢复为继承模式')
      onSaved?.()
    } catch (error: any) {
      message.error(error?.message || '重置失败')
    } finally {
      setSaving(false)
    }
  }

  const columns: any[] = [
    { title: '字段', dataIndex: 'field', width: 130, fixed: 'left', render: (value: string) => <Text strong>{value}</Text> },
    {
      title: '确定性写入位置', width: 230,
      render: (_: any, row: any) => {
        const placements = row.placements || []
        if (!placements.length) return <Tag color="error">未定位</Tag>
        const labels = placements.map((item: any) => item.kind === 'worksheet-cell'
          ? `${item.sheet}!${item.cell}`
          : item.kind === 'table-cell'
            ? `表${item.tableIndex + 1}/行${item.rowIndex + 1}/列${item.cellIndex + 1}/段${(item.paragraphIndex || 0) + 1}@${item.textOffset || 0}`
            : `正文段落${item.paragraphIndex + 1}@${item.textOffset || 0}`)
        return <Tooltip title={labels.join('；')}><Tag color={placements.every((item: any) => item.exact) ? 'green' : 'orange'}>{labels[0]}{labels.length > 1 ? ` 等${labels.length}处` : ''}</Tag></Tooltip>
      },
    },
    {
      title: '模板原格式', width: 210,
      render: (_: any, row: any) => <Text type="secondary" style={{ fontSize: 12 }}>{formatSummary(row.format)}</Text>,
    },
    {
      title: '模式', width: 125,
      render: (_: any, row: any) => <Select size="small" value={row.mode} disabled={template?.readOnly} style={{ width: 110 }} onChange={mode => updateField(row.field, { mode })} options={[
        { value: 'inherit', label: '继承模板' },
        { value: 'contract', label: '合同覆盖' },
        { value: 'manual', label: '人工留空' },
      ]} />,
    },
    {
      title: '当前生效格式（合同覆盖时可编辑）', width: 620,
      render: (_: any, row: any) => {
        if (row.mode === 'inherit') return <Tag color="blue">{formatSummary(row.format)}</Tag>
        if (row.mode === 'manual') return <Tag>不自动填充</Tag>
        const value = row.override || {}
        return <Space size={6} wrap>
          <Select size="small" showSearch value={value.font || undefined} placeholder="字体" style={{ width: 135 }} disabled={template?.readOnly} onChange={font => updateOverride(row.field, 'font', font)} options={FONT_OPTIONS.slice(1).map(font => ({ value: font, label: font }))} />
          <InputNumber size="small" value={value.fontSize} min={5} max={72} step={0.5} placeholder="字号" addonAfter="pt" style={{ width: 105 }} disabled={template?.readOnly} onChange={number => updateOverride(row.field, 'fontSize', number)} />
          <Select size="small" value={value.alignment || undefined} placeholder="对齐" style={{ width: 95 }} disabled={template?.readOnly} onChange={alignment => updateOverride(row.field, 'alignment', alignment)} options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }, { value: 'both', label: '两端对齐' }]} />
          <InputNumber size="small" value={value.lineSpacing} min={0} max={120} step={1} placeholder="行距" addonAfter="pt" style={{ width: 105 }} disabled={template?.readOnly} onChange={number => updateOverride(row.field, 'lineSpacing', number)} />
          <InputNumber size="small" value={value.firstLineIndent} min={0} max={240} step={1} placeholder="首缩" addonAfter="pt" style={{ width: 105 }} disabled={template?.readOnly} onChange={number => updateOverride(row.field, 'firstLineIndent', number)} />
          <Checkbox checked={value.bold === true} disabled={template?.readOnly} onChange={event => updateOverride(row.field, 'bold', event.target.checked)}>加粗</Checkbox>
        </Space>
      },
    },
    {
      title: '空行', width: 100,
      render: (_: any, row: any) => <Checkbox checked={row.collapseBlankLines !== false} disabled={template?.readOnly} onChange={event => updateField(row.field, { collapseBlankLines: event.target.checked })}>折叠</Checkbox>,
    },
  ]

  return <Modal
    title={`版式合同 · ${template?.docType || ''}`}
    open={open}
    onCancel={onClose}
    width={1180}
    destroyOnClose
    footer={template?.readOnly ? <Button onClick={onClose}>关闭</Button> : <Space>
      <Popconfirm title="重新从模板提取？" description="所有字段覆盖设置将恢复为继承模板" onConfirm={reset}><Button disabled={saving}>恢复模板原格式</Button></Popconfirm>
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" loading={saving} onClick={save}>保存并应用</Button>
    </Space>}
  >
    {loading ? <div style={{ padding: 70, textAlign: 'center' }}><Spin /></div> : !contract ? <Empty description="未读取到版式合同" /> : <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={template?.readOnly ? '当前模板为只读预览。' : '左侧是模板原格式，右侧是保存后实际生效格式。默认继承模板，只有“合同覆盖”字段才会改写字体和段落属性。'} />
      {exceptions.length > 0 && <Alert type="warning" showIcon message={`发现 ${exceptions.length} 项需要关注`} description={<div style={{ maxHeight: 90, overflow: 'auto' }}>{exceptions.slice(0, 12).map(item => <div key={item}>• {item}</div>)}</div>} />}
      <Space wrap>
        <Tag color="cyan">字段 {Object.keys(contract.fields).length}</Tag>
        <Tag color={contract.mapping?.mappingStatus === 'ready' ? 'green' : 'orange'}>精准定位 {contract.mapping?.exactPlacementCount || 0}/{contract.mapping?.placementCount || 0}</Tag>
        <Tag color="purple">选择项 {contract.choiceGroups?.length || 0}</Tag>
        <Tag color="green">受保护资产 {Object.keys(contract.protectedAssets || {}).length}</Tag>
        <Tag>合同 v{contract.schemaVersion}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>模板指纹：{contract.templateHash.slice(0, 12)}</Text>
        <Input.Search allowClear placeholder="筛选字段" value={filter} onChange={event => setFilter(event.target.value)} style={{ width: 210 }} />
      </Space>
      <Table size="small" rowKey="field" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1410, y: 430 }} />
      <Alert type="success" showIcon message="预览对比" description="“模板原格式”与“当前生效格式”已并列显示。保存不会改动原模板文件，只更新旁车合同；Logo、页眉页脚、边框和签章区继续受强制保护。" />
    </Space>}
  </Modal>
}

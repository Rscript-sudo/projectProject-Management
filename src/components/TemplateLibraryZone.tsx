// v1.x：模板库工作区 —— 通用模板 / 专业模板共用
// 列全：企业模板（可编辑/删除/替换）+ 系统预置模板（只读）
// 支持批量导入、字段识别、打开、配置扩写规则
import { useEffect, useState, useCallback } from 'react'
import { AutoComplete, Card, Table, Button, Space, Tag, Empty, App, Typography, Popconfirm, Tooltip, Modal, Input, Alert, Menu } from 'antd'
import { InboxOutlined, ReloadOutlined, EyeOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined, ScanOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useSettingsStore } from '../stores/useSettingsStore'
import { getAllProjectTypes } from '../shared/projectProfile.mjs'
import { BUILTIN_DOC_TYPES } from '../shared/builtinDocTypes'
import { getTemplateStatus, TEMPLATE_STATUS } from '../shared/templateReadiness.mjs'

const { Text } = Typography

interface Props {
  scope: 'global' | 'professional' | 'other' | 'personal'
  projectType?: string   // scope=professional 时必填（专业 label）
  title: string
  onGoRules?: (docType: string, templateId?: string) => void  // 跳转到扩写规则
  display?: 'all' | 'enterprise' | 'system'
}

interface Tpl {
  id: string; name: string; docType: string; scope: string; projectType: string
  path: string; sourceName: string; fields?: string[]; readOnly?: boolean; missing?: boolean
  aiRuleConfiguredAt?: string
  customDocTypeCode?: string
  projectTypeLabel?: string
}

export default function TemplateLibraryZone({ scope, projectType, title, onGoRules, display = 'all' }: Props) {
  const { message } = App.useApp()
  const { customDocTypes } = useSettingsStore()
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDocType, setImportDocType] = useState('监理日志')
  const [hiddenSystemTemplateIds, setHiddenSystemTemplateIds] = useState<string[]>([])
  const [hiddenCommonDocTypes, setHiddenCommonDocTypes] = useState<string[]>([])
  const [addTypeOpen, setAddTypeOpen] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ template: Tpl; x: number; y: number } | null>(null)

  // 编辑弹窗
  const [editTpl, setEditTpl] = useState<Tpl | null>(null)
  const [editName, setEditName] = useState('')
  const [editUpdating, setEditUpdating] = useState(false)

  const allDocTypes = [...BUILTIN_DOC_TYPES, ...customDocTypes.map(c => c.label)]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, system, settings] = await Promise.all([
        window.electronAPI.listTemplateLibrary(),
        window.electronAPI.listSystemTemplates().catch(() => []),
        window.electronAPI.getSettings(),
      ])
      const hiddenIds = Array.isArray(settings?.hiddenSystemTemplateIds) ? settings.hiddenSystemTemplateIds : []
      const hiddenTypes = Array.isArray(settings?.hiddenCommonDocTypes) ? settings.hiddenCommonDocTypes : []
      setHiddenSystemTemplateIds(hiddenIds)
      setHiddenCommonDocTypes(hiddenTypes)
      const matchScope = (t: Tpl) => {
        if (scope === 'global') return t.scope === 'global'
        if (scope === 'other') return t.scope === 'other'
        if (scope === 'personal') return t.scope === 'personal'
        return t.scope === 'professional' && (t.projectType === projectType || t.projectTypeLabel === projectType)
      }
      const enterprise = (all || []).filter(matchScope).map(t => ({ ...t, readOnly: false }))
      // 通用区：额外列出系统预置模板（只读），让清单列全
      const systemRows = scope === 'global'
        ? (system || []).filter(s => !hiddenIds.includes(s.id)).map(s => ({ ...s, readOnly: true }))
        : []
      if (scope === 'global' && display === 'all') {
        const byDocType = new Map<string, Tpl>()
        for (const item of systemRows) byDocType.set(item.docType, item)
        // 用户添加/替换的通用模板覆盖同文种的默认文件，每个文种只显示一行。
        for (const item of enterprise) if (!byDocType.has(item.docType) || byDocType.get(item.docType)?.readOnly) byDocType.set(item.docType, item)
        const commonCustomTypes = customDocTypes.filter(item => !item.projectType)
        const customCodeByLabel = new Map(commonCustomTypes.map(item => [item.label, item.code]))
        const visibleDocTypes = [...BUILTIN_DOC_TYPES, ...commonCustomTypes.map(item => item.label)]
          .filter(docType => !hiddenTypes.includes(docType))
        const completeRows = visibleDocTypes.map(docType => ({
          ...(byDocType.get(docType) || {
            id: `missing:${docType}`,
            name: docType,
            docType,
            scope,
            projectType: '通用',
            path: '',
            sourceName: '',
            fields: [],
            missing: true,
          }),
          customDocTypeCode: customCodeByLabel.get(docType),
        } as Tpl))
        setTemplates(completeRows)
      } else {
        setTemplates(display === 'enterprise' ? enterprise : display === 'system' ? systemRows : [...enterprise, ...systemRows])
      }
    } catch (e: any) {
      message.error('加载模板失败：' + (e?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }, [scope, projectType, display, message, customDocTypes])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [contextMenu])

  const doImport = async (sourcePath: string, docType: string) => {
    const audit = await window.electronAPI.auditTemplate(sourcePath)
    if (!audit.success) throw new Error(audit.error || audit.issues?.filter(item => item.severity === 'error').map(item => item.message).join('；') || '模板安全检查未通过')
    const warnings = audit.issues?.filter(item => item.severity === 'warning') || []
    if (warnings.length) message.warning(`模板体检提示：${warnings.map(item => item.message).join('；')}`)
    const result = await window.electronAPI.importTemplateToLibrary({
      sourcePath,
      docType,
      scope,
      projectType: scope === 'professional' ? projectType : undefined,
    })
    if (!result.success) throw new Error(result.error || '导入失败')
    return result.template
  }

  const handleImport = async () => {
    const requestedDocType = importDocType.trim()
    if (!requestedDocType) { message.warning('请输入或选择文种'); return }
    const files = await window.electronAPI.selectFiles()  // 批量
    if (!files || files.length === 0) return
    setImporting(true)
    try {
      // 不限定内置文种：用户输入新名称时自动创建自定义文种，再导入模板。
      if (!allDocTypes.includes(requestedDocType)) {
        const settings = await window.electronAPI.getSettings()
        const stamp = Date.now().toString(36)
        const customDocTypes = [...(settings.customDocTypes || []), {
          code: `custom_${stamp}`,
          label: requestedDocType,
          fileCode: `ZD${stamp.slice(-6).toUpperCase()}`,
          projectType: null,
          minWords: 600,
          inStructuredWhitelist: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }]
        const saved = await window.electronAPI.setSettings({ ...settings, customDocTypes })
        if (!saved?.success) throw new Error(saved?.error || '创建自定义文种失败')
        await useSettingsStore.getState().loadCustomTypes()
      }
      let ok = 0
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.docx')) continue
        await doImport(f, requestedDocType)
        ok++
      }
      message.success(`已批量导入 ${ok} 个模板（自动识别字段）`)
      setImporting(false)
      load()
    } catch (e: any) {
      setImporting(false)
      message.error('导入失败：' + (e?.message || '未知错误'))
    }
  }

  const handleDelete = async (tpl: Tpl) => {
    if (tpl.missing) return
    if (tpl.readOnly) {
      const settings = await window.electronAPI.getSettings()
      const hiddenIds = Array.isArray(settings?.hiddenSystemTemplateIds) ? settings.hiddenSystemTemplateIds : []
      const result = await window.electronAPI.setSettings({
        ...settings,
        hiddenSystemTemplateIds: Array.from(new Set([...hiddenIds, tpl.id])),
      })
      if (result?.success) { message.success('已隐藏内置模板，可通过“恢复默认模板”找回'); load() }
      else message.error('删除失败：' + (result?.error || '未知错误'))
      return
    }
    const result = await window.electronAPI.deleteLibraryTemplate(tpl.id)
    if (result?.ok) { message.success('模板文件已移到系统废纸篓，可从废纸篓恢复'); load() }
    else message.error('删除失败：' + (result?.error || '未知错误'))
  }

  const handleScanFields = async (tpl: Tpl) => {
    if (tpl.missing || !tpl.path) { message.warning('该文种缺少模板文件，请先添加'); return }
    try {
      if (!tpl.readOnly) {
        const result = await window.electronAPI.refreshTemplateLibraryEntry(tpl.id)
        if (!result.success) throw new Error(result.error || '扫描失败')
        message.success(`已扫描 ${result.template?.fields?.length || 0} 个字段`)
      } else {
        const result = await window.electronAPI.getTemplateFields(tpl.path)
        if (!result?.ok) throw new Error(result?.error || '扫描失败')
        message.success(`已扫描 ${result.fields?.length || 0} 个字段`)
      }
      await load()
    } catch (e: any) {
      message.error('扫描字段失败：' + (e?.message || '未知错误'))
    }
  }

  const restoreDefaultTemplates = async () => {
    const settings = await window.electronAPI.getSettings()
    const result = await window.electronAPI.setSettings({ ...settings, hiddenSystemTemplateIds: [] })
    if (result?.success) { message.success('已恢复默认通用模板'); load() }
    else message.error('恢复失败：' + (result?.error || '未知错误'))
  }

  const addCommonDocType = async () => {
    const label = newTypeName.trim()
    if (!label) { message.warning('请输入文种名称'); return }
    if (allDocTypes.includes(label)) { message.warning('该文种已存在'); return }
    const settings = await window.electronAPI.getSettings()
    const list = Array.isArray(settings.customDocTypes) ? [...settings.customDocTypes] : []
    const stamp = Date.now().toString(36)
    list.push({
      code: `common_${stamp}`,
      label,
      fileCode: `TY${stamp.slice(-6).toUpperCase()}`,
      projectType: null,
      minWords: 600,
      inStructuredWhitelist: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const result = await window.electronAPI.setSettings({ ...settings, customDocTypes: list })
    if (!result?.success) { message.error('新增文种失败：' + (result?.error || '未知错误')); return }
    await useSettingsStore.getState().loadCustomTypes()
    setNewTypeName(''); setAddTypeOpen(false); message.success('已新增通用模板文种'); load()
  }

  const deleteDocTypeRow = async (tpl: Tpl) => {
    const settings = await window.electronAPI.getSettings()
    if (tpl.customDocTypeCode) {
      const list = (settings.customDocTypes || []).filter((item: any) => item.code !== tpl.customDocTypeCode)
      const result = await window.electronAPI.setSettings({ ...settings, customDocTypes: list })
      if (!result?.success) { message.error('删除文种失败'); return }
      if (!tpl.missing && !tpl.readOnly) await window.electronAPI.deleteLibraryTemplate(tpl.id)
      await useSettingsStore.getState().loadCustomTypes()
    } else {
      const hiddenTypes = Array.isArray(settings?.hiddenCommonDocTypes) ? settings.hiddenCommonDocTypes : []
      const result = await window.electronAPI.setSettings({ ...settings, hiddenCommonDocTypes: Array.from(new Set([...hiddenTypes, tpl.docType])) })
      if (!result?.success) { message.error('删除文种失败'); return }
    }
    message.success('已删除整行通用模板文种'); load()
  }

  const restoreDefaultDocTypes = async () => {
    const settings = await window.electronAPI.getSettings()
    const result = await window.electronAPI.setSettings({ ...settings, hiddenCommonDocTypes: [] })
    if (result?.success) { message.success('已恢复默认文种'); load() }
    else message.error('恢复文种失败')
  }

  const openEdit = (tpl: Tpl) => { setEditTpl(tpl); setEditName(tpl.docType); }

  const handleEditSubmit = async () => {
    if (!editTpl) return
    setEditUpdating(true)
    try {
      if (editTpl.missing || editTpl.readOnly) {
        if (editTpl.missing && !editReplace) throw new Error('请先选择模板文件')
        const result = editReplace
          ? await window.electronAPI.importTemplateToLibrary({
              sourcePath: editReplace,
              docType: editTpl.docType,
              scope,
              projectType: scope === 'professional' ? projectType : '通用',
              name: editTpl.docType,
            })
          : await window.electronAPI.cloneSystemTemplateToLibrary({
              docType: editTpl.docType,
              scope: scope === 'professional' ? 'professional' : scope === 'personal' ? 'personal' : 'global',
              projectType: scope === 'professional' ? projectType : '通用',
              name: editTpl.docType,
            })
        if (!result?.success) throw new Error(result?.error || '更新失败')
        if (editTpl.readOnly) {
          const settings = await window.electronAPI.getSettings()
          const hiddenIds = Array.isArray(settings?.hiddenSystemTemplateIds) ? settings.hiddenSystemTemplateIds : []
          await window.electronAPI.setSettings({ ...settings, hiddenSystemTemplateIds: Array.from(new Set([...hiddenIds, editTpl.id])) })
        }
        message.success('已更新通用模板并扫描字段')
        setEditTpl(null); setEditReplace(null); setEditUpdating(false); load(); return
      }
      // 可选：替换文件
      let sourcePath: string | undefined
      if (editReplace) { sourcePath = editReplace; }
      const result = await window.electronAPI.updateLibraryTemplate({ id: editTpl.id, name: editTpl.docType, sourcePath })
      if (!result?.ok) throw new Error(result?.error || '更新失败')
      message.success('已更新（重扫字段）')
      setEditTpl(null); setEditReplace(null)
      setEditUpdating(false)
      load()
    } catch (e: any) {
      setEditUpdating(false)
      message.error('更新失败：' + (e?.message || '未知错误'))
    }
  }
  const [editReplace, setEditReplace] = useState<string | null>(null)

  const columns: ColumnsType<Tpl> = [
    {
      title: '模板名称', dataIndex: 'name', width: 260, ellipsis: true,
      render: (_n: string, r: Tpl) => {
        return <div style={{ minWidth: 0 }}>
          <Text strong ellipsis title={r.docType}>{r.docType}</Text>
          {r.sourceName && <Text type="secondary" ellipsis title={r.sourceName} style={{ display: 'block', maxWidth: 230, fontSize: 11 }}>{r.sourceName}</Text>}
        </div>
      },
    },
    {
      title: '配置状态', dataIndex: 'path', width: 140, align: 'center',
      render: (_: string, r: Tpl) => {
        const status = getTemplateStatus(r)
        if (status === TEMPLATE_STATUS.MISSING_FILE) return <Tag color="error">文件缺失</Tag>
        if (status === TEMPLATE_STATUS.PENDING_FIELDS) return <Tag color="warning">待识别占位符</Tag>
        if (status === TEMPLATE_STATUS.PENDING_RULES) return <Tag color="gold">待配置规则</Tag>
        return <Tag color="success">可使用</Tag>
      },
    },
    {
      title: '字段', dataIndex: 'fields', width: 190,
      render: (f: string[]) => f && f.length
        ? <Tooltip title={f.join('、')}><Space size={4} style={{ whiteSpace: 'nowrap' }}><Tag color="blue" style={{ margin: 0 }}>{f.length} 个</Tag><Text type="secondary" ellipsis style={{ maxWidth: 105 }}>{f.slice(0, 2).join('、')}</Text></Space></Tooltip>
        : <Text type="secondary">—</Text>,
    },
    {
      title: '操作', width: 210, fixed: 'right',
      render: (_, r) => (
        <Space size={0}>
          <Tooltip title={r.missing ? '缺少模板文件' : '打开模板文件'}>
            <Button size="small" type="text" disabled={r.missing} icon={<EyeOutlined />} onClick={() => window.electronAPI.openTemplatePreview(r.path, r.sourceName || r.name)} />
          </Tooltip>
          {onGoRules && (
            <Tooltip title="到扩写规则配置该文种提示词">
              <Button size="small" type="text" icon={<ThunderboltOutlined />} onClick={() => onGoRules(r.docType, r.missing ? undefined : r.id)} />
            </Tooltip>
          )}
          <Tooltip title="编辑 / 替换模板文件">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Tooltip title="扫描模板字段">
            <Button size="small" type="text" disabled={r.missing} icon={<ScanOutlined />} onClick={() => handleScanFields(r)} />
          </Tooltip>
          <Popconfirm disabled={r.missing} title="确定删除该模板？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r)}>
            <Tooltip title="删除">
              <Button size="small" type="text" danger disabled={r.missing} icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
          {scope === 'global' && display === 'all' && (
            <Popconfirm title={`确定删除整行文种「${r.docType}」？`} description="删除后该文种不再出现在通用模板清单中" okText="删除整行" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteDocTypeRow(r)}>
              <Tooltip title="删除整行文种">
                <Button size="small" type="text" danger icon={<MinusCircleOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title={<Text strong style={{ fontSize: 16 }}>{title}</Text>}
      style={{ borderRadius: 8 }}
      extra={<Space>
        {scope === 'global' && display === 'all' && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddTypeOpen(true)}>新增文种</Button>
        )}
        {scope === 'global' && display === 'all' && hiddenCommonDocTypes.length > 0 && (
          <Button onClick={restoreDefaultDocTypes}>恢复默认文种（{hiddenCommonDocTypes.length}）</Button>
        )}
        {scope === 'global' && display === 'all' && hiddenSystemTemplateIds.length > 0 && (
          <Button onClick={restoreDefaultTemplates}>恢复默认模板（{hiddenSystemTemplateIds.length}）</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>}
    >
      {display !== 'system' && <Space style={{ marginBottom: 12, width: '100%' }} wrap>
        <AutoComplete
          value={importDocType}
          onChange={setImportDocType}
          style={{ width: 200 }}
          options={allDocTypes.map(d => ({ value: d, label: d }))}
          filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
          placeholder="输入或选择文种"
        />
        <Button type="primary" icon={<InboxOutlined />} loading={importing} onClick={handleImport}>添加模板</Button>
        {scope === 'professional' && projectType && <Text type="secondary">导入到专业：{projectType}</Text>}
        <Text type="secondary" style={{ fontSize: 12 }}>支持多选 .docx，自动识别字段</Text>
      </Space>}
      {scope === 'global' && display === 'all' && (
        <Alert
          type="info" showIcon
          style={{ marginBottom: 12 }}
          message="通用模板均已完成配置，可直接使用"
          description="通用模板统一由实体模板文件、占位符和 AI 扩写规则组成。替换模板文件后，需要重新识别占位符并保存扩写规则。"
        />
      )}
      {(scope === 'professional' || scope === 'personal' || scope === 'other') && <Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>提示：右击任意模板可打开操作菜单；删除会移到系统废纸篓，可恢复。</Text>}
      <Table
        size="small" rowKey="id" loading={loading} columns={columns} dataSource={templates}
        locale={{ emptyText: <Empty description="暂无模板，点上方「批量导入」" /> }}
        pagination={false}
        scroll={{ x: 840 }}
        onRow={record => ({
          onContextMenu: event => {
            event.preventDefault()
            setContextMenu({ template: record, x: event.clientX, y: event.clientY })
          },
        })}
      />
      {contextMenu && <div style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 3000, minWidth: 190, borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,.18)' }} onClick={event => event.stopPropagation()}>
        <Menu
          selectable={false}
          items={[
            { key: 'open', label: '打开模板文件', icon: <EyeOutlined />, disabled: contextMenu.template.missing },
            ...(onGoRules ? [{ key: 'rules', label: '编辑 AI 扩写规则', icon: <ThunderboltOutlined />, disabled: contextMenu.template.missing }] : []),
            { key: 'edit', label: '编辑 / 替换模板', icon: <EditOutlined /> },
            { key: 'scan', label: '重新扫描占位符', icon: <ScanOutlined />, disabled: contextMenu.template.missing },
            { type: 'divider' as const },
            { key: 'delete', label: contextMenu.template.readOnly ? '隐藏内置模板' : '移到系统废纸篓', icon: <DeleteOutlined />, danger: true, disabled: contextMenu.template.missing },
          ]}
          onClick={({ key }) => {
            const tpl = contextMenu.template
            setContextMenu(null)
            if (key === 'open') void window.electronAPI.openTemplatePreview(tpl.path, tpl.sourceName || tpl.name)
            else if (key === 'rules') onGoRules?.(tpl.docType, tpl.id)
            else if (key === 'edit') openEdit(tpl)
            else if (key === 'scan') void handleScanFields(tpl)
            else if (key === 'delete') void handleDelete(tpl)
          }}
        />
      </div>}

      {/* 编辑 / 替换弹窗 */}
      <Modal
        title={`${editTpl?.missing ? '添加' : '编辑'}模板：${editTpl?.docType || ''}`}
        open={!!editTpl}
        onCancel={() => { setEditTpl(null); setEditReplace(null) }}
        onOk={handleEditSubmit}
        confirmLoading={editUpdating}
        okText="保存" cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>模板名称</Text>
            <Input value={editTpl?.docType || editName} disabled placeholder="模板名称与文种保持一致" />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{editTpl?.missing ? '添加模板文件（必选）' : '替换模板文件（可选）'}</Text>
            <Space>
              <Button size="small" onClick={async () => {
                const p = await window.electronAPI.selectTemplateFile()
                if (p) setEditReplace(p)
              }}>选择替换文件</Button>
              {editReplace && <Text type="secondary" style={{ fontSize: 12 }}>{editReplace.split(/[\\/]/).pop()}</Text>}
            </Space>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>保存时自动重新识别字段占位符。</Text>
        </Space>
      </Modal>
      <Modal
        title="新增通用模板文种"
        open={addTypeOpen}
        onCancel={() => { setAddTypeOpen(false); setNewTypeName('') }}
        onOk={addCommonDocType}
        okText="新增" cancelText="取消"
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>先新增文种类型，保存后再在该行添加模板文件。</Text>
        <Input value={newTypeName} onChange={event => setNewTypeName(event.target.value)} onPressEnter={addCommonDocType} placeholder="例如：监理月报附表" autoFocus />
      </Modal>
    </Card>
  )
}

import { useEffect, useState } from 'react'
import { App, Button, Empty, Modal, Select, Space, Tag, Typography } from 'antd'
import { CheckCircleFilled, FolderOpenOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography
const DOC_TYPES = ['监理日志', '监理周报', '监理月报', '会议纪要', '整改通知书', '安全通知书', '工程联系单', '停工令', '开工通知', '竣工通知', '工程变更单', '工程款支付证书', '进度分析报告', '监理规划', '监理细则', '巡视记录', '安全检查记录', '通用文档']

type Override = { path: string; sourceName?: string; updatedAt?: string }
type LibraryTemplate = { id: string; name: string; docType: string; scope: 'global' | 'professional'; projectType: string; fields?: string[] }
type SystemTemplate = { id: string; name: string; docType: string; scope: 'system'; projectType: string; sourceName: string; path: string; fields?: string[]; readOnly: true }

export default function ProjectTemplateCenterModal({ open, onClose, project }: {
  open: boolean; onClose: () => void; project: { name: string; path: string; projectType: string; templateOverrides?: Record<string, Override>; templateSelections?: Record<string, string | null> }
}) {
  const { message } = App.useApp()
  const [docType, setDocType] = useState('监理周报')
  const [library, setLibrary] = useState<LibraryTemplate[]>([])
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([])
  const [overrides, setOverrides] = useState<Record<string, Override>>(project.templateOverrides || {})
  const [selections, setSelections] = useState<Record<string, string | null>>(project.templateSelections || {})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!window.electronAPI) return
    const [shared, system] = await Promise.all([window.electronAPI.listTemplateLibrary(), window.electronAPI.listSystemTemplates()])
    setLibrary(shared)
    setSystemTemplates(system)
    const config = await window.electronAPI.readProjectConfig(project.path)
    setOverrides(config.templateOverrides || {})
    setSelections(config.templateSelections || {})
  }
  useEffect(() => { if (open) load() }, [open, project.path])

  const importProjectTemplate = async () => {
    const sourcePath = await window.electronAPI.selectTemplateFile()
    if (!sourcePath) return
    setBusy(true)
    try {
      const result = await window.electronAPI.assignProjectTemplate(project.path, docType, sourcePath)
      if (!result.success || !result.templateOverride) throw new Error(result.error || '导入失败')
      setOverrides(prev => ({ ...prev, [docType]: result.templateOverride! }))
      message.success(`${docType} 已设为“${project.name}”专属模板`)
    } catch (error: any) { message.error(error?.message || '导入失败') } finally { setBusy(false) }
  }

  const selectLibrary = async (templateId: string | null) => {
    const result = await window.electronAPI.selectProjectTemplate(project.path, docType, templateId)
    if (!result.success) return message.error(result.error || '保存失败')
    setSelections(prev => ({ ...prev, [docType]: templateId }))
    message.success(templateId ? '已指定当前项目使用该模板' : '已恢复按项目专业自动匹配')
  }

  const restoreAuto = async () => {
    const result = await window.electronAPI.clearProjectTemplateOverride(project.path, docType)
    if (!result.success) return message.error(result.error || '恢复失败')
    setOverrides(prev => { const next = { ...prev }; delete next[docType]; return next })
    message.success('已取消项目专属模板，恢复为自动匹配')
  }

  const matchingLibrary = library.filter(item => item.docType === docType)
  const activeOverride = overrides[docType]
  const activeSelection = selections[docType]
  const selectedInfo = matchingLibrary.find(item => item.id === activeSelection)
  const systemTemplate = systemTemplates.find(item => item.docType === docType)

  return <Modal open={open} onCancel={onClose} footer={null} width={560} title={<Space size={6}><FolderOpenOutlined style={{ color: '#1677ff' }} /><span>{project.name} · 项目模板</span></Space>}>
    <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
      仅影响当前项目。优先级：项目专属 → 企业共享 → 系统预置。
    </Text>
    <div style={{ padding: 12, background: '#f7f9fc', border: '1px solid #edf0f5', borderRadius: 8 }}>
      <Space.Compact style={{ width: '100%' }}>
        <Select value={docType} onChange={setDocType} style={{ width: '42%' }} options={DOC_TYPES.map(value => ({ value }))} />
        <Button type="primary" icon={<InboxOutlined />} loading={busy} onClick={importProjectTemplate} style={{ width: '58%' }}>导入当前项目专属模板</Button>
      </Space.Compact>
    </div>

    <div style={{ marginTop: 12, padding: 12, border: '1px solid #e8edf5', borderRadius: 8, minHeight: 72 }}>
      {activeOverride ? <Space direction="vertical" size={3}>
        <Space><CheckCircleFilled style={{ color: '#1677ff' }} /><Text strong>项目专属模板</Text><Tag color="blue">最高优先级</Tag></Space>
        <Text type="secondary">{activeOverride.sourceName || activeOverride.path}</Text>
        <Space><Button size="small" onClick={() => window.electronAPI.openFile(activeOverride.path)}>查看模板</Button><Button size="small" icon={<ReloadOutlined />} onClick={restoreAuto}>取消专属模板</Button></Space>
      </Space> : selectedInfo ? <Space direction="vertical" size={3}><Space><CheckCircleFilled style={{ color: '#52c41a' }} /><Text strong>当前项目指定的模板库版本</Text></Space><Text type="secondary">{selectedInfo.name} · {selectedInfo.scope === 'professional' ? selectedInfo.projectType : '通用'} · {selectedInfo.fields?.length || 0} 个字段</Text></Space>
        : <Space direction="vertical" size={2}><Text strong>自动匹配中</Text><Text type="secondary">会按“{project.projectType}”优先使用企业专业模板，再使用企业通用模板。</Text></Space>}
    </div>

    <div style={{ marginTop: 12 }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>也可从企业模板库为当前项目指定一个版本：</Text>
      {matchingLibrary.length ? <Select value={activeSelection || undefined} allowClear placeholder="保持自动匹配" style={{ width: '100%' }} onClear={() => selectLibrary(null)} onChange={selectLibrary} options={matchingLibrary.map(item => ({ value: item.id, label: `${item.scope === 'professional' ? item.projectType : '通用'} · ${item.name}（${item.fields?.length || 0} 字段）` }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无企业共享模板；当前仍可使用下方系统预置模板" />}
    </div>
    {systemTemplate && <div style={{ marginTop: 12, padding: '8px 10px', background: '#fafafa', borderRadius: 6 }}>
      <Space size={6}><Tag>系统预置</Tag><Text type="secondary" style={{ fontSize: 12 }}>{systemTemplate.sourceName} · {systemTemplate.fields?.length || 0} 个字段 · 只读基础模板</Text><Button type="link" size="small" onClick={() => window.electronAPI.openFile(systemTemplate.path)}>查看</Button></Space>
    </div>}
  </Modal>
}

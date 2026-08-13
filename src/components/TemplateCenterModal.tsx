import { useEffect, useState } from 'react'
import { Alert, App, Button, Form, Modal, Select, Space, Tag, Typography } from 'antd'
import { BookOutlined, EditOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

const DOC_TYPES = [
  '监理日志', '监理周报', '监理月报', '会议纪要', '整改通知书', '安全通知书', '工程联系单', '停工令',
  '开工通知', '竣工通知', '工程变更单', '工程款支付证书', '进度分析报告', '开工条件检查表',
  '承建资格报审表', '施工组织设计报审表', '总监理工程师任命书', '监理规划', '监理细则',
  '方案审核意见', '索赔报告', '巡视记录', '安全检查记录', '质量评估报告', '付款审核意见', '通用文档',
]
const PROJECT_TYPES = ['通用', '通信工程', '信息化工程', '电力工程']

type LibraryTemplate = {
  id: string; name: string; docType: string; scope: 'global' | 'professional'; projectType: string
  sourceName: string; path: string; fields?: string[]
}
type SystemTemplate = { id: string; name: string; docType: string; scope: 'system'; projectType: string; sourceName: string; path: string; fields?: string[]; readOnly: true }

export default function TemplateCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [templates, setTemplates] = useState<LibraryTemplate[]>([])
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([])
  const [importing, setImporting] = useState(false)

  const load = async () => {
    if (!window.electronAPI) return
    try {
      const [shared, system] = await Promise.all([window.electronAPI.listTemplateLibrary(), window.electronAPI.listSystemTemplates()])
      setTemplates(shared)
      setSystemTemplates(system)
    } catch { message.error('模板中心加载失败') }
  }
  useEffect(() => { if (open) load() }, [open])

  const importTemplate = async () => {
    try {
      const values = await form.validateFields()
      const sourcePath = await window.electronAPI.selectTemplateFile()
      if (!sourcePath) return
      setImporting(true)
      const result = await window.electronAPI.importTemplateToLibrary({ sourcePath, ...values })
      if (!result.success) throw new Error(result.error || '导入失败')
      message.success('模板已导入，并已自动识别可填字段')
      await load()
    } catch (error: any) {
      if (error?.errorFields) return
      message.error(error?.message || '模板导入失败')
    } finally { setImporting(false) }
  }

  const createFromSystem = async (item: SystemTemplate) => {
    setImporting(true)
    try {
      const result = await window.electronAPI.cloneSystemTemplateToLibrary({ docType: item.docType, scope: 'global', projectType: '通用', name: `${item.docType}企业模板` })
      if (!result.success || !result.template) throw new Error(result.error || '创建失败')
      await load()
      await window.electronAPI.openFile(result.template.path)
      message.success('已创建企业可编辑副本，并在 Word 中打开；保存后点击“重新读取字段”即可生效。')
    } catch (error: any) { message.error(error?.message || '创建企业模板失败') } finally { setImporting(false) }
  }

  const refreshTemplate = async (item: LibraryTemplate) => {
    try {
      const result = await window.electronAPI.refreshTemplateLibraryEntry(item.id)
      if (!result.success) throw new Error(result.error || '读取失败')
      await load()
      message.success(`已重新读取字段：${result.template?.fields?.length || 0} 个`)
    } catch (error: any) { message.error(error?.message || '读取字段失败') }
  }

  return <Modal title={<Space><BookOutlined /><span>企业模板中心</span></Space>} open={open} onCancel={onClose} footer={null} width={720}>
    <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
      企业共享模板可在此统一维护；项目专属模板请在项目配置中管理。
    </Text>
    <Alert type="info" showIcon style={{ marginBottom: 12 }} message="新手怎么用：先用预置模板；需要改格式时点“复制为企业模板”→ Word 编辑并保存 → 点“重新读取字段”；业主特殊格式再在对应项目上传专属模板。" />
    <Form form={form} layout="inline" initialValues={{ docType: '监理周报', scope: 'professional', projectType: '通用' }} style={{ marginBottom: 16 }}>
      <Form.Item name="docType" rules={[{ required: true }]}><Select style={{ width: 150 }} options={DOC_TYPES.map(value => ({ value }))} /></Form.Item>
      <Form.Item name="scope" rules={[{ required: true }]}><Select style={{ width: 110 }} options={[{ value: 'professional', label: '专业模板' }, { value: 'global', label: '通用模板' }]} /></Form.Item>
      <Form.Item name="projectType"><Select style={{ width: 120 }} options={PROJECT_TYPES.map(value => ({ value }))} /></Form.Item>
      <Button type="primary" icon={<InboxOutlined />} loading={importing} onClick={importTemplate}>导入 Word 模板</Button>
    </Form>
    <div style={{ maxHeight: 320, overflow: 'auto', borderTop: '1px solid #f0f0f0' }}>
      <Text strong style={{ display: 'block', margin: '10px 0 4px', fontSize: 12 }}>企业共享模板（可导入、可替换）</Text>
      {templates.length === 0 ? <div style={{ padding: '10px 4px', color: '#999', fontSize: 12 }}>暂无企业共享模板，当前项目会继续使用系统预置模板。</div> : templates.map(item => <div key={item.id} style={{ padding: '10px 4px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div><Text strong>{item.name}</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>{item.docType} · {item.scope === 'professional' ? item.projectType : '所有项目'} · 已识别 {item.fields?.length || 0} 个字段</Text></div>
        <Space><Tag color={item.scope === 'professional' ? 'blue' : 'green'}>{item.scope === 'professional' ? '专业' : '通用'}</Tag><Button size="small" icon={<EditOutlined />} onClick={() => window.electronAPI.openFile(item.path)}>编辑</Button><Button size="small" icon={<ReloadOutlined />} onClick={() => refreshTemplate(item)}>重新读取字段</Button></Space>
      </div>)}
      <Text strong style={{ display: 'block', margin: '14px 0 4px', fontSize: 12 }}>系统预置模板（只读基础库）</Text>
      {systemTemplates.map(item => <div key={item.id} style={{ padding: '8px 4px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div><Text>{item.docType}</Text><Text type="secondary" style={{ fontSize: 12 }}> · {item.sourceName} · {item.fields?.length || 0} 个字段</Text></div>
        <Space><Tag>预置</Tag><Button size="small" onClick={() => window.electronAPI.openFile(item.path)}>查看</Button><Button size="small" icon={<EditOutlined />} onClick={() => createFromSystem(item)}>复制为企业模板</Button></Space>
      </div>)}
    </div>
  </Modal>
}

import { useEffect, useState } from 'react'
import { App, Button, Form, Modal, Select, Space, Tag, Typography } from 'antd'
import { BookOutlined, InboxOutlined } from '@ant-design/icons'

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

export default function TemplateCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [templates, setTemplates] = useState<LibraryTemplate[]>([])
  const [importing, setImporting] = useState(false)

  const load = async () => {
    if (!window.electronAPI) return
    try { setTemplates(await window.electronAPI.listTemplateLibrary()) } catch { message.error('模板中心加载失败') }
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

  return <Modal title={<Space><BookOutlined /><span>模板中心</span></Space>} open={open} onCancel={onClose} footer={null} width={720}>
    <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
      只需导入一次：通用模板自动供所有项目使用；专业模板将随项目类型自动匹配。项目专用模板可在项目页面单独指定。
    </Text>
    <Form form={form} layout="inline" initialValues={{ docType: '监理周报', scope: 'professional', projectType: '通用' }} style={{ marginBottom: 16 }}>
      <Form.Item name="docType" rules={[{ required: true }]}><Select style={{ width: 150 }} options={DOC_TYPES.map(value => ({ value }))} /></Form.Item>
      <Form.Item name="scope" rules={[{ required: true }]}><Select style={{ width: 110 }} options={[{ value: 'professional', label: '专业模板' }, { value: 'global', label: '通用模板' }]} /></Form.Item>
      <Form.Item name="projectType"><Select style={{ width: 120 }} options={PROJECT_TYPES.map(value => ({ value }))} /></Form.Item>
      <Button type="primary" icon={<InboxOutlined />} loading={importing} onClick={importTemplate}>导入 Word 模板</Button>
    </Form>
    <div style={{ maxHeight: 340, overflow: 'auto', borderTop: '1px solid #f0f0f0' }}>
      {templates.length === 0 ? <div style={{ padding: 28, textAlign: 'center', color: '#999' }}>尚未导入自定义模板</div> : templates.map(item => <div key={item.id} style={{ padding: '10px 4px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div><Text strong>{item.name}</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>{item.docType} · {item.scope === 'professional' ? item.projectType : '所有项目'} · 已识别 {item.fields?.length || 0} 个字段</Text></div>
        <Space><Tag color={item.scope === 'professional' ? 'blue' : 'green'}>{item.scope === 'professional' ? '专业' : '通用'}</Tag><Button size="small" onClick={() => window.electronAPI.openFile(item.path)}>查看</Button></Space>
      </div>)}
    </div>
  </Modal>
}

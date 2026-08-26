import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { App, Button, Form, Input, Layout, Modal, Select, Space, Tree, Typography } from 'antd'
import { AppstoreOutlined, FolderOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import TemplateLibraryZone from '../components/TemplateLibraryZone'
import DocTypePromptEditor from '../components/DocTypePromptEditorV2'
import { PROJECT_TYPE_OPTIONS } from '../shared/projectProfile.mjs'
import { useSettingsStore } from '../stores/useSettingsStore'

const { Sider, Content } = Layout
const { Text } = Typography

export default function TemplateCenter() {
  const [searchParams] = useSearchParams()
  const { message } = App.useApp()
  const customProjectTypes = useSettingsStore(state => state.customProjectTypes)
  const coreProjectTypeCodes = ['information', 'communication', 'power', 'building', 'municipal']
  const projectTypes = useMemo(() => [
    ...PROJECT_TYPE_OPTIONS.filter(item => coreProjectTypeCodes.includes(item.code)),
    ...customProjectTypes,
  ], [customProjectTypes])
  const [section, setSection] = useState('general-templates')
  const [projectTypeCode, setProjectTypeCode] = useState(projectTypes[0]?.code || 'information')
  const [editingRule, setEditingRule] = useState<{ docType: string; templateId?: string } | null>(() => {
    const docType = searchParams.get('rules')
    return docType ? { docType, templateId: searchParams.get('templateId') || undefined } : null
  })
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const [specialtyForm] = Form.useForm<{ label: string }>()
  const selectedProjectType = projectTypes.find(item => item.code === projectTypeCode) || projectTypes[0]

  const renderContent = () => {
    if (editingRule) {
      return <DocTypePromptEditor key={`${editingRule.docType}:${editingRule.templateId || ''}`} initialDocType={editingRule.docType} templateId={editingRule.templateId} onBack={() => setEditingRule(null)} />
    }
    if (section === 'general-rules') {
      return <DocTypePromptEditor key="general-rules" onBack={() => setSection('general-templates')} />
    }
    if (section === 'general-templates') {
      return <TemplateLibraryZone scope="global" display="all" title="通用模板" onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
    }
    if (section === 'other-templates') {
      return <TemplateLibraryZone scope="other" display="enterprise" title="其他模板" onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
    }
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space>
          <Text strong>选择专业：</Text>
          <Select
            value={selectedProjectType?.code}
            onChange={setProjectTypeCode}
            style={{ width: 220 }}
            options={projectTypes.map(item => ({ value: item.code, label: item.label }))}
          />
          <Button icon={<PlusOutlined />} onClick={() => setSpecialtyOpen(true)}>添加专业</Button>
        </Space>
        {selectedProjectType && (
          <TemplateLibraryZone
            key={selectedProjectType.code}
            scope="professional"
            display="enterprise"
            projectType={selectedProjectType.label}
            title={`专业模板 · ${selectedProjectType.label}`}
            onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })}
          />
        )}
      </Space>
    )
  }

  return (
    <Layout style={{ height: '100%' }}>
      {!editingRule && <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0', padding: '12px 8px' }}>
        <Space size={6} style={{ padding: '0 8px 12px' }}>
          <AppstoreOutlined style={{ color: '#1677ff' }} />
          <Text strong>模板中心</Text>
        </Space>
        <Tree
          showIcon
          defaultExpandAll
          selectedKeys={[section === 'professional' ? `specialty-${projectTypeCode}` : section]}
          onSelect={keys => {
            if (!keys.length) return
            const key = String(keys[0])
            if (key.startsWith('specialty-')) {
              setProjectTypeCode(key.slice('specialty-'.length))
              setSection('professional')
            } else {
              setSection(key)
            }
            setEditingRule(null)
          }}
          treeData={[
            {
              key: 'general-group', title: '通用模板', selectable: false, icon: <FolderOutlined />,
              children: [
                { key: 'general-templates', title: '模板文件', icon: <FolderOutlined /> },
                { key: 'general-rules', title: 'AI 扩写规则', icon: <ThunderboltOutlined /> },
              ],
            },
            {
              key: 'professional-group', title: '专业模板', selectable: false, icon: <FolderOutlined />,
              children: projectTypes.map(item => ({ key: `specialty-${item.code}`, title: item.label, icon: <FolderOutlined /> })),
            },
            { key: 'other-templates', title: '其他模板', icon: <FolderOutlined /> },
          ]}
        />
      </Sider>}
      <Content style={{ padding: editingRule ? 0 : 16, overflow: 'auto', background: editingRule ? '#fff' : '#fafafa' }}>
        {!editingRule && (
          <Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => setEditingRule({ docType: '监理日志' })}
            >
              AI 扩写规则
            </Button>
          </Space>
        )}
        {renderContent()}
      </Content>
      <Modal
        title="添加专业"
        open={specialtyOpen}
        okText="添加"
        cancelText="取消"
        onCancel={() => { setSpecialtyOpen(false); specialtyForm.resetFields() }}
        onOk={() => specialtyForm.validateFields().then(async ({ label }) => {
          const name = label.trim()
          if (projectTypes.some(item => item.label === name)) {
            message.warning('该专业已存在')
            return
          }
          const settings = await window.electronAPI.getSettings()
          const stamp = Date.now().toString(36)
          const next = [...(settings.customProjectTypes || []), {
            code: `specialty_${stamp}`,
            label: name,
            aliases: [name],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }]
          const result = await window.electronAPI.setSettings({ ...settings, customProjectTypes: next })
          if (!result?.success) throw new Error(result?.error || '添加失败')
          await useSettingsStore.getState().loadCustomTypes()
          setProjectTypeCode(`specialty_${stamp}`)
          setSpecialtyOpen(false)
          specialtyForm.resetFields()
          message.success('已添加专业')
        }).catch(error => { if (error?.message) message.error(error.message) })}
      >
        <Form form={specialtyForm} layout="vertical">
          <Form.Item name="label" label="专业名称" rules={[{ required: true, whitespace: true, message: '请输入专业名称' }]}>
            <Input placeholder="例如：水利工程" maxLength={30} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}

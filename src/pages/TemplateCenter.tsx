import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Form, Input, Layout, Modal, Select, Space, Tree, Typography } from 'antd'
import { AppstoreOutlined, DeleteOutlined, FolderOpenOutlined, FolderOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import TemplateLibraryZone from '../components/TemplateLibraryZone'
import DocTypePromptEditor from '../components/DocTypePromptEditorV2'
import { PROJECT_TYPE_OPTIONS } from '../shared/projectProfile.mjs'
import { useSettingsStore } from '../stores/useSettingsStore'

const { Sider, Content } = Layout
const { Text } = Typography

export default function TemplateCenter() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const customProjectTypes = useSettingsStore(state => state.customProjectTypes)
  const [hiddenProfessionalCodes, setHiddenProfessionalCodes] = useState<string[]>([])
  const [templateRoot, setTemplateRoot] = useState('')
  const projectTypes = useMemo(() => [
    ...PROJECT_TYPE_OPTIONS.filter(item => item.code !== 'unclassified'),
    ...customProjectTypes,
  ].filter(item => !hiddenProfessionalCodes.includes(item.code)), [customProjectTypes, hiddenProfessionalCodes])
  const [section, setSection] = useState('general-templates')
  const [projectTypeCode, setProjectTypeCode] = useState(projectTypes[0]?.code || 'information')
  const [editingRule, setEditingRule] = useState<{ docType: string; templateId?: string } | null>(() => {
    const docType = searchParams.get('rules')
    return docType ? { docType, templateId: searchParams.get('templateId') || undefined } : null
  })
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingSpecialty, setDeletingSpecialty] = useState(false)
  const [specialtyForm] = Form.useForm<{ label: string }>()
  const selectedProjectType = projectTypes.find(item => item.code === projectTypeCode) || projectTypes[0]
  const requestedReturnTo = searchParams.get('returnTo') || ''
  const returnTo = requestedReturnTo.startsWith('/project/') ? requestedReturnTo : ''
  const leaveRuleEditor = () => returnTo ? navigate(returnTo) : setEditingRule(null)

  useEffect(() => {
    void Promise.all([window.electronAPI.getSettings(), window.electronAPI.getTemplateWorkspaceInfo()]).then(([settings, workspace]) => {
      setHiddenProfessionalCodes(Array.isArray(settings.hiddenProfessionalTemplateTypes) ? settings.hiddenProfessionalTemplateTypes : [])
      setTemplateRoot(workspace.root)
    })
  }, [])

  const deleteSpecialty = async () => {
    if (!selectedProjectType) return
    setDeletingSpecialty(true)
    try {
      const result = await window.electronAPI.deleteProfessionalTemplateCategory(selectedProjectType.label, selectedProjectType.code)
      if (!result?.ok) throw new Error(result?.error || '删除专业失败')
      await useSettingsStore.getState().loadCustomTypes()
      setHiddenProfessionalCodes(result.hiddenProfessionalTemplateTypes || [])
      setProjectTypeCode(projectTypes.find(item => item.code !== selectedProjectType.code)?.code || '')
      setDeleteConfirmOpen(false)
      message.success(`已删除专业及 ${result.removedTemplates || 0} 个模板，目录已移到废纸篓`)
    } catch (error: any) {
      message.error(error?.message || '删除专业失败')
    } finally {
      setDeletingSpecialty(false)
    }
  }

  const renderContent = () => {
    if (editingRule) {
      return <DocTypePromptEditor key={`${editingRule.docType}:${editingRule.templateId || ''}`} initialDocType={editingRule.docType} templateId={editingRule.templateId} onBack={leaveRuleEditor} onSaved={returnTo ? () => navigate(returnTo) : undefined} />
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
    if (section === 'personal-templates') {
      return <TemplateLibraryZone scope="personal" display="enterprise" title="私人模板库" onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
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
          <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteConfirmOpen(true)}>删除专业</Button>
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
            {
              key: 'personal-group', title: '私人模板库', selectable: false, icon: <FolderOutlined />,
              children: [
                { key: 'personal-templates', title: '我的模板', icon: <FolderOutlined /> },
              ],
            },
            { key: 'other-templates', title: '其他模板', icon: <FolderOutlined /> },
          ]}
        />
      </Sider>}
      <Content style={{ padding: editingRule ? 0 : 16, overflow: 'auto', background: editingRule ? '#fff' : '#fafafa' }}>
        {!editingRule && (
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
            <Button icon={<FolderOpenOutlined />} onClick={() => window.electronAPI.openPath(templateRoot)} disabled={!templateRoot} title={templateRoot}>打开模板库目录</Button>
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
        title={selectedProjectType ? `删除专业“${selectedProjectType.label}”？` : '删除专业？'}
        open={deleteConfirmOpen}
        okText="删除整个专业"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deletingSpecialty}
        closable={!deletingSpecialty}
        maskClosable={!deletingSpecialty}
        onCancel={() => { if (!deletingSpecialty) setDeleteConfirmOpen(false) }}
        onOk={deleteSpecialty}
      >
        <Text>该专业目录及目录内全部模板文件将移到系统废纸篓，模板中心不再显示该专业。</Text>
      </Modal>
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
          const directory = await window.electronAPI.createProfessionalTemplateCategory(name)
          if (!directory?.ok) throw new Error(directory?.error || '创建专业目录失败')
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

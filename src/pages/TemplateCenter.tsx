import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Form, Input, Layout, Menu, Modal, Space, Tree, Typography } from 'antd'
import { AppstoreOutlined, DeleteOutlined, FolderAddOutlined, FolderOpenOutlined, FolderOutlined, PlusOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons'
import TemplateLibraryZone from '../components/TemplateLibraryZone'
import DocTypePromptEditor from '../components/DocTypePromptEditorV2'
import GlobalRulesCenter from '../components/GlobalRulesCenter'
import { PROJECT_TYPE_OPTIONS } from '../shared/projectProfile.mjs'
import { useSettingsStore } from '../stores/useSettingsStore'

const { Sider, Content } = Layout
const { Text, Title } = Typography

export default function TemplateCenter() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const customProjectTypes = useSettingsStore(state => state.customProjectTypes)
  const [hiddenProfessionalCodes, setHiddenProfessionalCodes] = useState<string[]>([])
  const [templateRoot, setTemplateRoot] = useState('')
  const [customCategories, setCustomCategories] = useState<Array<{ name: string; path: string }>>([])
  const [customCategory, setCustomCategory] = useState('')
  const [treeContext, setTreeContext] = useState<{ key: string; x: number; y: number } | null>(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
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
  const [globalRulesOpen, setGlobalRulesOpen] = useState(false)
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingSpecialty, setDeletingSpecialty] = useState(false)
  const [specialtyForm] = Form.useForm<{ label: string }>()
  const selectedProjectType = projectTypes.find(item => item.code === projectTypeCode) || projectTypes[0]
  const requestedReturnTo = searchParams.get('returnTo') || ''
  const returnTo = requestedReturnTo.startsWith('/project/') ? requestedReturnTo : ''
  const leaveRuleEditor = () => returnTo ? navigate(returnTo) : setEditingRule(null)

  const loadTemplateNavigation = async () => {
    const [settings, workspace, categoryResult] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getTemplateWorkspaceInfo(),
      window.electronAPI.listTemplateCategories('other'),
    ])
    setHiddenProfessionalCodes(Array.isArray(settings.hiddenProfessionalTemplateTypes) ? settings.hiddenProfessionalTemplateTypes : [])
    setTemplateRoot(workspace.root)
    if (!categoryResult?.success) throw new Error(categoryResult?.error || '加载模板文件夹失败')
    const categories = Array.isArray(categoryResult.categories) ? categoryResult.categories : []
    setCustomCategories(categories)
    setCustomCategory(current => current && categories.some(item => item.name === current) ? current : (categories[0]?.name || ''))
  }

  useEffect(() => {
    void loadTemplateNavigation()
  }, [])

  useEffect(() => {
    if (!treeContext) return
    const close = () => setTreeContext(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [treeContext])

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
    if (globalRulesOpen) return <GlobalRulesCenter onBack={() => setGlobalRulesOpen(false)} />
    if (editingRule) {
      return <DocTypePromptEditor key={`${editingRule.docType}:${editingRule.templateId || ''}`} initialDocType={editingRule.docType} templateId={editingRule.templateId} onBack={leaveRuleEditor} onSaved={returnTo ? () => navigate(returnTo) : undefined} />
    }
    if (section === 'general-templates') {
      return <TemplateLibraryZone scope="global" display="all" title="通用模板" onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
    }
    if (section === 'custom-templates') {
      return customCategory
        ? <TemplateLibraryZone key={customCategory} scope="other" display="enterprise" projectType={customCategory} title={`自定义模板 · ${customCategory}`} onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
        : <div className="template-empty-category"><FolderAddOutlined /><Text type="secondary">右键“自定义模板”新建第一个模板文件夹</Text></div>
    }
    if (section === 'personal-templates') {
      return <TemplateLibraryZone scope="personal" display="enterprise" title="私人模板库" onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })} />
    }
    if (section === 'site-packages') {
      return selectedProjectType
        ? <TemplateLibraryZone
            key={`site-package-${selectedProjectType.code}`}
            scope="professional"
            display="enterprise"
            resourceKind="site-package"
            projectType={selectedProjectType.label}
            title={`站点资料包 · ${selectedProjectType.label}`}
            onGoRules={(docType, templateId) => setEditingRule({ docType, templateId })}
          />
        : null
    }
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
    <Layout style={{ height: '100%', background: '#f7f8fa' }}>
      {!editingRule && !globalRulesOpen && <Sider width={220} theme="light" style={{ borderRight: '1px solid #e8ebef', padding: '16px 10px', background: '#fff' }}>
        <Space size={8} style={{ padding: '0 8px 16px' }}>
          <AppstoreOutlined style={{ color: '#1677ff' }} />
          <Text strong>模板中心</Text>
        </Space>
        <Tree
          className="template-center-tree"
          showIcon
          defaultExpandAll
          selectedKeys={[section === 'professional' ? `specialty-${projectTypeCode}` : section === 'site-packages' ? `site-package-${projectTypeCode}` : section === 'custom-templates' ? `custom:${customCategory}` : section]}
          onSelect={keys => {
            if (!keys.length) return
            const key = String(keys[0])
            if (key.startsWith('specialty-')) {
              setProjectTypeCode(key.slice('specialty-'.length))
              setSection('professional')
            } else if (key.startsWith('site-package-')) {
              setProjectTypeCode(key.slice('site-package-'.length))
              setSection('site-packages')
            } else if (key.startsWith('custom:')) {
              setCustomCategory(key.slice('custom:'.length))
              setSection('custom-templates')
            } else {
              setSection(key)
            }
            setEditingRule(null)
          }}
          onRightClick={({ event, node }) => {
            event.preventDefault()
            setTreeContext({ key: String(node.key), x: event.clientX, y: event.clientY })
          }}
          treeData={[
            {
              key: 'general-group', title: '通用模板', selectable: false, icon: <FolderOutlined />,
              children: [
                { key: 'general-templates', title: '模板文件', icon: <FolderOutlined /> },
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
            {
              key: 'site-package-group', title: '站点资料包', selectable: false, icon: <FolderOutlined />,
              children: projectTypes.map(item => ({ key: `site-package-${item.code}`, title: item.label, icon: <FolderOutlined /> })),
            },
            {
              key: 'custom-group', title: '自定义模板', selectable: false, icon: <FolderOutlined />,
              children: customCategories.map(item => ({ key: `custom:${item.name}`, title: item.name, icon: <FolderOutlined /> })),
            },
          ]}
        />
        <Text type="secondary" style={{ display: 'block', padding: '12px 10px 0', fontSize: 12 }}>右键文件夹可新增或删除</Text>
      </Sider>}
      <Content style={{ padding: 0, overflow: 'auto', background: editingRule || globalRulesOpen ? '#fff' : '#f7f8fa' }}>
        {editingRule || globalRulesOpen ? renderContent() : <div className="app-page app-page--wide">
          <header className="app-page-header">
            <div className="app-page-heading">
              <span className="app-page-heading__icon"><AppstoreOutlined /></span>
              <div className="app-page-heading__copy">
                <Title level={3} className="app-page-heading__title">模板中心</Title>
                <Text className="app-page-heading__description">统一管理模板文件、占位符与 AI 扩写规则</Text>
              </div>
            </div>
            <div className="app-page-actions">
              <Button icon={<FolderOpenOutlined />} onClick={() => window.electronAPI.openPath(templateRoot)} disabled={!templateRoot} title={templateRoot}>打开模板库</Button>
              <Button icon={<SafetyCertificateOutlined />} onClick={() => setGlobalRulesOpen(true)}>全局规则</Button>
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setEditingRule({ docType: '监理日志' })}>AI 扩写中心</Button>
            </div>
          </header>
          {renderContent()}
        </div>}
      </Content>
      {treeContext && <div style={{ position: 'fixed', left: treeContext.x, top: treeContext.y, zIndex: 4000, minWidth: 190, borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.18)' }} onClick={event => event.stopPropagation()}>
        <Menu selectable={false} items={treeContext.key === 'custom-group'
          ? [{ key: 'create-custom', label: '新建模板文件夹', icon: <FolderAddOutlined /> }, { key: 'open-root', label: '打开模板库', icon: <FolderOpenOutlined /> }]
          : treeContext.key.startsWith('custom:')
            ? [{ key: 'open-custom', label: '进入文件夹并添加模板', icon: <PlusOutlined /> }, { type: 'divider' as const }, { key: 'delete-custom', label: '删除文件夹及全部模板', icon: <DeleteOutlined />, danger: true }]
            : treeContext.key === 'professional-group'
              ? [{ key: 'create-professional', label: '新建专业文件夹', icon: <FolderAddOutlined /> }]
              : treeContext.key.startsWith('specialty-')
                ? [{ key: 'open-professional', label: '进入专业并添加模板', icon: <PlusOutlined /> }, { type: 'divider' as const }, { key: 'delete-professional', label: '删除专业及全部模板', icon: <DeleteOutlined />, danger: true }]
                : [{ key: 'open-root', label: '打开模板库', icon: <FolderOpenOutlined /> }]}
          onClick={({ key }) => {
            const contextKey = treeContext.key
            setTreeContext(null)
            if (key === 'create-custom') { setNewCategoryName(''); setCategoryOpen(true) }
            else if (key === 'open-root') void window.electronAPI.openPath(templateRoot)
            else if (key === 'open-custom') { setCustomCategory(contextKey.slice('custom:'.length)); setSection('custom-templates') }
            else if (key === 'delete-custom') {
              const name = contextKey.slice('custom:'.length)
              modal.confirm({ title: `删除模板文件夹“${name}”？`, content: '文件夹和其中全部模板将移到系统废纸篓。', okText: '删除', okType: 'danger', onOk: async () => { const result = await window.electronAPI.deleteTemplateCategory('other', name); if (!result.ok) throw new Error(result.error || '删除失败'); message.success('文件夹已移到废纸篓'); await loadTemplateNavigation(); setSection('general-templates') } })
            } else if (key === 'create-professional') setSpecialtyOpen(true)
            else if (key === 'open-professional') { setProjectTypeCode(contextKey.slice('specialty-'.length)); setSection('professional') }
            else if (key === 'delete-professional') { setProjectTypeCode(contextKey.slice('specialty-'.length)); window.setTimeout(() => setDeleteConfirmOpen(true), 0) }
          }} />
      </div>}
      <Modal title="新建模板文件夹" open={categoryOpen} okText="创建" cancelText="取消" onCancel={() => setCategoryOpen(false)} onOk={async () => {
        const name = newCategoryName.trim()
        if (!name) { message.warning('请输入文件夹名称'); return }
        if (customCategories.some(item => item.name === name)) { message.warning('该文件夹已存在'); return }
        const result = await window.electronAPI.createTemplateCategory('other', name)
        if (!result.ok) { message.error(result.error || '创建失败'); return }
        setCategoryOpen(false); setCustomCategory(name); setSection('custom-templates'); await loadTemplateNavigation(); message.success('模板文件夹已创建')
      }}><Input value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} onPressEnter={() => undefined} placeholder="例如：水利专用表单" autoFocus /></Modal>
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

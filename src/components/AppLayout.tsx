import { useState, useEffect } from 'react'
import { Layout, Button, Typography, Modal, Input, Select, Space, App } from 'antd'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  PlusOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  SearchOutlined,
  BookOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../stores/useProjectStore'
import GlobalSearch from './GlobalSearch'
import TemplateCenterModal from './TemplateCenterModal'
import { PROJECT_TYPE_OPTIONS, getProjectTypeProfile, normalizeTags } from '../shared/projectProfile.mjs'

const { Sider, Content } = Layout
const { Text } = Typography

export default function AppLayout() {
  const navigate = useNavigate()
  const { loadSettings, loadProjects, setCurrentProject, createProject, projectRoot } = useAppStore()
  const { message } = App.useApp()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState<string>()
  const [newProjectTags, setNewProjectTags] = useState<string[]>([])
  const [newProjectFeatures, setNewProjectFeatures] = useState('')
  const [newProjectCode, setNewProjectCode] = useState('')
  const [newOwnerUnit, setNewOwnerUnit] = useState('')
  const [newContractor, setNewContractor] = useState('')
  const [newSupervisorUnit, setNewSupervisorUnit] = useState('')
  const [newChiefEngineer, setNewChiefEngineer] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [templateCenterOpen, setTemplateCenterOpen] = useState(false)

  // 键盘快捷键 Cmd+K / Ctrl+K 打开搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !newProjectType) {
      message.warning('请填写项目名称并选择项目类型')
      return
    }
    setLoading(true)
    const result = await createProject(newProjectName.trim(), newProjectType, { projectTags: normalizeTags(newProjectTags), projectFeatures: newProjectFeatures, projectCode: newProjectCode, ownerUnit: newOwnerUnit, contractor: newContractor, supervisorUnit: newSupervisorUnit, chiefEngineer: newChiefEngineer })
    setLoading(false)
    if (result.success) {
      setCreateModalOpen(false)
      setNewProjectName('')
      setNewProjectType(undefined)
      setNewProjectTags([])
      setNewProjectFeatures('')
      setNewProjectCode(''); setNewOwnerUnit(''); setNewContractor(''); setNewSupervisorUnit(''); setNewChiefEngineer('')
      await loadProjects()
      const updatedProjects = useAppStore.getState().projects
      const project = updatedProjects.find(p => p.name === newProjectName.trim())
      if (project) {
        setCurrentProject(project)
        navigate(`/project/${encodeURIComponent(project.name)}`)
      }
    } else {
      message.error(result.error || '创建项目失败')
    }
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧栏 */}
      <Sider
        width={56}
        theme="light"
        style={{
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        {/* 顶部图标 */}
        <div style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          borderBottom: '1px solid #f0f0f0',
          cursor: 'pointer',
          color: '#1677ff',
          fontSize: 20,
        }} onClick={() => navigate('/')}>
          <ProjectOutlined />
        </div>

        {/* 操作按钮 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}>
          <Button
            type="text"
            icon={<BookOutlined />}
            onClick={() => setTemplateCenterOpen(true)}
            style={{ fontSize: 18, width: 40, height: 40 }}
            title="模板中心"
          />
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
            style={{ fontSize: 18, width: 40, height: 40 }}
            title="新建项目"
          />
          <Button
            type="text"
            icon={<SearchOutlined />}
            onClick={() => setSearchOpen(true)}
            style={{ fontSize: 18, width: 40, height: 40 }}
            title="搜索文档 (⌘K)"
          />
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={() => navigate('/settings')}
            style={{ fontSize: 18, width: 40, height: 40 }}
            title="系统设置"
          />
          <Button
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={() => navigate('/')}
            style={{ fontSize: 18, width: 40, height: 40 }}
            title="控制台"
          />
        </div>
      </Sider>

      {/* 新建项目弹窗 */}
      <Modal
        title="新建项目"
        open={createModalOpen}
        onOk={handleCreateProject}
        onCancel={() => { setCreateModalOpen(false); setNewProjectName(''); setNewProjectType(undefined); setNewProjectTags([]); setNewProjectFeatures(''); setNewProjectCode(''); setNewOwnerUnit(''); setNewContractor(''); setNewSupervisorUnit(''); setNewChiefEngineer('') }}
        confirmLoading={loading}
        okText="创建"
        width={560}
      >
        <div style={{ padding: '16px 0' }}>
          <Text type="secondary">项目将创建在：</Text>
          <Text code style={{ display: 'block', marginTop: 4, marginBottom: 12, fontSize: 12 }}>{projectRoot || '未设置根目录'}</Text>
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>项目类型</Text>
            <Select
              value={newProjectType}
              onChange={setNewProjectType}
              style={{ width: '100%' }}
              size="small"
              placeholder="请选择项目类型"
              options={PROJECT_TYPE_OPTIONS.filter(item => item.code !== 'unclassified').map(item => ({ value: item.label, label: item.label }))}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>专业标签（可选，可自定义）</Text>
            <Select mode="tags" value={newProjectTags} onChange={setNewProjectTags} style={{ width: '100%' }} size="small"
              placeholder={newProjectType ? `如：${getProjectTypeProfile(newProjectType).suggestedTags.join('、')}` : '请先选择项目类型'}
              options={(newProjectType ? getProjectTypeProfile(newProjectType).suggestedTags : []).map(tag => ({ value: tag, label: tag }))} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>项目特点 / 建设范围（可选）</Text>
            <Input.TextArea rows={2} value={newProjectFeatures} onChange={e => setNewProjectFeatures(e.target.value)} placeholder="如：数据中心机房改造，含综合布线、核心交换和视频监控；正在实施阶段。" />
          </div>
          <Text strong style={{ display: 'block', margin: '12px 0 6px', fontSize: 13 }}>项目基础信息</Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 11 }}>一次建档，后续自动写入模板和 AI 上下文；未确认的信息可暂留空，但正式件不能使用待核对字段。</Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Input value={newProjectCode} onChange={e => setNewProjectCode(e.target.value)} placeholder="项目编码（可留空自动生成）" />
            <Input value={newOwnerUnit} onChange={e => setNewOwnerUnit(e.target.value)} placeholder="建设单位" />
            <Input value={newContractor} onChange={e => setNewContractor(e.target.value)} placeholder="施工单位" />
            <Input value={newSupervisorUnit} onChange={e => setNewSupervisorUnit(e.target.value)} placeholder="监理单位" />
            <Input value={newChiefEngineer} onChange={e => setNewChiefEngineer(e.target.value)} placeholder="总监理工程师" />
          </div>
          <Input
            style={{ marginTop: 12 }}
            placeholder="请输入项目名称"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onPressEnter={handleCreateProject}
          />
        </div>
      </Modal>

      {/* 主内容区 */}
      <Layout>
        <Content style={{
          overflow: 'auto',
          background: '#fff',
        }}>
          <Outlet />
        </Content>
      </Layout>

      {/* 全局搜索 */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenFile={(path) => window.electronAPI?.openFile(path)}
      />
      <TemplateCenterModal open={templateCenterOpen} onClose={() => setTemplateCenterOpen(false)} />
    </Layout>
  )
}

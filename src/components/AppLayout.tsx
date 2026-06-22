import { useState, useEffect } from 'react'
import { Layout, Button, Typography, Modal, Input, Select, Space, App } from 'antd'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  PlusOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../stores/useProjectStore'
import GlobalSearch from './GlobalSearch'

const { Sider, Content } = Layout
const { Text } = Typography

export default function AppLayout() {
  const navigate = useNavigate()
  const { loadSettings, loadProjects, setCurrentProject, createProject, projectRoot } = useAppStore()
  const { message } = App.useApp()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState('通用')
  const [loading, setLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

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
    if (!newProjectName.trim()) return
    setLoading(true)
    const result = await createProject(newProjectName.trim(), newProjectType)
    setLoading(false)
    if (result.success) {
      setCreateModalOpen(false)
      setNewProjectName('')
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
        onCancel={() => { setCreateModalOpen(false); setNewProjectName(''); setNewProjectType('通用') }}
        confirmLoading={loading}
        okText="创建"
        width={480}
      >
        <div style={{ padding: '16px 0' }}>
          <Text type="secondary">项目将创建在：</Text>
          <Text code style={{ display: 'block', marginTop: 4, marginBottom: 12, fontSize: 12 }}>{projectRoot || '未设置根目录'}</Text>
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>项目类型</Text>
            <Select
              value={newProjectType}
              onChange={setNewProjectType}
              style={{ width: '100%' }}
              size="small"
              options={[
                { value: '通用', label: '通用' },
                { value: '通信工程', label: '通信工程' },
                { value: '信息化工程', label: '信息化工程' },
                { value: '电力工程', label: '电力工程' },
              ]}
            />
          </div>
          <Input
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
    </Layout>
  )
}

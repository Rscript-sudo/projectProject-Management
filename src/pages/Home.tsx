import { useEffect, useState, useRef, useCallback } from 'react'
import { Button, Card, Typography, Space, Modal, Input, Select, Spin, Form, Tooltip, App } from 'antd'
import {
  PlusOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  RobotOutlined,
  ReloadOutlined,
  HomeOutlined,
  LinkOutlined,
  EditOutlined,
  FileSearchOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import DirTree from '../components/DirTree'
import DashboardCard from '../components/DashboardCard'
import CompletenessPanel from '../components/CompletenessPanel'
import LedgerPanel from '../components/LedgerPanel'
import DataBoard from '../components/DataBoard'
import type { DirNode, ScanCompletenessResult } from '../vite-env'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography

export default function Home() {
  const navigate = useNavigate()
  const { projects, loadProjects, setCurrentProject, projectRoot, createProject } = useAppStore()
  const { modal, message } = App.useApp()

  // 3-panel layout
  const [treeWidth, setTreeWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(380)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // DirTree state
  const [dirTree, setDirTree] = useState<DirNode | null>(null)
  const apiReady = useElectronAPI()

  // Project selection
  const [selectedProject, setSelectedProject] = useState<{ name: string; path: string } | null>(null)

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectType, setNewProjectType] = useState('通用')
  const [creating, setCreating] = useState(false)

  // Project config
  const [projectConfig, setProjectConfig] = useState({ contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用' })
  const [editMode, setEditMode] = useState(false)
  const [configForm] = Form.useForm()

  // Completeness check
  const [completenessResult, setCompletenessResult] = useState<ScanCompletenessResult | null>(null)
  const [scanning, setScanning] = useState(false)

  // --- 加载函数 ---
  const loadDirTree = async (dirPath: string) => {
    if (!window.electronAPI) return
    try {
      const tree = await window.electronAPI.getDirTree(dirPath, 99)
      setDirTree(tree)
    } catch (e) {
      console.error('[Home] Failed to load directory tree:', e)
    }
  }

  const loadProjectConfig = async (projectPath: string) => {
    if (!window.electronAPI) return
    try {
      const config = await window.electronAPI.readProjectConfig(projectPath)
      setProjectConfig(config)
      configForm.setFieldsValue(config)
    } catch (e) {
      const defaults = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用' }
      setProjectConfig(defaults)
      configForm.setFieldsValue(defaults)
    }
  }

  // --- 生命周期 ---
  useEffect(() => {
    if (apiReady && projectRoot) {
      loadDirTree(projectRoot)
      useAppStore.getState().loadProjects()
    }
  }, [apiReady, projectRoot])

  // 自动选中第一个项目
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      const first = projects[0]
      setSelectedProject(first)
      loadProjectConfig(first.path)
    }
  }, [projects, selectedProject, loadProjectConfig])

  // --- 操作 ---
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    const result = await createProject(newProjectName.trim(), newProjectType)
    setCreating(false)
    if (result.success) {
      setCreateModalOpen(false)
      setNewProjectName('')
      setNewProjectType('通用')
      await loadProjects()
      loadDirTree(projectRoot)
      const updated = useAppStore.getState().projects
      const proj = updated.find(p => p.name === newProjectName.trim())
      if (proj) {
        setSelectedProject(proj)
        loadProjectConfig(proj.path)
      }
    } else {
      message.error(result.error || '创建失败')
    }
  }

  const handleSelectProject = (project: { name: string; path: string }) => {
    setSelectedProject(project)
    // 直接调用避免闭包 stale 问题
    if (window.electronAPI) {
      window.electronAPI.readProjectConfig(project.path)
        .then(config => {
          setProjectConfig(config)
          configForm.setFieldsValue(config)
        })
        .catch(() => {
          const defaults = { contractor: '', ownerUnit: '', supervisorUnit: '', chiefEngineer: '', projectType: '通用' }
          setProjectConfig(defaults)
          configForm.setFieldsValue(defaults)
        })
    }
  }

  const handleTreeFolderSelect = (path: string) => {
    if (!projectRoot) return
    // 点击树中文件夹时，检查是否是项目根目录
    const project = projects.find(p => p.path === path)
    if (project) {
      handleSelectProject(project)
    }
  }

  const handleFileClick = (path: string) => {
    if (!window.electronAPI) return
    window.electronAPI.openFile(path)
  }

  const handleOpenProject = () => {
    if (!selectedProject) return
    setCurrentProject(selectedProject)
    navigate(`/project/${encodeURIComponent(selectedProject.name)}`)
  }

  const handleDeleteProject = (project: { name: string; path: string }) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除项目"${project.name}"吗？文件将移到废纸篓。`,
      okText: '删除到废纸篓',
      okType: 'danger',
      onOk: async () => {
        if (!window.electronAPI) return
        try {
          const result = await window.electronAPI.deleteProject(project.path)
          if (!result || !result.success) {
            message.error('删除失败：' + (result?.error || '未知错误'))
            return
          }
          await loadProjects()
          loadDirTree(projectRoot)
          if (selectedProject?.path === project.path) {
            setSelectedProject(null)
          }
        } catch (e: any) {
          message.error('删除失败：' + (e?.message || '未知错误'))
        }
      },
    })
  }

  const handleUnbindProject = (project: { name: string; path: string }) => {
    modal.confirm({
      title: '解除绑定',
      content: `将"${project.name}"从控制台移除，项目文件不会被删除。`,
      okText: '解除绑定',
      onOk: async () => {
        if (!window.electronAPI) return
        const result = await window.electronAPI.unbindProject(project.path)
        if (!result || !result.success) {
        message.error('解除绑定失败：' + (result?.error || '未知错误'))
          return
        }
        await loadProjects()
        if (selectedProject?.path === project.path) {
          setSelectedProject(null)
        }
        message.success(`"${project.name}"已解除绑定`)
      },
    })
  }

  const handleSaveConfig = async () => {
    if (!selectedProject || !window.electronAPI) return
    try {
      const values = configForm.getFieldsValue(true)
      console.log('[Home] Saving config:', selectedProject.path, values)
      const result = await window.electronAPI.writeProjectConfig(selectedProject.path, values)
      console.log('[Home] Save result:', result)
      if (!result || !result.success) {
        message.error('保存失败：' + (result?.error || '服务端返回异常'))
        return
      }
      setProjectConfig(values)
      setEditMode(false)
      setTimeout(() => message.success('项目配置已保存'), 100)
    } catch (e: any) {
      console.error('[Home] Save config error:', e)
      const errMsg = e?.message || e?.toString() || '表单验证失败'
      message.error('保存失败：' + errMsg)
    }
  }

  const handleScanCompleteness = async () => {
    if (!selectedProject || !window.electronAPI) return
    setScanning(true)
    try {
      const result = await window.electronAPI.scanProjectCompleteness(selectedProject.path)
      setCompletenessResult(result)
    } catch (e: any) {
      message.error('扫描失败：' + (e?.message || '未知错误'))
    } finally {
      setScanning(false)
    }
  }

  const handleCreateDoc = (docType: string) => {
    if (!selectedProject) return
    setCurrentProject(selectedProject)
    navigate(`/project/${encodeURIComponent(selectedProject.name)}?docType=${encodeURIComponent(docType)}`)
  }

  // 清理未完成的拖拽
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    }
  }, [])

  // --- 拖拽调整面板宽度 ---
  const handleResizeStart = (panel: 'tree' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    dragCleanupRef.current?.()  // 清理旧的拖拽事件
    const startX = e.clientX
    const startWidth = panel === 'tree' ? treeWidth : rightWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      if (panel === 'tree') {
        setTreeWidth(Math.max(180, Math.min(500, startWidth + delta)))
      } else {
        setRightWidth(Math.max(240, Math.min(600, startWidth - delta)))
      }
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    dragCleanupRef.current = onMouseUp
  }

  // 从目录树计算项目文件数
  const getProjectStats = useCallback((projectPath: string): { folders: number; files: number } => {
    const count = (node: DirNode): { folders: number; files: number } => {
      if (node.type === 'file') return { folders: 0, files: 1 }
      let folders = 1
      let files = 0
      for (const child of node.children || []) {
        const c = count(child)
        folders += c.folders
        files += c.files
      }
      return { folders, files }
    }

    const findNode = (node: DirNode): DirNode | null => {
      if (node.path === projectPath) return node
      for (const child of node.children || []) {
        const found = findNode(child)
        if (found) return found
      }
      return null
    }

    if (!dirTree) return { folders: 0, files: 0 }
    const node = findNode(dirTree)
    if (!node) return { folders: 0, files: 0 }
    return count(node)
  }, [dirTree])

  // --- 加载状态 ---
  if (!apiReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin tip="正在连接系统..." />
      </div>
    )
  }

  // --- 拖拽手柄组件 ---
  const DragHandle = ({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) => (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 5,
        cursor: 'col-resize',
        background: 'transparent',
        flexShrink: 0,
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0,
        left: 2,
        width: 1,
        background: '#e8e8e8',
      }} />
    </div>
  )

  return (
    <div ref={containerRef} style={{ display: 'flex', height: '100%', gap: 0, overflow: 'hidden' }}>
      {/* ========== 左侧：目录树 ========== */}
      <div style={{
        width: treeWidth,
        flexShrink: 0,
        background: '#fafafa',
        borderRight: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Space size={4}>
            <HomeOutlined style={{ color: '#1677ff', fontSize: 13 }} />
            <Text strong style={{ fontSize: 12 }}>全部项目</Text>
          </Space>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => loadDirTree(projectRoot)}
            title="刷新"
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {dirTree ? (
            <DirTree
              dirTree={dirTree}
              onFileClick={handleFileClick}
              onFolderSelect={handleTreeFolderSelect}
              onRefresh={() => loadDirTree(projectRoot)}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
              <Spin size="small" />
              <div style={{ fontSize: 12, marginTop: 8 }}>加载中...</div>
            </div>
          )}
        </div>
      </div>

      <DragHandle onMouseDown={handleResizeStart('tree')} />

      {/* ========== 中间：项目管理 ========== */}
      <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
        {/* 头部 */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <Title level={5} style={{ margin: 0, fontSize: 15 }}>项目管理控制台</Title>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {projectRoot ? `根目录：${projectRoot}` : '未设置项目根目录'}
            </Text>
          </div>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadDirTree(projectRoot); loadProjects() }}>
              刷新
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              新建项目
            </Button>
            <Button size="small" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
              AI 设置
            </Button>
          </Space>
        </div>

        {/* 项目卡片列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <FolderOpenOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
              <div style={{ fontSize: 15, color: '#999', marginBottom: 8 }}>暂无项目</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {projectRoot ? '点击上方「新建项目」创建第一个监理项目' : '请先在系统设置中设置项目根目录'}
              </Text>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {projects.map(project => {
                const stats = getProjectStats(project.path)
                const isSelected = selectedProject?.path === project.path
                return (
                  <Card
                    key={project.path}
                    size="small"
                    hoverable
                    style={{
                      border: isSelected ? '1px solid #1677ff' : '1px solid #e8e8e8',
                      background: isSelected ? '#f0f5ff' : '#fff',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleSelectProject(project)}
                    onDoubleClick={() => { setCurrentProject(project); navigate(`/project/${encodeURIComponent(project.name)}`) }}
                    actions={[
                      <Tooltip key="open" title="进入AI文档生成">
                        <RobotOutlined onClick={(e) => { e.stopPropagation(); setCurrentProject(project); navigate(`/project/${encodeURIComponent(project.name)}`) }} />
                      </Tooltip>,
                      <Tooltip key="folder" title="打开文件夹">
                        <FolderOpenOutlined onClick={(e) => { e.stopPropagation(); window.electronAPI?.openPath(project.path) }} />
                      </Tooltip>,
                      <Tooltip key="unbind" title="解除绑定（保留文件）">
                        <LinkOutlined style={{ color: '#999' }} onClick={(e) => { e.stopPropagation(); handleUnbindProject(project) }} />
                      </Tooltip>,
                      <Tooltip key="delete" title="删除到废纸篓">
                        <DeleteOutlined style={{ color: '#ff4d4f' }} onClick={(e) => { e.stopPropagation(); handleDeleteProject(project) }} />
                      </Tooltip>,
                    ]}
                  >
                    <Card.Meta
                      title={<Text strong style={{ fontSize: 13 }}>{project.name}</Text>}
                      description={
                        <div>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {project.path}
                          </Text>
                          <Space size={12} style={{ marginTop: 6 }}>
                            <Text style={{ fontSize: 11, color: '#888' }}>
                              目录 <span style={{ color: '#333', fontWeight: 500 }}>{stats.folders}</span>
                            </Text>
                            <Text style={{ fontSize: 11, color: '#888' }}>
                              文件 <span style={{ color: '#333', fontWeight: 500 }}>{stats.files}</span>
                            </Text>
                          </Space>
                        </div>
                      }
                    />
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <DragHandle onMouseDown={handleResizeStart('right')} />

      {/* ========== 右侧：项目详情 ========== */}
      <div style={{
        width: rightWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderLeft: '1px solid #e8e8e8',
      }}>
        {selectedProject ? (
          <>
            {/* 项目信息头部 */}
            <div style={{
              padding: '14px 16px 12px',
              borderBottom: '1px solid #f0f0f0',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text strong style={{ fontSize: 15 }}>{selectedProject.name}</Text>
                <Text style={{
                  fontSize: 10,
                  color: '#1677ff',
                  background: '#e6f4ff',
                  padding: '1px 7px',
                  borderRadius: 3,
                }}>
                  {projectConfig.projectType || '通用'}
                </Text>
              </div>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedProject.path}
              </Text>
            </div>

            {/* 主体内容 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>

              {/* AI 助手入口 — 大卡片 */}
              <div
                onClick={handleOpenProject}
                style={{
                  background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
                  borderRadius: 10,
                  padding: 16,
                  marginBottom: 14,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(22,119,255,0.3)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    flexShrink: 0,
                  }}>
                    <RobotOutlined style={{ color: '#fff' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, marginBottom: 2 }}>AI 文档助手</div>
                    <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 1.4 }}>
                      查数据 · 问规范 · 写文书 · 整照片
                    </div>
                  </div>
                  <div style={{
                    color: '#fff', fontSize: 11,
                    background: 'rgba(255,255,255,0.15)',
                    padding: '3px 10px',
                    borderRadius: 12,
                    whiteSpace: 'nowrap',
                  }}>
                    进入 →
                  </div>
                </div>
                <div style={{ position: 'absolute', right: -20, top: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', right: 40, bottom: -30, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
              </div>

              {/* 项目总览仪表盘 */}
              {selectedProject && (
                <DataBoard onSelectProject={handleSelectProject} selectedProjectPath={selectedProject.path} />
              )}

              {/* 参建单位配置 */}
              {editMode ? (
                <>
                  <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 10, color: '#888', letterSpacing: 1 }}>
                    编辑配置
                  </Text>
                  <Form form={configForm} layout="vertical" size="small">
                    <Form.Item name="ownerUnit" label="建设单位" style={{ marginBottom: 8 }}>
                      <Input placeholder="如：XX投资集团" style={{ fontSize: 12 }} />
                    </Form.Item>
                    <Form.Item name="contractor" label="施工单位" style={{ marginBottom: 8 }}>
                      <Input placeholder="如：XX建设集团" style={{ fontSize: 12 }} />
                    </Form.Item>
                    <Form.Item name="supervisorUnit" label="监理单位" style={{ marginBottom: 8 }}>
                      <Input placeholder="如：XX管理公司" style={{ fontSize: 12 }} />
                    </Form.Item>
                    <Form.Item name="chiefEngineer" label="总监理工程师" style={{ marginBottom: 8 }}>
                      <Input placeholder="如：张三" style={{ fontSize: 12 }} />
                    </Form.Item>
                    <Form.Item name="projectType" label="项目类型" style={{ marginBottom: 10 }}>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        options={[
                          { value: '通用', label: '通用' },
                          { value: '通信工程', label: '通信工程' },
                          { value: '信息化工程', label: '信息化工程' },
                          { value: '电力工程', label: '电力工程' },
                        ]}
                      />
                    </Form.Item>
                    <Space style={{ width: '100%' }}>
                      <Button type="primary" size="small" htmlType="button" onClick={handleSaveConfig} style={{ flex: 1 }}>
                        保存
                      </Button>
                      <Button size="small" onClick={() => setEditMode(false)}>
                        取消
                      </Button>
                    </Space>
                  </Form>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text strong style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>项目信息</Text>
                    <Space size={2}>
                      <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={() => window.electronAPI?.openPath(selectedProject.path)} title="打开文件夹" style={{ fontSize: 11 }} />
                      <Button type="text" size="small" icon={<FileSearchOutlined />} onClick={handleScanCompleteness} loading={scanning} title="资料检查" style={{ fontSize: 11 }} />
                      <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { configForm.setFieldsValue(projectConfig); setEditMode(true) }} style={{ fontSize: 11 }} />
                    </Space>
                  </div>
                  <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '12px 14px' }}>
                    {[
                      { label: '建设单位', value: projectConfig.ownerUnit },
                      { label: '施工单位', value: projectConfig.contractor },
                      { label: '监理单位', value: projectConfig.supervisorUnit },
                      { label: '总监理工程师', value: projectConfig.chiefEngineer },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>{item.label}</Text>
                        <Text style={{ fontWeight: 500, color: '#333', maxWidth: '60%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.value || '-'}
                        </Text>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 资料完整性检查结果 */}
              {completenessResult && (
                <CompletenessPanel result={completenessResult} onCreateDoc={handleCreateDoc} />
              )}

              {/* 台账记录 */}
              {selectedProject && (
                <LedgerPanel projectPath={selectedProject.path} projectName={selectedProject.name} />
              )}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
            <HomeOutlined style={{ fontSize: 36, marginBottom: 12, color: '#d9d9d9' }} />
            <div style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>项目详情</div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {projects.length > 0
                ? '从左侧选择一个项目查看详情'
                : '暂无项目，请先创建'}
            </Text>
          </div>
        )}
      </div>

      {/* ========== 新建项目弹窗 ========== */}
      <Modal
        title="新建项目"
        open={createModalOpen}
        onOk={handleCreateProject}
        onCancel={() => { setCreateModalOpen(false); setNewProjectName(''); setNewProjectType('通用') }}
        confirmLoading={creating}
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
    </div>
  )
}

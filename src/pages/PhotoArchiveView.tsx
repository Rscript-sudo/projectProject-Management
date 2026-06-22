/**
 * 照片归档页 — B8 模块
 * 功能：
 * 1. 按月归档浏览（侧栏月份）
 * 2. 拖拽上传（HTML5 拖放 API）
 * 3. 按部位打标签（自动建目录）
 * 4. 与隐患/进度节点联动
 * 5. 大图预览
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Space, Typography, Tag, App, Empty, Spin, Row, Col, Modal, Input,
  Select, DatePicker, Image, Upload, Tooltip,
} from 'antd'
import {
  ArrowLeftOutlined, CameraOutlined, InboxOutlined, FolderOutlined,
  EnvironmentOutlined, TagsOutlined, LinkOutlined, DeleteOutlined,
  EditOutlined, EyeOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography
const { Dragger } = Upload

export default function PhotoArchiveView() {
  const navigate = useNavigate()
  const { projectName: routeProjectName } = useParams()
  const { currentProject } = useAppStore()
  const { message, modal } = App.useApp()
  const apiReady = useElectronAPI()

  const projectName = currentProject?.name || decodeURIComponent(routeProjectName || '')
  const projectPath = currentProject?.path || ''

  const [photos, setPhotos] = useState<any[]>([])
  const [months, setMonths] = useState<{ month: string; count: number }[]>([])
  const [activeMonth, setActiveMonth] = useState<string | null>(null) // null = 全部
  const [activeLocation, setActiveLocation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [preview, setPreview] = useState<any>(null)

  useEffect(() => {
    if (!apiReady || !projectPath) return
    refresh()
  }, [apiReady, projectPath])

  useEffect(() => {
    if (!apiReady || !projectPath) return
    refreshPhotos()
  }, [activeMonth, activeLocation])

  const refresh = async () => {
    setLoading(true)
    try {
      const ms = await window.electronAPI.photoMonths({ projectPath })
      setMonths(ms)
      await refreshPhotos()
    } finally { setLoading(false) }
  }

  const refreshPhotos = async () => {
    try {
      const list = await window.electronAPI.photoList({
        projectPath,
        yearMonth: activeMonth || undefined,
        location: activeLocation || undefined,
        limit: 500,
      })
      setPhotos(list)
    } catch (e) {
      console.error(e)
    }
  }

  // 部位集合
  const locations = useMemo(() => {
    const set = new Set<string>()
    photos.forEach(p => { if (p.location) set.add(p.location) })
    return Array.from(set)
  }, [photos])

  // 拖拽上传（HTML5 DataTransfer）
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setUploading(true)
    let okCount = 0
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      // 取文件路径（Electron 才有 path 属性）
      const filePath = (file as any).path
      if (!filePath) {
        message.warning(`${file.name} 无法读取本地路径，请用"选择文件"按钮`)
        continue
      }
      try {
        const res = await window.electronAPI.photoArchive({
          projectPath,
          srcPath: filePath,
          shootDate: dayjs(file.lastModified || Date.now()).format('YYYY-MM-DD'),
          location: activeLocation || '未分类',
        })
        if (res.success) okCount++
      } catch (e) {
        console.error(e)
      }
    }
    setUploading(false)
    if (okCount) message.success(`已归档 ${okCount} 张照片`)
    refresh()
  }

  // 选择文件上传
  const handleUploadClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*'
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      setUploading(true)
      let okCount = 0
      for (const file of files) {
        const filePath = (file as any).path
        if (!filePath) continue
        try {
          await window.electronAPI.photoArchive({
            projectPath,
            srcPath: filePath,
            shootDate: dayjs(file.lastModified || Date.now()).format('YYYY-MM-DD'),
            location: activeLocation || '未分类',
          })
          okCount++
        } catch (e) { console.error(e) }
      }
      setUploading(false)
      if (okCount) message.success(`已归档 ${okCount} 张照片`)
      refresh()
    }
    input.click()
  }

  const handleEdit = (photo: any) => {
    setEditing(photo)
    setEditForm({
      location: photo.location || '',
      tags: photo.tags || '',
      description: photo.description || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    const res = await window.electronAPI.photoUpdate({
      id: editing.id,
      updates: editForm,
    })
    if (res.success) {
      message.success('已更新')
      setEditing(null)
      refresh()
    } else {
      message.error(res.error || '更新失败')
    }
  }

  const handleDelete = (photo: any) => {
    modal.confirm({
      title: '删除照片？',
      content: `文件"${photo.file_name}"将从归档目录和数据库中删除。`,
      okType: 'danger',
      onOk: async () => {
        await window.electronAPI.photoDelete({ id: photo.id })
        message.success('已删除')
        refresh()
      },
    })
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* 顶部 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            <CameraOutlined /> 照片归档 · {projectName}
          </Title>
        </Space>
        <Space>
          <Button type="primary" icon={<InboxOutlined />} onClick={handleUploadClick} loading={uploading}>
            上传照片
          </Button>
        </Space>
      </div>

      <Row gutter={16}>
        {/* 左侧：月份 + 部位 筛选 */}
        <Col span={5}>
          <Card size="small" title="📅 按月归档" style={{ marginBottom: 12 }}>
            <div
              onClick={() => setActiveMonth(null)}
              style={{
                padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
                background: activeMonth === null ? '#e6f4ff' : 'transparent',
                marginBottom: 4, fontSize: 13,
              }}
            >
              <FolderOutlined /> 全部（{months.reduce((s: number, m: any) => s + m.count, 0)}）
            </div>
            {months.map((m: any) => (
              <div
                key={m.month}
                onClick={() => setActiveMonth(m.month)}
                style={{
                  padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
                  background: activeMonth === m.month ? '#e6f4ff' : 'transparent',
                  marginBottom: 4, fontSize: 13,
                  display: 'flex', justifyContent: 'space-between',
                }}
              >
                <span><FolderOutlined /> {m.month}</span>
                <Tag style={{ fontSize: 10, margin: 0 }}>{m.count}</Tag>
              </div>
            ))}
          </Card>

          {locations.length > 0 && (
            <Card size="small" title={<><EnvironmentOutlined /> 部位</>}>
              <div
                onClick={() => setActiveLocation(null)}
                style={{
                  padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
                  background: activeLocation === null ? '#e6f4ff' : 'transparent',
                  marginBottom: 4, fontSize: 12,
                }}
              >
                全部部位
              </div>
              {locations.map((loc: string) => (
                <div
                  key={loc}
                  onClick={() => setActiveLocation(loc)}
                  style={{
                    padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
                    background: activeLocation === loc ? '#e6f4ff' : 'transparent',
                    marginBottom: 2, fontSize: 12,
                  }}
                >
                  📍 {loc}
                </div>
              ))}
            </Card>
          )}
        </Col>

        {/* 右侧：照片网格 + 拖拽区 */}
        <Col span={19}>
          <Card size="small" title={
            <Space>
              <CameraOutlined />
              <span>{activeMonth || '全部'} · {activeLocation || '全部部位'} · {photos.length} 张</span>
            </Space>
          }>
            {/* 拖拽上传区 */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: '2px dashed #d9d9d9', borderRadius: 6, padding: '16px',
                textAlign: 'center', marginBottom: 16, background: uploading ? '#fafafa' : 'transparent',
                color: '#999', fontSize: 12,
              }}
            >
              {uploading ? <Spin /> : (
                <>
                  <InboxOutlined style={{ fontSize: 24, marginBottom: 4 }} />
                  <div>把照片拖到这里自动归档到 <strong>{activeMonth || '当月'}/{activeLocation || '未分类'}</strong></div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>或点右上角"上传照片"按钮选择文件</div>
                </>
              )}
            </div>

            {/* 照片网格 */}
            {loading ? <Spin /> : photos.length === 0 ? (
              <Empty description="暂无照片" />
            ) : (
              <Row gutter={[12, 12]}>
                {photos.map((p: any) => (
                  <Col span={6} key={p.id}>
                    <Card
                      size="small"
                      hoverable
                      bodyStyle={{ padding: 8 }}
                      cover={
                        <div
                          style={{ height: 140, overflow: 'hidden', background: '#fafafa', cursor: 'pointer' }}
                          onClick={() => setPreview(p)}
                        >
                          <img
                            src={`file://${p.file_path}`}
                            alt={p.file_name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        </div>
                      }
                      actions={[
                        <Tooltip title="编辑元数据" key="edit">
                          <EditOutlined onClick={() => handleEdit(p)} />
                        </Tooltip>,
                        <Tooltip title="大图预览" key="view">
                          <EyeOutlined onClick={() => setPreview(p)} />
                        </Tooltip>,
                        <Tooltip title="删除" key="del">
                          <DeleteOutlined onClick={() => handleDelete(p)} />
                        </Tooltip>,
                      ]}
                    >
                      <Card.Meta
                        title={
                          <Text style={{ fontSize: 11 }} ellipsis>
                            {p.location || '未分类'}
                          </Text>
                        }
                        description={
                          <div style={{ fontSize: 10, color: '#888' }}>
                            <div>{p.shoot_date}</div>
                            {p.tags && <div><TagsOutlined /> {p.tags}</div>}
                            {p.linked_hazard_id && (
                              <Tag color="red" style={{ fontSize: 10, margin: '2px 0 0 0' }}>
                                <LinkOutlined /> 隐患#{p.linked_hazard_id}
                              </Tag>
                            )}
                          </div>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>
      </Row>

      {/* 编辑弹窗 */}
      <Modal open={!!editing} title="编辑照片元数据" onCancel={() => setEditing(null)} onOk={handleSaveEdit} okText="保存" width={480}>
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>部位（用于自动建目录）</Text>
            <Input value={editForm.location || ''} onChange={e => setEditForm({ ...editForm, location: e.target.value })}
              placeholder="例：基坑北侧、3#楼三层" />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>标签（逗号分隔）</Text>
            <Input value={editForm.tags || ''} onChange={e => setEditForm({ ...editForm, tags: e.target.value })}
              placeholder="例：临边,隐患,整改前" />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>描述</Text>
            <Input.TextArea value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })}
              rows={3} />
          </div>
        </Space>
      </Modal>

      {/* 大图预览 */}
      <Modal open={!!preview} footer={null} onCancel={() => setPreview(null)} width="80%">
        {preview && (
          <div>
            <img src={`file://${preview.file_path}`} alt={preview.file_name} style={{ width: '100%' }} />
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div><strong>部位：</strong>{preview.location || '-'}</div>
              <div><strong>拍摄日期：</strong>{preview.shoot_date}</div>
              <div><strong>标签：</strong>{preview.tags || '-'}</div>
              <div><strong>描述：</strong>{preview.description || '-'}</div>
              <div><strong>路径：</strong>{preview.file_path}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
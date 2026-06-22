/**
 * 现场巡视页 — 5 大维度检查清单
 * 复用虚竹 SKILL 中的"五大维度"：临电 / 高空 / 临边洞口 / 动火 / 消防
 * 巡视结果一键保存到"问题清单"目录，并联动写入"隐患台账"
 */

import { useState, useEffect, useMemo } from 'react'
import { Button, Card, Checkbox, Input, Select, Space, Typography, Tag, App, Empty, Spin, Modal, List } from 'antd'
import { EnvironmentOutlined, ExclamationCircleOutlined, CheckCircleOutlined, FileTextOutlined, SaveOutlined, RobotOutlined, HistoryOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography
const { TextArea } = Input

// 5 维度检查项（与后端 inspection.mjs CHECK_ITEMS 同步）
const CHECK_ITEMS: Record<string, { id: string; label: string }[]> = {
  electrical: [
    { id: 'e1', label: '临时配电箱漏电保护器有效' },
    { id: 'e2', label: '配电箱接线规范无裸露' },
    { id: 'e3', label: '用电设备PE保护接地可靠' },
    { id: 'e4', label: '临时电缆架空或埋地防护到位' },
  ],
  height: [
    { id: 'h1', label: '高处作业人员安全带佩戴' },
    { id: 'h2', label: '作业平台稳固性' },
    { id: 'h3', label: '安全网/防坠网设置' },
    { id: 'h4', label: '作业下方警戒区设置' },
  ],
  edge: [
    { id: 'g1', label: '临边防护栏设置' },
    { id: 'g2', label: '洞口盖板/防护设置' },
    { id: 'g3', label: '夜间警示灯设置' },
  ],
  hotwork: [
    { id: 'w1', label: '动火作业审批手续' },
    { id: 'w2', label: '现场消防器材配备' },
    { id: 'w3', label: '动火作业看火人到位' },
  ],
  fire: [
    { id: 'f1', label: '材料堆放区灭火器配备' },
    { id: 'f2', label: '消防通道畅通' },
    { id: 'f3', label: '易燃物单独存放' },
  ],
}

const DIMENSIONS = [
  { key: 'electrical', name: '临电安全', icon: '⚡', color: '#faad14' },
  { key: 'height', name: '高空安全', icon: '⛰️', color: '#eb2f96' },
  { key: 'edge', name: '临边洞口', icon: '⚠️', color: '#fa541c' },
  { key: 'hotwork', name: '动火安全', icon: '🔥', color: '#f5222d' },
  { key: 'fire', name: '消防安全', icon: '🧯', color: '#722ed1' },
]

export default function InspectionView() {
  const navigate = useNavigate()
  const { projectName } = useParams()
  const { currentProject, setCurrentProject } = useAppStore()
  const { message, modal } = App.useApp()
  const apiReady = useElectronAPI()

  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [location, setLocation] = useState('')
  const [inspector, setInspector] = useState('')
  // issues 数组：每个 element { dimKey, dimensionName, itemId, label, found, location, description, severity }
  const [issues, setIssues] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // 同步 currentProject（从 URL 进来时）
  useEffect(() => {
    if (!currentProject && projectName) {
      // 简单兜底：让用户回到 Home 选
    } else if (currentProject && projectName && decodeURIComponent(projectName) !== currentProject.name) {
      // 路由变了但 store 没变，不处理
    }
  }, [projectName, currentProject])

  // 加载历史
  const loadHistory = async () => {
    if (!currentProject || !window.electronAPI) return
    setLoadingHistory(true)
    try {
      const records = await window.electronAPI.inspectionList({ projectPath: currentProject.path })
      setHistory(records || [])
    } catch (e) {
      console.error('Load history failed:', e)
    }
    setLoadingHistory(false)
  }

  useEffect(() => {
    if (apiReady && currentProject) loadHistory()
  }, [apiReady, currentProject])

  // 切换某项"发现问题"
  const toggleIssue = (dimKey: any, dimensionName: any, itemId: any, label: any, checked: any) => {
    setIssues((prev: any[]) => {
      const idx = prev.findIndex(i => i.dimKey === dimKey && i.itemId === itemId)
      if (checked && idx === -1) {
        return [...prev, {
          dimKey,
          dimensionName,
          itemId,
          label,
          found: true,
          location: location || '',
          description: '',
          severity: '一般',
        }]
      }
      if (!checked && idx > -1) {
        return prev.filter((_, i) => i !== idx)
      }
      return prev
    })
  }

  const updateIssueField = (idx: any, field: any, value: any) => {
    setIssues((prev: any[]) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  // 全部问题的快速检查
  const issueMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const i of issues) m[`${i.dimKey}:${i.itemId}`] = true
    return m
  }, [issues])

  const totalChecks = Object.values(CHECK_ITEMS).reduce((s, arr) => s + arr.length, 0)
  const foundCount = issues.length

  // 保存巡视记录
  const handleSave = async () => {
    if (!currentProject) {
      message.error('请先选择项目')
      return
    }
    if (!location.trim()) {
      message.warning('请填写巡视部位')
      return
    }
    setSaving(true)
    try {
      const record = {
        date,
        location,
        inspector: inspector || '监理员',
        totalChecks,
        foundCount,
        issues: issues.map(i => ({ ...i, location: location })),
        savedAt: new Date().toISOString(),
      }
      const result = await window.electronAPI.inspectionSave({
        projectPath: currentProject.path,
        record,
      })
      if (result.success) {
        message.success(`巡视记录已保存，发现 ${result.hazardCount} 项隐患已写入台账`)
        setIssues([])
        loadHistory()
      } else {
        message.error('保存失败：' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
    setSaving(false)
  }

  // 一键生成整改通知（调用现有 AI 能力）
  const handleGenerateRectification = (issue: any) => {
    const subject = `${issue.dimensionName}：${issue.label}（${location || '现场'}）`
    const prompt = `生成一份整改通知书，关于：${subject}。问题描述：${issue.description || issue.label}`
    // 跳到 ProjectView 并预填输入
    navigate(`/project/${encodeURIComponent(currentProject!.name)}?docType=整改通知书&input=${encodeURIComponent(prompt)}`)
  }

  if (!currentProject) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary">请先在控制台选择一个项目</Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/')}>返回控制台</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#f5f5f5' }}>
      {/* 顶部 */}
      <div style={{
        background: '#fff',
        padding: '12px 20px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}>
        <Space>
          <Button onClick={() => navigate(`/project/${encodeURIComponent(currentProject.name)}`)}>返回</Button>
          <Title level={5} style={{ margin: 0 }}>现场巡视 · {currentProject.name}</Title>
        </Space>
        <Space>
          <Button icon={<HistoryOutlined />} onClick={() => setShowHistory(true)}>
            历史 ({history.length})
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            disabled={issues.length === 0}
          >
            保存巡视记录（{foundCount} 项问题）
          </Button>
        </Space>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
        {/* 基本信息 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size={16} wrap>
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>巡视日期</Text>
              <Input
                type="date"
                size="small"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{ width: 140 }}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>巡视部位</Text>
              <Input
                size="small"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="如：3号楼机房、屋面"
                style={{ width: 200 }}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>巡视人</Text>
              <Input
                size="small"
                value={inspector}
                onChange={e => setInspector(e.target.value)}
                placeholder="姓名"
                style={{ width: 120 }}
              />
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Tag color={foundCount === 0 ? 'green' : foundCount < 3 ? 'orange' : 'red'}>
                本次发现 {foundCount} / {totalChecks} 项
              </Tag>
            </div>
          </Space>
        </Card>

        {/* 5 维度检查 */}
        {DIMENSIONS.map(dim => (
          <Card
            key={dim.key}
            size="small"
            title={
              <Space>
                <span style={{ fontSize: 16 }}>{dim.icon}</span>
                <Text strong>{dim.name}</Text>
                <Tag color="blue" style={{ marginLeft: 4 }}>
                  {CHECK_ITEMS[dim.key].filter(c => issueMap[`${dim.key}:${c.id}`]).length} / {CHECK_ITEMS[dim.key].length}
                </Tag>
              </Space>
            }
            style={{ marginBottom: 12 }}
            styles={{ body: { padding: '8px 12px' } }}
          >
            {CHECK_ITEMS[dim.key].map(item => {
              const checked = !!issueMap[`${dim.key}:${item.id}`]
              const issueIdx = issues.findIndex(i => i.dimKey === dim.key && i.itemId === item.id)
              return (
                <div key={item.id} style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                  <Checkbox
                    checked={checked}
                    onChange={e => toggleIssue(dim.key, dim.name, item.id, item.label, e.target.checked)}
                  >
                    <span style={{ fontSize: 13 }}>{item.label}</span>
                  </Checkbox>
                  {checked && issueIdx > -1 && (
                    <div style={{ marginLeft: 24, marginTop: 6, padding: '8px 10px', background: '#fffbe6', borderRadius: 4, border: '1px solid #ffe58f' }}>
                      <Space wrap size={8}>
                        <Input
                          size="small"
                          placeholder="问题描述（可空，使用默认）"
                          value={issues[issueIdx].description}
                          onChange={e => updateIssueField(issueIdx, 'description', e.target.value)}
                          style={{ width: 280 }}
                        />
                        <Select
                          size="small"
                          value={issues[issueIdx].severity}
                          onChange={v => updateIssueField(issueIdx, 'severity', v)}
                          style={{ width: 90 }}
                          options={[
                            { value: '一般', label: '一般' },
                            { value: '较重', label: '较重' },
                            { value: '严重', label: '严重' },
                          ]}
                        />
                        <Button
                          size="small"
                          type="link"
                          icon={<RobotOutlined />}
                          onClick={() => handleGenerateRectification(issues[issueIdx])}
                        >
                          生成整改通知
                        </Button>
                      </Space>
                    </div>
                  )}
                </div>
              )
            })}
          </Card>
        ))}
      </div>

      {/* 历史记录抽屉 */}
      <Modal
        title={`历史巡视记录 (${history.length})`}
        open={showHistory}
        onCancel={() => setShowHistory(false)}
        footer={null}
        width={600}
      >
        {loadingHistory ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : history.length === 0 ? (
          <Empty description="暂无历史巡视记录" />
        ) : (
          <List
            dataSource={history}
            renderItem={r => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{r.date}</Text>
                      <EnvironmentOutlined style={{ color: '#1677ff' }} />
                      <Text>{r.location}</Text>
                    </Space>
                  }
                  description={
                    <Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        巡视人：{r.inspector || '监理员'}
                      </Text>
                      <Tag color={r.foundCount > 0 ? 'orange' : 'green'}>
                        发现 {r.foundCount} 项
                      </Tag>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  )
}
/**
 * 进度控制页 — B4 模块
 * 功能：
 * 1. 计划台账（节点增删改查）
 * 2. 横道图（手写 SVG 渲染）
 * 3. 月度计划 vs 实际对比
 * 4. 偏差分析（总进度/准时率/超期节点）
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Space, Typography, Tag, App, Empty, Spin, Table, Modal, Input,
  InputNumber, DatePicker, Select, Tabs, Statistic, Row, Col, Progress, Alert,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, BarChartOutlined,
  CheckCircleOutlined, ClockCircleOutlined, WarningOutlined, ArrowLeftOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography

// 进度状态颜色
const STATUS_COLOR = {
  '未开始': 'default',
  '进行中': 'processing',
  '已完成': 'success',
  '超期': 'error',
}

export default function ProgressView() {
  const navigate = useNavigate()
  const { projectName: routeProjectName } = useParams()
  const { currentProject } = useAppStore()
  const { message, modal } = App.useApp()
  const apiReady = useElectronAPI()

  const projectName = currentProject?.name || decodeURIComponent(routeProjectName || '')
  const projectPath = currentProject?.path || ''

  const [nodes, setNodes] = useState<any[]>([])
  const [gantt, setGantt] = useState<any>(null)
  const [deviation, setDeviation] = useState<any>(null)
  const [monthly, setMonthly] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('gantt')
  const [yearMonth, setYearMonth] = useState(dayjs().format('YYYY-MM'))

  // 编辑弹窗
  const [editing, setEditing] = useState<any>(null) // null | 'new' | node
  const [editForm, setEditForm] = useState<any>({
    name: '', plan_start: '', plan_end: '', actual_start: '', actual_end: '',
    progress_percent: 0, weight: 1,
  })

  useEffect(() => {
    if (!apiReady || !projectPath) return
    refresh()
  }, [apiReady, projectPath])

  useEffect(() => {
    if (!apiReady || !projectPath) return
    window.electronAPI.progressMonthlyCompare({ projectPath, yearMonth })
      .then(setMonthly).catch(console.error)
  }, [apiReady, projectPath, yearMonth, nodes])

  const refresh = async () => {
    setLoading(true)
    try {
      const [list, g, d] = await Promise.all([
        window.electronAPI.progressList(projectPath),
        window.electronAPI.progressGantt({ projectPath }),
        window.electronAPI.progressDeviation(projectPath),
      ])
      setNodes(list)
      setGantt(g)
      setDeviation(d)
    } catch (e: any) {
      message.error('加载失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditing('new')
    setEditForm({
      name: '', plan_start: yearMonth + '-01', plan_end: yearMonth + '-15',
      actual_start: '', actual_end: '', progress_percent: 0, weight: 1,
    })
  }

  const handleEdit = (node: any) => {
    setEditing(node)
    setEditForm({
      name: node.name, plan_start: node.plan_start || '', plan_end: node.plan_end || '',
      actual_start: node.actual_start || '', actual_end: node.actual_end || '',
      progress_percent: node.progress_percent || 0, weight: node.weight || 1,
    })
  }

  const handleSave = async () => {
    if (!editForm.name) {
      message.warning('请输入节点名称')
      return
    }
    try {
      if (editing === 'new') {
        await window.electronAPI.progressAdd({ projectPath, node: editForm })
        message.success('已新增节点')
      } else {
        await window.electronAPI.progressUpdate({ id: editing.id, updates: editForm })
        message.success('已更新')
      }
      setEditing(null)
      refresh()
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
  }

  const handleDelete = (node: any) => {
    modal.confirm({
      title: '删除节点？',
      content: `节点"${node.name}"将被删除，相关横道图也会移除。`,
      okType: 'danger',
      onOk: async () => {
        await window.electronAPI.progressDelete({ id: node.id })
        message.success('已删除')
        refresh()
      },
    })
  }

  // 计划台账列定义
  const columns = [
    { title: '节点', dataIndex: 'name', key: 'name', width: 160 },
    {
      title: '计划工期', key: 'plan', width: 180,
      render: (_: any, n: any) => (
        <Text style={{ fontSize: 11 }}>
          {n.plan_start || '-'} ~ {n.plan_end || '-'}
        </Text>
      ),
    },
    {
      title: '实际工期', key: 'actual', width: 180,
      render: (_: any, n: any) => (
        <Text style={{ fontSize: 11, color: n.actual_start ? '#333' : '#999' }}>
          {n.actual_start || '未开始'} ~ {n.actual_end || '-'}
        </Text>
      ),
    },
    {
      title: '进度', dataIndex: 'progress_percent', width: 130,
      render: (v: any) => <Progress percent={v || 0} size="small" />,
    },
    {
      title: '偏差(天)', key: 'variance', width: 80,
      render: (_: any, n: any) => {
        const v = n.schedule_variance_days
        if (v === undefined || v === null) return '-'
        return v > 0 ? <Tag color="red">+{v}</Tag>
          : v < 0 ? <Tag color="green">{v}</Tag>
          : <Tag color="blue">0</Tag>
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: any) => <Tag color={STATUS_COLOR[v as keyof typeof STATUS_COLOR] || 'default'}>{v}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 110,
      render: (_: any, n: any) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEdit(n)} style={{ padding: '0 4px' }} />
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(n)} style={{ padding: '0 4px' }} />
        </Space>
      ),
    },
  ]

  // 横道图 SVG 渲染
  const renderGantt = () => {
    if (!gantt || !gantt.nodes?.length) {
      return <Empty description="暂无节点，请先在「计划台账」新增" />
    }
    const ROW_H = 32
    const LEFT_W = 160
    const headerH = 30
    const totalWidth = LEFT_W + gantt.totalDays * gantt.dayPx + 20
    const totalHeight = headerH + gantt.nodes.length * ROW_H + 10

    // 生成月份分隔线
    const monthMarkers = []
    if (gantt.minDate) {
      const start = dayjs(gantt.minDate)
      const end = dayjs(gantt.maxDate)
      let m = start.startOf('month')
      while (m.isBefore(end) || m.isSame(end, 'month')) {
        const days = m.diff(start, 'day')
        const x = LEFT_W + days * gantt.dayPx
        monthMarkers.push({ x, label: m.format('YYYY-MM') })
        m = m.add(1, 'month')
      }
    }

    // 生成日刻度（每月第1日）
    const dayMarkers = []
    if (gantt.minDate) {
      const start = dayjs(gantt.minDate)
      const totalDays = gantt.totalDays
      for (let i = 0; i <= totalDays; i++) {
        const d = start.add(i, 'day')
        if (d.date() === 1 || i === 0 || i === totalDays) {
          dayMarkers.push({
            x: LEFT_W + i * gantt.dayPx,
            label: d.format('MM-DD'),
          })
        }
      }
    }

    return (
      <div style={{ overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4 }}>
        <svg width={totalWidth} height={totalHeight} style={{ display: 'block' }}>
          {/* 月份分隔线（淡背景）*/}
          {monthMarkers.map((m: any, i: number) => (
            <g key={'m' + i}>
              <line x1={m.x} y1={0} x2={m.x} y2={totalHeight} stroke="#d9d9d9" strokeWidth={1} strokeDasharray="2,2" />
              <text x={m.x + 4} y={headerH - 8} fontSize={10} fill="#888">{m.label}</text>
            </g>
          ))}
          {/* 日刻度 */}
          {dayMarkers.map((d: any, i: number) => (
            <text key={'d' + i} x={d.x + 2} y={14} fontSize={9} fill="#bbb">{d.label}</text>
          ))}
          {/* 表头横线 */}
          <line x1={0} y1={headerH} x2={totalWidth} y2={headerH} stroke="#f0f0f0" />
          {/* 节点行 */}
          {gantt.nodes.map((n: any, idx: number) => {
            const y = headerH + idx * ROW_H + 4
            const rowMid = y + ROW_H / 2 - 4
            return (
              <g key={n.id}>
                {/* 节点名称 */}
                <text x={8} y={rowMid + 4} fontSize={12} fill="#333">{n.name}</text>
                {/* 计划条（灰底）*/}
                {n.x !== undefined && (
                  <rect
                    x={LEFT_W + n.x} y={y} width={n.width} height={ROW_H - 12}
                    fill="#f0f0f0" stroke="#d9d9d9" rx={2}
                  />
                )}
                {/* 实际条（蓝色填充）*/}
                {n.actualX !== undefined && (
                  <rect
                    x={LEFT_W + n.actualX} y={y + 3} width={n.actualWidth} height={ROW_H - 18}
                    fill="#1677ff" opacity={0.3} rx={2}
                  />
                )}
                {/* 进度条（已完成部分）*/}
                {n.progressWidth > 0 && (
                  <rect
                    x={LEFT_W + n.actualX} y={y + 3} width={n.progressWidth} height={ROW_H - 18}
                    fill="#1677ff" rx={2}
                  />
                )}
                {/* 行底线 */}
                <line x1={0} y1={y + ROW_H - 8} x2={totalWidth} y2={y + ROW_H - 8} stroke="#fafafa" />
              </g>
            )
          })}
        </svg>
        <div style={{ padding: '4px 12px', fontSize: 11, color: '#999', borderTop: '1px solid #f0f0f0' }}>
          <Space>
            <span><span style={{ display: 'inline-block', width: 14, height: 8, background: '#f0f0f0', border: '1px solid #d9d9d9', marginRight: 4 }} />计划</span>
            <span><span style={{ display: 'inline-block', width: 14, height: 8, background: '#1677ff', opacity: 0.3, marginRight: 4 }} />实际</span>
            <span><span style={{ display: 'inline-block', width: 14, height: 8, background: '#1677ff', marginRight: 4 }} />已完成</span>
          </Space>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      {/* 顶部 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            <BarChartOutlined /> 进度控制 · {projectName}
          </Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增节点
        </Button>
      </div>

      {/* 偏差概览 */}
      {deviation && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="节点总数" value={deviation.totalNodes} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: 20 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="已完成" value={deviation.completed} prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} valueStyle={{ fontSize: 20, color: '#52c41a' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="进行中" value={deviation.inProgress} valueStyle={{ fontSize: 20, color: '#1677ff' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="超期" value={deviation.overdue} prefix={<WarningOutlined style={{ color: '#ff4d4f' }} />} valueStyle={{ fontSize: 20, color: '#ff4d4f' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="加权进度" value={deviation.weightedProgress} suffix="%" valueStyle={{ fontSize: 20 }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="准时率"
                value={deviation.onTimeRate === null ? '-' : deviation.onTimeRate}
                suffix={deviation.onTimeRate === null ? '' : '%'}
                valueStyle={{ fontSize: 20, color: deviation.onTimeRate >= 80 ? '#52c41a' : '#faad14' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {deviation?.overdue > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${deviation.overdue} 个节点已超期，请关注进度偏差并采取纠偏措施`}
        />
      )}

      {/* 标签页 */}
      <Card size="small">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'gantt',
              label: '横道图',
              children: loading ? <Spin /> : renderGantt(),
            },
            {
              key: 'ledger',
              label: `计划台账（${nodes.length}）`,
              children: (
                <Table
                  size="small"
                  dataSource={nodes}
                  columns={columns}
                  rowKey="id"
                  pagination={false}
                  style={{ fontSize: 12 }}
                />
              ),
            },
            {
              key: 'monthly',
              label: '月度对比',
              children: (
                <div>
                  <Space style={{ marginBottom: 12 }}>
                    <Text type="secondary">选择月份：</Text>
                    <DatePicker
                      picker="month"
                      value={dayjs(yearMonth)}
                      onChange={(d) => d && setYearMonth(d.format('YYYY-MM'))}
                      format="YYYY-MM"
                      allowClear={false}
                    />
                  </Space>
                  {monthly && (
                    <Row gutter={12}>
                      <Col span={8}>
                        <Card size="small" title={`📅 本月计划节点（${monthly.plannedCount}）`}>
                          {monthly.plannedNodes.length
                            ? monthly.plannedNodes.map((n: string, i: number) => <Tag key={i} style={{ marginBottom: 4 }}>{n}</Tag>)
                            : <Text type="secondary">无</Text>}
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" title={`✅ 本月实际完成（${monthly.doneCount}）`}>
                          {monthly.doneNodes.length
                            ? monthly.doneNodes.map((n: string, i: number) => <Tag key={i} color="green" style={{ marginBottom: 4 }}>{n}</Tag>)
                            : <Text type="secondary">无</Text>}
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small" title={`⚠️ 超期未完成（${monthly.overdueNodes.length}）`}>
                          {monthly.overdueNodes.length
                            ? monthly.overdueNodes.map((n: string, i: number) => <Tag key={i} color="red" style={{ marginBottom: 4 }}>{n}</Tag>)
                            : <Text type="secondary">无超期</Text>}
                        </Card>
                      </Col>
                    </Row>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        open={!!editing}
        title={editing === 'new' ? '新增进度节点' : '编辑节点'}
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        okText="保存"
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>节点名称 *</Text>
            <Input
              value={editForm.name}
              onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="例：基础土方开挖"
            />
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>计划开始</Text>
              <DatePicker
                value={editForm.plan_start ? dayjs(editForm.plan_start) : null}
                onChange={d => setEditForm({ ...editForm, plan_start: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>计划结束</Text>
              <DatePicker
                value={editForm.plan_end ? dayjs(editForm.plan_end) : null}
                onChange={d => setEditForm({ ...editForm, plan_end: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>实际开始</Text>
              <DatePicker
                value={editForm.actual_start ? dayjs(editForm.actual_start) : null}
                onChange={d => setEditForm({ ...editForm, actual_start: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>实际结束</Text>
              <DatePicker
                value={editForm.actual_end ? dayjs(editForm.actual_end) : null}
                onChange={d => setEditForm({ ...editForm, actual_end: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>完成进度（%）</Text>
              <InputNumber
                value={editForm.progress_percent}
                onChange={v => setEditForm({ ...editForm, progress_percent: v || 0 })}
                min={0} max={100} style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>权重</Text>
              <InputNumber
                value={editForm.weight}
                onChange={v => setEditForm({ ...editForm, weight: v || 1 })}
                min={0.1} step={0.1} style={{ width: '100%' }}
              />
            </Col>
          </Row>
        </Space>
      </Modal>
    </div>
  )
}
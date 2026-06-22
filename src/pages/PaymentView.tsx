/**
 * 投资控制页 — B5 模块
 * 功能：
 * 1. 付款申请台账（CRUD）
 * 2. 5 级审批流（监理员→专业监理→总监→业主→已完成）
 * 3. 工程计量（本月完成工程量录入）
 * 4. 累计金额统计（已批/在审/已驳回/合同占比）
 */

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Space, Typography, Tag, App, Empty, Spin, Table, Modal, Input,
  InputNumber, Select, Row, Col, Statistic, Progress, Alert, Steps, Timeline,
} from 'antd'
import {
  PlusOutlined, ArrowLeftOutlined, DollarOutlined, CheckCircleOutlined,
  ClockCircleOutlined, CloseCircleOutlined, HistoryOutlined, RightCircleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography
const { TextArea } = Input

const STATUS_COLOR = {
  '审批中': 'processing',
  '已通过': 'cyan',
  '已支付': 'success',
  '已驳回': 'error',
}

export default function PaymentView() {
  const navigate = useNavigate()
  const { projectName: routeProjectName } = useParams()
  const { currentProject } = useAppStore()
  const { message, modal } = App.useApp()
  const apiReady = useElectronAPI()

  const projectName = currentProject?.name || decodeURIComponent(routeProjectName || '')
  const projectPath = currentProject?.path || ''

  const [payments, setPayments] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [historyOf, setHistoryOf] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({
    period: '', amount: 0, amount_upper: '', description: '',
    related_nodes: [], status: '审批中',
  })

  useEffect(() => {
    if (!apiReady || !projectPath) return
    refresh()
  }, [apiReady, projectPath])

  const refresh = async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        window.electronAPI.paymentList(projectPath),
        window.electronAPI.paymentSummary(projectPath),
      ])
      setPayments(list)
      setSummary(sum)
    } catch (e: any) {
      message.error('加载失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditing('new')
    const now = new Date()
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    setEditForm({ period, amount: 0, amount_upper: '', description: '', related_nodes: [], status: '审批中' })
  }

  const handleSave = async () => {
    if (!editForm.period || !editForm.amount) {
      message.warning('请填写期次和金额')
      return
    }
    try {
      await window.electronAPI.paymentAdd({ projectPath, payment: editForm })
      message.success('已新增付款申请')
      setEditing(null)
      refresh()
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
  }

  const handleAdvance = (record: any) => {
    let person = ''
    let opinion = ''
    modal.confirm({
      title: `推进至下一审批阶段`,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>当前阶段：<Tag color="blue">{record.approval_stage}</Tag></div>
          <Input placeholder="审批人" id="adv-person" onChange={e => person = e.target.value} style={{ marginBottom: 8 }} />
          <TextArea placeholder="审批意见（可选）" id="adv-opinion" onChange={e => opinion = e.target.value} rows={2} />
        </div>
      ),
      onOk: async () => {
        const result = await window.electronAPI.paymentAdvance({
          id: record.id, person, opinion,
        })
        if (result.success) {
          message.success(`已推进至「${result.nextStage}」`)
          refresh()
        } else {
          message.error(result.error || '推进失败')
        }
      },
    })
  }

  const handleReject = (record: any) => {
    let person = ''
    let opinion = ''
    modal.confirm({
      title: '驳回该申请',
      okType: 'danger',
      okText: '确认驳回',
      content: (
        <div>
          <Input placeholder="驳回人" id="rej-person" onChange={e => person = e.target.value} style={{ marginBottom: 8 }} />
          <TextArea placeholder="驳回理由" id="rej-opinion" onChange={e => opinion = e.target.value} rows={2} />
        </div>
      ),
      onOk: async () => {
        if (!opinion) {
          message.warning('请填写驳回理由')
          return Promise.reject()
        }
        const result = await window.electronAPI.paymentReject({ id: record.id, person, opinion })
        if (result.success) {
          message.success('已驳回')
          refresh()
        }
      },
    })
  }

  const handleViewHistory = (record: any) => {
    setHistoryOf(record)
  }

  const columns = [
    { title: '期次', dataIndex: 'period', key: 'period', width: 90 },
    {
      title: '本期金额', dataIndex: 'amount', key: 'amount', width: 130,
      render: (v: any) => <Text strong style={{ color: '#1677ff' }}>{v ? `¥ ${v.toLocaleString()}` : '-'}</Text>,
    },
    { title: '大写', dataIndex: 'amount_upper', key: 'amount_upper', width: 140, ellipsis: true },
    {
      title: '累计金额', dataIndex: 'cumulative_amount', key: 'cumulative_amount', width: 130,
      render: (v: any) => <Text>¥ {v?.toLocaleString() || 0}</Text>,
    },
    {
      title: '累计占比', dataIndex: 'cumulative_percent', key: 'cumulative_percent', width: 90,
      render: (v: any) => v ? <Tag color="blue">{v}%</Tag> : '-',
    },
    { title: '工程内容', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '当前阶段', dataIndex: 'approval_stage', key: 'approval_stage', width: 130,
      render: (v: any) => <Tag color="processing">{v}</Tag>,
    },
    {
      title: '审批进度', key: 'progress', width: 100,
      render: (_: any, r: any) => <Progress percent={r.approval_progress} size="small" />,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: any) => <Tag color={STATUS_COLOR[v as keyof typeof STATUS_COLOR] || 'default'}>{v}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          {r.status === '审批中' && r.approval_stage !== '已完成' && (
            <>
              <Button size="small" type="primary" icon={<RightCircleOutlined />}
                onClick={() => handleAdvance(r)} style={{ padding: '0 6px', fontSize: 11 }}>
                推进
              </Button>
              <Button size="small" danger icon={<CloseCircleOutlined />}
                onClick={() => handleReject(r)} style={{ padding: '0 6px', fontSize: 11 }}>
                驳回
              </Button>
            </>
          )}
          <Button size="small" type="text" icon={<HistoryOutlined />}
            onClick={() => handleViewHistory(r)} style={{ padding: '0 4px' }} />
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      {/* 顶部 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            <DollarOutlined /> 投资控制 · {projectName}
          </Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增付款申请
        </Button>
      </div>

      {/* 累计金额概览 */}
      {summary && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col span={5}>
            <Card size="small">
              <Statistic title="合同金额" value={summary.contractAmount || 0}
                prefix="¥" precision={2} valueStyle={{ fontSize: 18 }} />
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small">
              <Statistic title="已批/已付" value={summary.approvedAmount || 0}
                prefix="¥" precision={2}
                valueStyle={{ fontSize: 18, color: '#52c41a' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                占比 {summary.approvedPercent || 0}%
              </Text>
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small">
              <Statistic title="在审金额" value={summary.pendingAmount || 0}
                prefix="¥" precision={2}
                valueStyle={{ fontSize: 18, color: '#1677ff' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {summary.pendingCount || 0} 笔
              </Text>
            </Card>
          </Col>
          <Col span={5}>
            <Card size="small">
              <Statistic title="已驳回" value={summary.rejectedAmount || 0}
                prefix="¥" precision={2}
                valueStyle={{ fontSize: 18, color: '#ff4d4f' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                {summary.rejectedCount || 0} 笔
              </Text>
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="总申请" value={summary.totalCount || 0}
                suffix="笔" valueStyle={{ fontSize: 18 }} />
            </Card>
          </Col>
        </Row>
      )}

      {summary?.contractAmount > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>累计付款占合同比</Text>
          </div>
          <Progress
            percent={Math.min(100, summary.approvedPercent || 0)}
            strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
            format={p => `¥${summary.approvedAmount?.toLocaleString()} / ¥${summary.contractAmount?.toLocaleString()} (${p}%)`}
          />
        </Card>
      )}

      {/* 列表 */}
      <Card size="small" title={`付款申请台账（${payments.length}）`}>
        {loading ? <Spin /> : (
          payments.length === 0 ? <Empty description="暂无付款申请，点右上角新增" /> : (
            <Table size="small" dataSource={payments} columns={columns} rowKey="id" pagination={false} scroll={{ x: 1100 }} />
          )
        )}
      </Card>

      {/* 编辑弹窗 */}
      <Modal open={!!editing} title="新增付款申请" onCancel={() => setEditing(null)} onOk={handleSave} okText="提交" width={520}>
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>期次 *</Text>
              <Input value={editForm.period} onChange={e => setEditForm({ ...editForm, period: e.target.value })} placeholder="2026-06" />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>金额（元）*</Text>
              <InputNumber value={editForm.amount}
                onChange={v => setEditForm({ ...editForm, amount: v || 0 })}
                style={{ width: '100%' }} min={0} step={1000} />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>大写（自动可改）</Text>
            <Input value={editForm.amount_upper} onChange={e => setEditForm({ ...editForm, amount_upper: e.target.value })} placeholder="壹佰贰拾叁万肆仟伍佰陆拾柒元整" />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>工程内容描述</Text>
            <TextArea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} placeholder="本月完成 XXX 工程..." />
          </div>
        </Space>
      </Modal>

      {/* 审批历史弹窗 */}
      <Modal open={!!historyOf} title="审批历史" footer={null} onCancel={() => setHistoryOf(null)} width={520}>
        {historyOf && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>当前阶段</Text>
              <div style={{ marginTop: 4 }}>
                <Steps
                  size="small"
                  current={
                    ['监理员', '专业监理工程师', '总监理工程师', '业主', '已完成']
                      .indexOf(historyOf.approval_stage)
                  }
                  items={[
                    { title: '监理员' },
                    { title: '专业监理' },
                    { title: '总监' },
                    { title: '业主' },
                    { title: '已完成' },
                  ]}
                />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>审批记录</Text>
            </div>
            {historyOf.history?.length ? (
              <Timeline
                items={historyOf.history.map((h: any, i: number) => ({
                  color: h.action === 'reject' ? 'red' : 'blue',
                  children: (
                    <div style={{ fontSize: 12 }}>
                      <div><Tag color={h.action === 'reject' ? 'red' : 'blue'}>{h.stage}</Tag> {h.person || '未署名'}</div>
                      <div style={{ color: '#666', marginTop: 2 }}>{h.opinion || '(无意见)'}</div>
                      <div style={{ color: '#999', fontSize: 11, marginTop: 2 }}>
                        {new Date(h.time).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty description="暂无审批记录" />
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
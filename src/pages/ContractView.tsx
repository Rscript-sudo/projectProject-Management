/**
 * 合同管理页 — B6 模块
 * 功能：
 * 1. 合同台账（CRUD + 检索 + 到期提醒）
 * 2. 工程变更单登记
 * 3. 索赔登记
 * 4. 综合看板（合同数/总额/变更额/索赔额）
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button, Card, Space, Typography, Tag, App, Empty, Spin, Table, Modal, Input,
  InputNumber, Select, Row, Col, Statistic, Tabs, Alert, DatePicker,
} from 'antd'
import {
  PlusOutlined, ArrowLeftOutlined, FileProtectOutlined, WarningOutlined,
  ExclamationCircleOutlined, DollarOutlined, SearchOutlined, StopOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography
const { TextArea } = Input

const CONTRACT_TYPE_OPTIONS = [
  { value: '施工', label: '施工合同' },
  { value: '设计', label: '设计合同' },
  { value: '监理', label: '监理合同' },
  { value: '采购', label: '采购合同' },
  { value: '其他', label: '其他合同' },
]
const CHANGE_STATUS = [
  { value: '草稿', color: 'default' },
  { value: '审批中', color: 'processing' },
  { value: '已批准', color: 'success' },
  { value: '已驳回', color: 'error' },
]
const CLAIM_STATUS = [
  { value: '草稿', color: 'default' },
  { value: '提交中', color: 'blue' },
  { value: '审批中', color: 'processing' },
  { value: '已批准', color: 'success' },
  { value: '已驳回', color: 'error' },
]

export default function ContractView() {
  const navigate = useNavigate()
  const { projectName: routeProjectName } = useParams()
  const { currentProject } = useAppStore()
  const { message, modal } = App.useApp()
  const apiReady = useElectronAPI()

  const projectName = currentProject?.name || decodeURIComponent(routeProjectName || '')
  const projectPath = currentProject?.path || ''

  const [contracts, setContracts] = useState<any[]>([])
  const [changes, setChanges] = useState<any[]>([])
  const [claims, setClaims] = useState<any[]>([])
  const [dashboard, setDashboard] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('contract')
  const [editing, setEditing] = useState<{ type: string; mode: string; record?: any } | null>(null)

  useEffect(() => {
    if (!apiReady || !projectPath) return
    refresh()
  }, [apiReady, projectPath])

  const refresh = async () => {
    if (!apiReady) return
    setLoading(true)
    try {
      const [cl, chl, cll, db] = await Promise.all([
        window.electronAPI.contractList(projectPath),
        window.electronAPI.changeList(projectPath),
        window.electronAPI.claimList(projectPath),
        window.electronAPI.contractDashboard(projectPath),
      ])
      setContracts(cl)
      setChanges(chl)
      setClaims(cll)
      setDashboard(db)
    } catch (e: any) {
      message.error('加载失败：' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // 合同过滤
  const filteredContracts = useMemo(() => {
    if (!search) return contracts
    const s = search.toLowerCase()
    return contracts.filter(c =>
      c.contract_name?.toLowerCase().includes(s) ||
      c.party_a?.toLowerCase().includes(s) ||
      c.party_b?.toLowerCase().includes(s)
    )
  }, [contracts, search])

  // ============= 合同 =============
  const contractColumns = [
    { title: '合同名称', dataIndex: 'contract_name', key: 'contract_name', width: 220, ellipsis: true },
    {
      title: '类型', dataIndex: 'contract_type', key: 'contract_type', width: 90,
      render: (v: any) => <Tag color="blue">{v}</Tag>,
    },
    { title: '甲方', dataIndex: 'party_a', key: 'party_a', width: 120, ellipsis: true },
    { title: '乙方', dataIndex: 'party_b', key: 'party_b', width: 120, ellipsis: true },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 130,
      render: (v: any) => v ? `¥ ${v.toLocaleString()}` : '-',
    },
    { title: '签订日期', dataIndex: 'sign_date', key: 'sign_date', width: 100 },
    { title: '截止日期', dataIndex: 'end_date', key: 'end_date', width: 100 },
    {
      title: '状态', key: 'status', width: 130,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Tag color={r.status === '执行中' ? 'green' : r.status === '已终止' ? 'red' : 'orange'}>
            {r.status}
          </Tag>
          {r.expiring_soon && <Tag color="warning" icon={<WarningOutlined />}>30天内到期</Tag>}
        </Space>
      ),
    },
    {
      title: '操作', key: 'action', width: 80,
      render: (_: any, r: any) => r.status === '执行中' ? (
        <Button size="small" type="link" danger icon={<StopOutlined />}
          onClick={() => {
            modal.confirm({
              title: '终止合同？', okType: 'danger',
              onOk: async () => {
                await window.electronAPI.contractTerminate({ id: r.id })
                message.success('已终止')
                refresh()
              },
            })
          }}>终止</Button>
      ) : '-',
    },
  ]

  // ============= 变更单 =============
  const changeColumns = [
    { title: '变更编号', dataIndex: 'change_number', key: 'change_number', width: 130 },
    { title: '主题', dataIndex: 'subject', key: 'subject', width: 200, ellipsis: true },
    {
      title: '发起方', dataIndex: 'initiator', key: 'initiator', width: 90,
      render: (v: any) => <Tag>{v}</Tag>,
    },
    {
      title: '金额变化', dataIndex: 'amount_change', key: 'amount_change', width: 130,
      render: (v: any) => v > 0 ? <Text style={{ color: '#52c41a' }}>+{v.toLocaleString()}</Text>
        : v < 0 ? <Text style={{ color: '#ff4d4f' }}>{v.toLocaleString()}</Text> : '-',
    },
    {
      title: '工期变化(天)', dataIndex: 'schedule_change', key: 'schedule_change', width: 100,
      render: (v: any) => v ? `${v > 0 ? '+' : ''}${v}` : '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: any) => {
        const c = CHANGE_STATUS.find(s => s.value === v)
        return <Tag color={c?.color}>{v}</Tag>
      },
    },
  ]

  // ============= 索赔 =============
  const claimColumns = [
    { title: '索赔编号', dataIndex: 'claim_number', key: 'claim_number', width: 130 },
    { title: '索赔方', dataIndex: 'claimant', key: 'claimant', width: 100 },
    { title: '主题', dataIndex: 'subject', key: 'subject', width: 200, ellipsis: true },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 130,
      render: (v: any) => v ? `¥ ${v.toLocaleString()}` : '-',
    },
    { title: '理由', dataIndex: 'reason', key: 'reason', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: any) => {
        const c = CLAIM_STATUS.find(s => s.value === v)
        return <Tag color={c?.color}>{v}</Tag>
      },
    },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      {/* 顶部 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            <FileProtectOutlined /> 合同管理 · {projectName}
          </Title>
        </Space>
      </div>

      {/* 综合看板 */}
      {dashboard && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="合同数" value={dashboard.contractCount} suffix="份" valueStyle={{ fontSize: 20 }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                总额 ¥{dashboard.totalAmount?.toLocaleString() || 0}
              </Text>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="变更单" value={dashboard.changeCount} suffix="份" valueStyle={{ fontSize: 20, color: '#1677ff' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                金额变动 ¥{dashboard.changeAmount?.toLocaleString() || 0}
              </Text>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="索赔" value={dashboard.claimCount} suffix="份" valueStyle={{ fontSize: 20, color: '#fa8c16' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                金额 ¥{dashboard.claimAmount?.toLocaleString() || 0}
              </Text>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="30天内到期" value={dashboard.expiringCount} suffix="份" valueStyle={{ fontSize: 20, color: dashboard.expiringCount ? '#ff4d4f' : '#52c41a' }} />
              {dashboard.expiringCount > 0 && (
                <Text type="warning" style={{ fontSize: 11 }}>
                  <ExclamationCircleOutlined /> 请关注
                </Text>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* 标签页 */}
      <Card size="small">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          tabBarExtraContent={
            <Space>
              {activeTab === 'contract' && (
                <>
                  <Input
                    size="small"
                    placeholder="搜索合同"
                    prefix={<SearchOutlined />}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    allowClear
                    style={{ width: 180 }}
                  />
                  <Button type="primary" size="small" icon={<PlusOutlined />}
                    onClick={() => setEditing({ type: 'contract', mode: 'new' })}>
                    新增合同
                  </Button>
                </>
              )}
              {activeTab === 'change' && (
                <Button type="primary" size="small" icon={<PlusOutlined />}
                  onClick={() => setEditing({ type: 'change', mode: 'new' })}>
                  新增变更单
                </Button>
              )}
              {activeTab === 'claim' && (
                <Button type="primary" size="small" icon={<PlusOutlined />}
                  onClick={() => setEditing({ type: 'claim', mode: 'new' })}>
                  新增索赔
                </Button>
              )}
            </Space>
          }
          items={[
            {
              key: 'contract', label: `合同台账（${filteredContracts.length}）`,
              children: loading ? <Spin /> : (
                filteredContracts.length === 0 ? <Empty description={search ? '无匹配' : '暂无合同'} /> : (
                  <Table size="small" dataSource={filteredContracts} columns={contractColumns} rowKey="id" pagination={false} />
                )
              ),
            },
            {
              key: 'change', label: `变更单（${changes.length}）`,
              children: changes.length === 0 ? <Empty /> : (
                <Table size="small" dataSource={changes} columns={changeColumns} rowKey="id" pagination={false} />
              ),
            },
            {
              key: 'claim', label: `索赔登记（${claims.length}）`,
              children: claims.length === 0 ? <Empty /> : (
                <Table size="small" dataSource={claims} columns={claimColumns} rowKey="id" pagination={false} />
              ),
            },
          ]}
        />
      </Card>

      <ContractEditModal editing={editing} setEditing={setEditing} projectPath={projectPath}
        onSaved={() => { setEditing(null); refresh() }} message={message} />
    </div>
  )
}

// 单独的编辑弹窗组件
function ContractEditModal({ editing, setEditing, projectPath, onSaved, message }: any) {
  const [form, setForm] = useState<any>({})

  useEffect(() => {
    if (!editing) return
    if (editing.mode === 'new') {
      setForm({})
    }
  }, [editing])

  if (!editing) return null

  const handleSave = async () => {
    try {
      if (editing.type === 'contract') {
        if (!form.contract_name) { message.warning('请输入合同名称'); return }
        await window.electronAPI.contractAdd({ projectPath, contract: form })
        message.success('合同已新增')
      } else if (editing.type === 'change') {
        if (!form.subject) { message.warning('请输入变更主题'); return }
        await window.electronAPI.changeAdd({ projectPath, change: form })
        message.success('变更单已新增')
      } else if (editing.type === 'claim') {
        if (!form.subject) { message.warning('请输入索赔主题'); return }
        await window.electronAPI.claimAdd({ projectPath, claim: form })
        message.success('索赔已登记')
      }
      onSaved()
    } catch (e: any) {
      message.error('保存失败：' + e.message)
    }
  }

  const titleMap: Record<string, string> = {
    contract: '新增合同', change: '新增变更单', claim: '新增索赔登记',
  }

  return (
    <Modal open={!!editing} title={titleMap[editing.type]} onCancel={() => setEditing(null)} onOk={handleSave} okText="保存" width={560}>
      {editing.type === 'contract' && (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>合同名称 *</Text>
            <Input value={form.contract_name || ''} onChange={e => setForm({ ...form, contract_name: e.target.value })} />
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>类型</Text>
              <Select value={form.contract_type} onChange={v => setForm({ ...form, contract_type: v })}
                options={CONTRACT_TYPE_OPTIONS} style={{ width: '100%' }} placeholder="选择" />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>金额（元）</Text>
              <InputNumber value={form.amount} onChange={v => setForm({ ...form, amount: v || 0 })}
                style={{ width: '100%' }} min={0} />
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>甲方</Text>
              <Input value={form.party_a || ''} onChange={e => setForm({ ...form, party_a: e.target.value })} />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>乙方</Text>
              <Input value={form.party_b || ''} onChange={e => setForm({ ...form, party_b: e.target.value })} />
            </Col>
          </Row>
          <Row gutter={8}>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>签订日期</Text>
              <DatePicker value={form.sign_date ? dayjs(form.sign_date) : null}
                onChange={d => setForm({ ...form, sign_date: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }} />
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>起始日期</Text>
              <DatePicker value={form.start_date ? dayjs(form.start_date) : null}
                onChange={d => setForm({ ...form, start_date: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }} />
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>截止日期</Text>
              <DatePicker value={form.end_date ? dayjs(form.end_date) : null}
                onChange={d => setForm({ ...form, end_date: d ? d.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }} />
            </Col>
          </Row>
        </Space>
      )}

      {editing.type === 'change' && (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>变更编号</Text>
              <Input value={form.change_number || ''} onChange={e => setForm({ ...form, change_number: e.target.value })} />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>发起方</Text>
              <Select value={form.initiator} onChange={v => setForm({ ...form, initiator: v })}
                options={[{ value: '业主', label: '业主' }, { value: '施工', label: '施工' }, { value: '监理', label: '监理' }, { value: '设计', label: '设计' }]}
                style={{ width: '100%' }} placeholder="选择" />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>主题 *</Text>
            <Input value={form.subject || ''} onChange={e => setForm({ ...form, subject: e.target.value })} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>变更原因</Text>
            <TextArea value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>变更内容</Text>
            <TextArea value={form.content || ''} onChange={e => setForm({ ...form, content: e.target.value })} rows={3} />
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>金额变化（正增负减）</Text>
              <InputNumber value={form.amount_change} onChange={v => setForm({ ...form, amount_change: v || 0 })}
                style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>工期变化（天）</Text>
              <InputNumber value={form.schedule_change} onChange={v => setForm({ ...form, schedule_change: v || 0 })}
                style={{ width: '100%' }} />
            </Col>
          </Row>
        </Space>
      )}

      {editing.type === 'claim' && (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>索赔编号</Text>
              <Input value={form.claim_number || ''} onChange={e => setForm({ ...form, claim_number: e.target.value })} />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>索赔方</Text>
              <Input value={form.claimant || ''} onChange={e => setForm({ ...form, claimant: e.target.value })} placeholder="业主/施工" />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>主题 *</Text>
            <Input value={form.subject || ''} onChange={e => setForm({ ...form, subject: e.target.value })} />
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>索赔金额（元）</Text>
              <InputNumber value={form.amount} onChange={v => setForm({ ...form, amount: v || 0 })}
                style={{ width: '100%' }} min={0} />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>索赔理由</Text>
            <TextArea value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>证据描述</Text>
            <TextArea value={form.evidence || ''} onChange={e => setForm({ ...form, evidence: e.target.value })} rows={2} />
          </div>
        </Space>
      )}
    </Modal>
  )
}
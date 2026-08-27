import { useEffect, useState } from 'react'
import { App, Button, Card, Checkbox, Col, Empty, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Timeline, Typography } from 'antd'
import { ArrowLeftOutlined, EditOutlined, HistoryOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text, Title } = Typography

const TYPES = {
  participant: {
    label: '参建单位',
    fields: [
      ['organization_type', '单位类型', ['建设单位', '施工单位', '监理单位', '设计单位', '供应单位', '其他']],
      ['organization_name', '单位名称'], ['credit_code', '统一社会信用代码'],
      ['contact_name', '联系人'], ['contact_phone', '联系电话'],
    ],
    columns: [['organization_type', '单位类型'], ['organization_name', '单位名称'], ['contact_name', '联系人'], ['contact_phone', '联系电话']],
  },
  member: {
    label: '项目成员',
    fields: [['member_name', '姓名'], ['role', '角色', ['总监理工程师', '专业监理工程师', '监理员', '资料员', '项目负责人', '其他']], ['phone', '联系电话'], ['certificate_no', '证书编号']],
    columns: [['member_name', '姓名'], ['role', '角色'], ['phone', '联系电话'], ['certificate_no', '证书编号']],
  },
  structure: {
    label: '标段与工程',
    fields: [['structure_type', '类型', ['标段', '单位工程', '分部工程', '专业']], ['name', '名称'], ['code', '编码']],
    columns: [['structure_type', '类型'], ['name', '名称'], ['code', '编码']],
  },
} as const

type MasterType = keyof typeof TYPES

export default function ProjectArchiveView() {
  const navigate = useNavigate()
  const { projectName: routeName } = useParams()
  const { currentProject } = useAppStore()
  const apiReady = useElectronAPI()
  const { message, modal } = App.useApp()
  const projectName = currentProject?.name || decodeURIComponent(routeName || '')
  const [activeType, setActiveType] = useState<MasterType>('participant')
  const [data, setData] = useState<Record<MasterType, any[]>>({ participant: [], member: [], structure: [] })
  const [phases, setPhases] = useState<any[]>([])
  const [changes, setChanges] = useState<any[]>([])
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [phase, setPhase] = useState('')
  const [phaseNote, setPhaseNote] = useState('')
  const [evidence, setEvidence] = useState<any[]>([])
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceForm, setEvidenceForm] = useState<Record<string, any>>({ status: 'pending', critical: true })

  const refresh = async () => {
    const [participant, member, structure, phaseRows, changeRows, evidenceRows] = await Promise.all([
      window.electronAPI.dbListMasterData(projectName, 'participant'),
      window.electronAPI.dbListMasterData(projectName, 'member'),
      window.electronAPI.dbListMasterData(projectName, 'structure'),
      window.electronAPI.dbGetProjectPhaseHistory(projectName),
      window.electronAPI.dbListMasterChanges(projectName),
      window.electronAPI.dbListEvidenceItems(projectName),
    ])
    setData({ participant, member, structure })
    setPhases(phaseRows)
    setChanges(changeRows)
    setEvidence(evidenceRows)
  }

  useEffect(() => { if (apiReady && projectName) refresh().catch(error => message.error(error.message)) }, [apiReady, projectName])

  const save = async () => {
    const result = await window.electronAPI.dbSaveMasterData(projectName, activeType, form, editing === 'new' ? null : editing.id)
    if (!result.success) { message.error(result.error || '保存失败'); return }
    message.success(editing === 'new' ? '已新增' : '已保存新版本，历史记录已保留')
    setEditing(null); setForm({}); await refresh()
  }

  const retire = (record: any) => modal.confirm({
    title: '停用这条主数据？',
    content: '历史正式件仍保留原值，新文档不再使用该记录。',
    okType: 'danger',
    onOk: async () => { await window.electronAPI.dbRetireMasterData(projectName, activeType, record.id); await refresh() },
  })

  const config = TYPES[activeType]
  const columns = [
    ...config.columns.map(([key, label]) => ({ title: label, dataIndex: key, key })),
    { title: '生效时间', dataIndex: 'effective_from', width: 170, render: (value: string) => value ? new Date(value).toLocaleString() : '-' },
    { title: '操作', width: 120, render: (_: any, record: any) => <Space size={2}>
      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(record); setForm({ ...record }) }} />
      <Button type="link" danger size="small" icon={<StopOutlined />} onClick={() => retire(record)} />
    </Space> },
  ]

  return <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><Title level={4} style={{ margin: 0 }}>项目档案 · {projectName}</Title></Space>
    <Row gutter={16}>
      <Col span={17}>
        <Card size="small">
          <Tabs activeKey={activeType} onChange={key => setActiveType(key as MasterType)}
            tabBarExtraContent={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setEditing('new'); setForm({ effective_from: new Date().toISOString().slice(0, 10) }) }}>新增{config.label}</Button>}
            items={(Object.keys(TYPES) as MasterType[]).map(key => ({ key, label: `${TYPES[key].label}（${data[key].length}）`, children: data[key].length ? <Table size="small" rowKey="id" pagination={false} dataSource={data[key]} columns={key === activeType ? columns as any : []} /> : <Empty description={`暂无${TYPES[key].label}`} /> }))} />
        </Card>
      </Col>
      <Col span={7}>
        <Card size="small" title="当前项目阶段" extra={<Button type="link" size="small" onClick={() => setPhaseOpen(true)}>切换</Button>} style={{ marginBottom: 16 }}>
          {phases[0] ? <><Tag color="blue">{phases[0].phase}</Tag><Text type="secondary" style={{ fontSize: 11 }}>{phases[0].note}</Text></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未设置阶段" />}
        </Card>
        <Card size="small" title={<Space><HistoryOutlined />变更历史</Space>}>
          <Timeline items={changes.slice(0, 20).map(item => ({ children: <div style={{ fontSize: 11 }}><Tag>{item.entity_type}</Tag>{item.action}<div style={{ color: '#999' }}>{new Date(item.changed_at).toLocaleString()}</div></div> }))} />
        </Card>
        <Card size="small" title="AI 事实证据" extra={<Button type="link" size="small" onClick={() => setEvidenceOpen(true)}>新增</Button>} style={{ marginTop: 16 }}>
          {evidence.length ? <Space direction="vertical" style={{ width: '100%' }}>
            {evidence.slice(0, 8).map(item => <div key={item.id} style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
              <Space wrap><Text>E{item.id} · {item.title}</Text>{item.critical ? <Tag color="red">关键</Tag> : null}<Tag color={item.status === 'confirmed' ? 'green' : item.status === 'invalid' ? 'red' : 'gold'}>{item.status === 'confirmed' ? '已确认' : item.status === 'invalid' ? '已失效' : '待确认'}</Tag></Space>
              {item.status === 'pending' ? <Space><Button type="link" size="small" onClick={async () => { const r = await window.electronAPI.dbUpdateEvidenceStatus(projectName, item.id, 'confirmed', '项目用户'); if (r?.success) { await refresh() } else { message.error(r?.error || '操作失败') } }}>确认</Button><Button type="link" danger size="small" onClick={async () => { const r = await window.electronAPI.dbUpdateEvidenceStatus(projectName, item.id, 'invalid'); if (r?.success) { await refresh() } else { message.error(r?.error || '操作失败') } }}>标记失效</Button></Space> : null}
            </div>)}
          </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据" />}
        </Card>
      </Col>
    </Row>
    <Modal open={!!editing} title={`${editing === 'new' ? '新增' : '变更'}${config.label}`} onCancel={() => setEditing(null)} onOk={save} okText="保存">
      <Space direction="vertical" style={{ width: '100%' }}>
        {config.fields.map(([key, label, options]) => <div key={key}><Text type="secondary">{label}</Text>{options ? <Select value={form[key]} onChange={value => setForm({ ...form, [key]: value })} options={options.map(value => ({ value, label: value }))} style={{ width: '100%' }} /> : <Input value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} />}</div>)}
        <div><Text type="secondary">生效日期</Text><Input type="date" value={String(form.effective_from || '').slice(0, 10)} onChange={event => setForm({ ...form, effective_from: event.target.value })} /></div>
      </Space>
    </Modal>
    <Modal open={phaseOpen} title="切换项目阶段" onCancel={() => setPhaseOpen(false)} onOk={async () => { const result = await window.electronAPI.dbSetProjectPhase(projectName, phase, phaseNote); if (!result.success) { message.error(result.error || '切换失败'); return }; setPhaseOpen(false); setPhase(''); setPhaseNote(''); await refresh() }}>
      <Space direction="vertical" style={{ width: '100%' }}><Select value={phase || undefined} onChange={setPhase} options={['立项阶段', '准备阶段', '实施阶段', '验收阶段', '保修阶段', '已归档'].map(value => ({ value, label: value }))} placeholder="选择阶段" style={{ width: '100%' }} /><Input.TextArea value={phaseNote} onChange={event => setPhaseNote(event.target.value)} placeholder="阶段切换依据或说明" /></Space>
    </Modal>
    <Modal open={evidenceOpen} title="新增 AI 事实证据" onCancel={() => setEvidenceOpen(false)} onOk={async () => {
      const result = await window.electronAPI.dbCreateEvidenceItem({ project_name: projectName, title: evidenceForm.title || '', evidence_type: evidenceForm.evidence_type || 'other', source_ref: evidenceForm.source_ref || '', source_location: evidenceForm.source_location || '', excerpt: evidenceForm.excerpt || '', status: evidenceForm.status, critical: evidenceForm.critical ? 1 : 0 })
      if (!result.success) { message.error(result.error || '新增失败'); return }
      setEvidenceOpen(false); setEvidenceForm({ status: 'pending', critical: true }); await refresh()
    }}>
      <Space direction="vertical" style={{ width: '100%' }}><Input value={evidenceForm.title || ''} onChange={event => setEvidenceForm({ ...evidenceForm, title: event.target.value })} placeholder="证据标题" /><Input value={evidenceForm.source_ref || ''} onChange={event => setEvidenceForm({ ...evidenceForm, source_ref: event.target.value })} placeholder="来源文件/记录" /><Input value={evidenceForm.source_location || ''} onChange={event => setEvidenceForm({ ...evidenceForm, source_location: event.target.value })} placeholder="页码、表名、行号或部位" /><Input.TextArea value={evidenceForm.excerpt || ''} onChange={event => setEvidenceForm({ ...evidenceForm, excerpt: event.target.value })} placeholder="支持的事实摘要" /><Select value={evidenceForm.status} onChange={value => setEvidenceForm({ ...evidenceForm, status: value })} options={[{ value: 'pending', label: '待确认' }, { value: 'confirmed', label: '已确认' }]} /><Checkbox checked={!!evidenceForm.critical} onChange={event => setEvidenceForm({ ...evidenceForm, critical: event.target.checked })}>关键证据（未确认时阻断正式件）</Checkbox></Space>
    </Modal>
  </div>
}

import { useEffect, useState } from 'react'
import { Alert, Button, Empty, List, Popconfirm, Space, Spin, Tag, Typography } from 'antd'
import { DeleteOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

const ENTITY_LABELS: Record<string, string> = {
  inspection: '巡视记录', hazard: '隐患', correspondence: '往来函件',
  progress_node: '进度节点', payment_request: '付款申请', contract: '合同',
  change_order: '变更', claim: '索赔', photo: '现场照片', document: '文档',
  ledger_simple: '台账记录',
}

const RELATION_LABELS: Record<string, string> = {
  inspection_finding: '巡视发现', rectification_notice: '整改通知',
  hazard_evidence: '隐患证据', progress_evidence: '进度证据',
  payment_progress: '计量依据', contract_change: '合同变更',
  contract_payment: '合同支付', document_evidence: '文档事实来源',
}

type Props = {
  projectName: string
  entityType: string
  entityId: string | number
  readOnly?: boolean
}

export default function BusinessRelationsPanel({ projectName, entityType, entityId, readOnly = false }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI.dbListBusinessRelations(projectName, entityType, entityId)
      setItems(Array.isArray(result) ? result : [])
    } catch (e: any) {
      setError(e?.message || '读取关联资料失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectName, entityType, String(entityId)])

  const remove = async (relationId: number) => {
    await window.electronAPI.dbDeleteBusinessRelation(projectName, relationId)
    await load()
  }

  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
  if (error) return <Alert type="error" showIcon message={error} action={<Button size="small" onClick={load}>重试</Button>} />

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
        <Space><LinkOutlined /><Text strong>关联资料</Text><Tag>{items.length}</Tag></Space>
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>
      {!items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联资料" /> : (
        <List size="small" bordered dataSource={items} renderItem={item => {
          const otherType = item.direction === 'outgoing' ? item.target_type : item.source_type
          const otherId = item.direction === 'outgoing' ? item.target_id : item.source_id
          return (
            <List.Item actions={readOnly ? [] : [
              <Popconfirm key="delete" title="解除这条业务关联？" onConfirm={() => remove(item.id)}>
                <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label="解除关联" />
              </Popconfirm>,
            ]}>
              <List.Item.Meta
                title={<Space><Tag color="blue">{RELATION_LABELS[item.relation_type] || item.relation_type}</Tag><Text>{ENTITY_LABELS[otherType] || otherType} #{otherId}</Text></Space>}
                description={item.metadata?.date ? `记录日期：${item.metadata.date}` : `建立时间：${new Date(item.created_at).toLocaleString()}`}
              />
            </List.Item>
          )
        }} />
      )}
    </div>
  )
}

import { useState } from 'react'
import { App, Button, Card, Input, Select, Space, Table, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/useProjectStore'

const { Text, Title } = Typography

export default function DeliveryCenterView() {
  const navigate = useNavigate()
  const { currentProject } = useAppStore()
  const { message } = App.useApp()
  const [entityType, setEntityType] = useState<'progress' | 'contract' | 'hazard' | 'payment' | 'photo'>('progress')
  const [recordsText, setRecordsText] = useState('[{"name":"示例节点"}]')
  const [mappingText, setMappingText] = useState('{"name":"name"}')
  const [preview, setPreview] = useState<any[]>([])
  const [lastBatchId, setLastBatchId] = useState<number>()
  if (!currentProject) return <div style={{ padding: 24 }}>请先选择项目</div>

  const input = () => ({ records: JSON.parse(recordsText), fieldMapping: JSON.parse(mappingText) })
  const doPreview = async () => { try { const result = await window.electronAPI.previewUnifiedImport({ entityType, ...input() }); setPreview(result.rows || []); result.errors?.length ? message.warning(`${result.errors.length} 个字段错误`) : message.success('预览校验通过') } catch (error: any) { message.error(error.message) } }
  const commit = async () => { try { const result = await window.electronAPI.commitUnifiedImport({ projectPath: currentProject.path, entityType, ...input() }); if (!result.success) { message.error(result.error || '导入失败'); return }; setLastBatchId(result.batchId); message.success(`已导入 ${result.importedCount} 条，报告已生成`) } catch (error: any) { message.error(error.message) } }
  const generate = async (mode: 'daily' | 'weekly' | 'monthly' | 'payment_certificate') => { const today = new Date().toISOString().slice(0, 10); const result = await window.electronAPI.batchGenerateDocuments({ projectPath: currentProject.path, mode, dates: [today], period: { start: `${today.slice(0, 7)}-01`, end: today } }); result.success ? message.success(`已生成 ${result.count} 份`) : message.error(result.error || '生成失败') }

  return <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><Title level={4} style={{ margin: 0 }}>导入与交付中心 · {currentProject.name}</Title></Space>
    <Card title="统一导入" size="small" style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}><Select value={entityType} onChange={setEntityType} options={[['progress', '进度'], ['contract', '合同'], ['hazard', '隐患'], ['payment', '付款'], ['photo', '照片']].map(([value, label]) => ({ value, label }))} /><Text>原始记录 JSON</Text><Input.TextArea rows={5} value={recordsText} onChange={event => setRecordsText(event.target.value)} /><Text>字段映射 JSON（目标字段 → 原字段）</Text><Input.TextArea rows={3} value={mappingText} onChange={event => setMappingText(event.target.value)} /><Space><Button onClick={doPreview}>预览与校验</Button><Button type="primary" onClick={commit}>确认导入</Button>{lastBatchId ? <Button danger onClick={async () => { const result = await window.electronAPI.undoUnifiedImport({ projectName: currentProject.name, batchId: lastBatchId }); result.success ? message.success(`已撤销 ${result.removedCount} 条`) : message.error(result.error || '撤销失败') }}>撤销本批</Button> : null}</Space>{preview.length ? <Table size="small" pagination={false} rowKey="sourceRow" dataSource={preview} columns={[{ title: '源行', dataIndex: 'sourceRow' }, { title: '映射结果', dataIndex: 'mapped', render: value => <Text code>{JSON.stringify(value)}</Text> }]} /> : null}</Space>
    </Card>
    <Card title="批量生成与交付" size="small"><Space wrap><Button onClick={() => generate('daily')}>按日期生成日志</Button><Button onClick={() => generate('weekly')}>日志生成周报</Button><Button onClick={() => generate('monthly')}>周报及台账生成月报</Button><Button onClick={() => generate('payment_certificate')}>付款生成支付证书</Button><Button type="primary" onClick={async () => { const result = await window.electronAPI.createDeliveryPackage({ projectPath: currentProject.path }); result.success ? message.success(`交付包已生成：${result.packageDir}`) : message.error(result.error || '交付失败') }}>生成正式交付包</Button></Space></Card>
  </div>
}

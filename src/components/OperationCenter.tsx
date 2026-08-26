import { useCallback, useEffect, useState } from 'react'
import { App, Button, Drawer, Empty, List, Progress, Space, Tag, Typography } from 'antd'
import { DeleteOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons'

const { Text } = Typography
type Operation = { id: string; title: string; type: string; status: string; stage: string; progress: number; retryable?: boolean; attempts?: number; maxAttempts?: number; error?: string; createdAt: string; updatedAt: string }
type Diagnostic = { id: string; taskId: string; level: string; stage: string; message: string; createdAt: string }

export default function OperationCenter({ open, onClose, projectPath }: { open: boolean; onClose: () => void; projectPath?: string }) {
  const { message, modal } = App.useApp()
  const [tasks, setTasks] = useState<Operation[]>([])
  const [events, setEvents] = useState<Diagnostic[]>([])
  const [loading, setLoading] = useState(false)
  const [backups, setBackups] = useState<Array<{ name: string; path: string; createdAt: string }>>([])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.listOperations({ projectPath, limit: 100 })
      if (!result.success) throw new Error(result.error || '读取失败')
      setTasks(result.tasks || []); setEvents(result.events || [])
      if (projectPath) { const backupResult = await window.electronAPI.listProjectBackups(projectPath); setBackups(backupResult.backups || []) }
    } catch (error: any) { message.error(error?.message || '诊断中心读取失败') }
    finally { setLoading(false) }
  }, [message, projectPath])
  useEffect(() => { if (open) void load() }, [open, load])

  const backup = async () => {
    if (!projectPath) return message.warning('请先进入一个项目')
    const result = await window.electronAPI.createProjectBackup(projectPath)
    if (result.success) { message.success(`备份完成：${result.path}`); await load() } else message.error(result.error || '备份失败')
  }
  const statusColor: Record<string, string> = { queued: 'default', running: 'processing', validating: 'warning', succeeded: 'success', failed: 'error', cancelled: 'default' }

  return <Drawer title={<Space><SafetyCertificateOutlined />运行与诊断中心</Space>} width={680} open={open} onClose={onClose}
    extra={<Space><Button icon={<SaveOutlined />} disabled={!projectPath} onClick={backup}>备份当前项目</Button><Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button></Space>}>
    <Space style={{ marginBottom: 16 }}><Tag color="green">结构化任务记录</Tag><Tag color="blue">敏感信息自动脱敏</Tag><Tag>最多保留 300 项</Tag></Space>
    {projectPath && <List size="small" header={<Text strong>项目备份与恢复</Text>} dataSource={backups.slice(0, 5)} locale={{ emptyText: '暂无项目备份' }} renderItem={backupItem => <List.Item actions={[<Button key="restore" danger size="small" onClick={() => modal.confirm({ title: '确认恢复此备份？', content: '恢复前会自动再创建一份安全备份，项目当前文件随后被替换。', okText: '恢复', okButtonProps: { danger: true }, onOk: async () => { const result = await window.electronAPI.restoreProjectBackup(projectPath, backupItem.path); result.success ? message.success('项目恢复完成，请重新进入项目') : message.error(result.error || '恢复失败'); await load() } })}>恢复</Button>]}><Text>{backupItem.name}</Text></List.Item>} />}
    <List header={<Text strong>最近任务</Text>} dataSource={tasks} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务记录" /> }} renderItem={task => <List.Item>
      <div style={{ width: '100%' }}><Space><Text strong>{task.title}</Text><Tag color={statusColor[task.status]}>{task.status}</Tag><Text type="secondary">{task.stage}</Text></Space>
      <Progress percent={Math.max(0, Math.min(100, task.progress || 0))} size="small" status={task.status === 'failed' ? 'exception' : task.status === 'succeeded' ? 'success' : 'active'} />
      <Space>{task.error && <Text type="danger">{task.error}</Text>}
        {['queued', 'running', 'validating'].includes(task.status) && <Button danger size="small" onClick={async () => { await window.electronAPI.cancelOperation(task.id); await load() }}>取消</Button>}
        {task.retryable && ['failed', 'cancelled', 'interrupted'].includes(task.status) && <Button size="small" onClick={async () => { const result = await window.electronAPI.retryOperation(task.id); result.success ? message.info('已进入重试队列，请回到原操作重新提交') : message.error(result.error); await load() }}>重试</Button>}
      </Space><Text type="secondary" style={{ float: 'right', fontSize: 11 }}>{new Date(task.updatedAt).toLocaleString()}</Text></div>
    </List.Item>} />
    <List style={{ marginTop: 20 }} header={<Space><Text strong>诊断事件</Text><Button size="small" icon={<DeleteOutlined />} onClick={async () => { await window.electronAPI.clearFinishedOperations(); await load() }}>清理已结束</Button></Space>} dataSource={events.slice(0, 80)} renderItem={event => <List.Item>
      <Space align="start"><Tag color={event.level === 'error' ? 'red' : event.level === 'warn' ? 'orange' : 'blue'}>{event.level}</Tag><div><Text>{event.message}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{event.stage} · {new Date(event.createdAt).toLocaleString()}</Text></div></Space>
    </List.Item>} />
  </Drawer>
}

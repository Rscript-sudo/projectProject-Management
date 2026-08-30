import { useEffect, useState } from 'react'
import { Card, Empty, Progress, Space, Table, Tag, Typography } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
const { Title, Text } = Typography
export default function PortfolioDashboardView() {
  const [data, setData] = useState<any>({ projects: [], rankings: [], todos: [], calendar: [] })
  useEffect(() => { window.electronAPI.getPortfolioDashboard().then(setData) }, [])
  return <div className="app-page">
    <header className="app-page-header"><div className="app-page-heading"><span className="app-page-heading__icon"><BarChartOutlined /></span><div className="app-page-heading__copy"><Title level={3} className="app-page-heading__title">多项目驾驶舱</Title><Text className="app-page-heading__description">集中查看项目健康、风险、待办和关键节点</Text></div></div></header>
    <div className="app-responsive-grid">
      <Card title="项目健康与进度" className="app-content-card"><Table rowKey="name" pagination={false} scroll={{ x: 720 }} dataSource={data.projects} columns={[{ title: '项目', dataIndex: 'name' }, { title: '健康度', dataIndex: 'health', render: (value: number) => <Progress percent={value} size="small" status={value < 60 ? 'exception' : 'normal'} /> }, { title: '进度', dataIndex: 'progress', render: (value: number) => `${value}%` }, { title: '资料完整度', dataIndex: 'phaseCompletion', render: (value: number) => `${value}%` }, { title: '待办', dataIndex: 'todoCount' }, { title: '问题', dataIndex: 'issueCount' }]} /></Card>
      <Card title="风险排行" className="app-content-card">{data.rankings.length ? <Space direction="vertical" style={{ width: '100%' }}>{data.rankings.map((item: any, index: number) => <div key={item.name}><Tag color={item.health < 60 ? 'red' : item.health < 80 ? 'gold' : 'green'}>#{index + 1}</Tag>{item.name} <Text type="secondary">{item.health}</Text></div>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无风险数据" />}</Card>
    </div>
    <div className="app-two-column-grid" style={{ marginTop: 16 }}><Card title="跨项目待办" className="app-content-card"><Space direction="vertical">{data.todos.map((item: any, index: number) => <Text key={index}>{item.projectName} · {item.type} · {item.title}</Text>)}</Space></Card><Card title="节点日历" className="app-content-card"><Space direction="vertical">{data.calendar.map((item: any, index: number) => <Text key={index}>{item.due} · {item.projectName} · {item.title}</Text>)}</Space></Card></div>
  </div>
}

import { useEffect, useState } from 'react'
import { Card, Col, Progress, Row, Space, Table, Tag, Typography } from 'antd'
const { Title, Text } = Typography
export default function PortfolioDashboardView() {
  const [data, setData] = useState<any>({ projects: [], rankings: [], todos: [], calendar: [] })
  useEffect(() => { window.electronAPI.getPortfolioDashboard().then(setData) }, [])
  return <div style={{ padding: 24 }}><Title level={4}>多项目驾驶舱</Title><Row gutter={16}>
    <Col span={16}><Card title="项目健康与进度"><Table rowKey="name" pagination={false} dataSource={data.projects} columns={[{ title: '项目', dataIndex: 'name' }, { title: '健康度', dataIndex: 'health', render: (value: number) => <Progress percent={value} size="small" status={value < 60 ? 'exception' : 'normal'} /> }, { title: '进度', dataIndex: 'progress', render: (value: number) => `${value}%` }, { title: '资料完整度', dataIndex: 'phaseCompletion', render: (value: number) => `${value}%` }, { title: '待办', dataIndex: 'todoCount' }, { title: '问题', dataIndex: 'issueCount' }]} /></Card></Col>
    <Col span={8}><Card title="风险排行">{data.rankings.map((item: any, index: number) => <div key={item.name}><Tag color={item.health < 60 ? 'red' : item.health < 80 ? 'gold' : 'green'}>#{index + 1}</Tag>{item.name} <Text>{item.health}</Text></div>)}</Card></Col>
  </Row><Row gutter={16} style={{ marginTop: 16 }}><Col span={12}><Card title="跨项目待办"><Space direction="vertical">{data.todos.map((item: any, index: number) => <Text key={index}>{item.projectName} · {item.type} · {item.title}</Text>)}</Space></Card></Col><Col span={12}><Card title="节点日历"><Space direction="vertical">{data.calendar.map((item: any, index: number) => <Text key={index}>{item.due} · {item.projectName} · {item.title}</Text>)}</Space></Card></Col></Row></div>
}

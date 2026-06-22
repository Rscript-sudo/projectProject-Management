import { useState, useEffect } from 'react'
import { Typography, Progress, Badge, Spin, Space } from 'antd'
import { DashboardOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { AllProjectsDashboard, ProjectDashboard } from '../vite-env'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text } = Typography

function ProjectRow({ project, selected, onClick }: { project: ProjectDashboard; selected: boolean; onClick: () => void }) {
  const pct = project.totalTypes > 0 ? Math.round((project.completeTypes / project.totalTypes) * 100) : 0
  const dateStr = project.lastActivity
    ? new Date(project.lastActivity).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '无活动'

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
        borderRadius: 6,
        background: selected ? '#f0f5ff' : 'transparent',
        border: `1px solid ${selected ? '#1677ff' : 'transparent'}`,
        cursor: 'pointer',
        marginBottom: 4,
        gap: 8,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f5f5f5' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <Progress
        type="circle"
        percent={pct}
        size={32}
        strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
        format={() => ''}
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.projectName}
        </div>
        <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>
          {project.completeTypes}/{project.totalTypes} 种资料 · {project.totalFiles} 个文件
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: 10, color: '#999' }}>
          <ClockCircleOutlined style={{ marginRight: 2 }} />
          {dateStr}
        </Text>
      </div>
    </div>
  )
}

interface DashboardCardProps {
  onSelectProject: (project: { name: string; path: string }) => void
  selectedProjectPath?: string
}

export default function DashboardCard({ onSelectProject, selectedProjectPath }: DashboardCardProps) {
  const { projectRoot } = useAppStore()
  const apiReady = useElectronAPI()
  const [data, setData] = useState<AllProjectsDashboard | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!apiReady || !projectRoot) return
    let cancelled = false
    setLoading(true)
    window.electronAPI.scanAllProjectsCompleteness(projectRoot)
      .then(data => { if (!cancelled) setData(data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiReady, projectRoot])

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Spin size="small" />
        <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>加载统计中...</div>
      </div>
    )
  }

  if (!data || !Array.isArray(data.projects) || data.totalProjects === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 12 }}>
        暂无项目数据
      </div>
    )
  }

  return (
    <div style={{
      background: '#fafafa',
      borderRadius: 8,
      padding: '12px 14px',
      marginBottom: 14,
      border: '1px solid #f0f0f0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Space size={4}>
          <DashboardOutlined style={{ color: '#1677ff', fontSize: 12 }} />
          <Text strong style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>项目总览</Text>
        </Space>
        <Badge
          count={`${data.totalProjects} 个项目`}
          style={{ backgroundColor: '#1677ff', fontSize: 10 }}
        />
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>总体健康度</Text>
          <Progress
            percent={data.overallHealth}
            size="small"
            showInfo={false}
            strokeColor={data.overallHealth >= 80 ? '#52c41a' : data.overallHealth >= 50 ? '#fa8c16' : '#ff4d4f'}
            style={{ marginBottom: 2 }}
          />
        </div>
        <div style={{ textAlign: 'center', minWidth: 48 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: data.overallHealth >= 80 ? '#52c41a' : data.overallHealth >= 50 ? '#fa8c16' : '#ff4d4f', lineHeight: 1 }}>
            {data.overallHealth}%
          </div>
          <div style={{ fontSize: 10, color: '#bbb' }}>完整度</div>
        </div>
      </div>

      <Text style={{ fontSize: 10, color: '#bbb', display: 'block', marginBottom: 6 }}>点击项目切换详情</Text>

      <div style={{ maxHeight: 200, overflow: 'auto' }}>
        {(data.projects || []).map(proj => (
          <ProjectRow
            key={proj.projectPath}
            project={proj}
            selected={proj.projectPath === selectedProjectPath}
            onClick={() => onSelectProject({ name: proj.projectName, path: proj.projectPath })}
          />
        ))}
      </div>
    </div>
  )
}
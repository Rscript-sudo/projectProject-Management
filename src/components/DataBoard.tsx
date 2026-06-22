/**
 * 数据看板组件 — 展示项目健康度、活跃度、完整性等核心指标
 */

import React, { useState, useEffect, useRef } from 'react'
import { Typography, Space, Spin, Badge, Progress } from 'antd'
import {
  DashboardOutlined,
  FireOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  WarningOutlined,
  CheckCircleFilled,
} from '@ant-design/icons'
import { useAppStore } from '../stores/useProjectStore'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text } = Typography

// 活跃度颜色
function getActivityColor(lastActivity: string | null): string {
  if (!lastActivity) return '#d9d9d9'
  const days = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
  if (days <= 3) return '#52c41a'
  if (days <= 14) return '#fa8c16'
  if (days <= 30) return '#fa8c16'
  return '#ff4d4f'
}

function getActivityLabel(lastActivity: string | null): string {
  if (!lastActivity) return '无活动'
  const days = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
  if (days <= 1) return '今日活跃'
  if (days <= 3) return '3日内活跃'
  if (days <= 7) return '本周活跃'
  if (days <= 14) return '2周内活跃'
  if (days <= 30) return '1月内活跃'
  return `${Math.floor(days)}天未更新`
}

// 雷达图 SVG
function RadarChart({ completeness, activity, fileCount }: {
  completeness: number
  activity: number
  fileCount: number
}) {
  // 三个维度的 normalized 值 [0, 100]
  const data = [
    { label: '完整度', value: completeness },
    { label: '活跃度', value: activity },
    { label: '规模', value: Math.min(fileCount / 10, 100) },
  ]

  const cx = 50, cy = 50, r = 40
  const angleStep = (2 * Math.PI) / data.length

  // 计算多边形顶点
  const points = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2
    const norm = d.value / 100
    const x = cx + r * norm * Math.cos(angle)
    const y = cy + r * norm * Math.sin(angle)
    return `${x},${y}`
  }).join(' ')

  // 背景六边形网格
  const gridLevels = [0.25, 0.5, 0.75, 1]
  const gridPolygons = gridLevels.map(level => {
    return data.map((_, i) => {
      const angle = i * angleStep - Math.PI / 2
      const x = cx + r * level * Math.cos(angle)
      const y = cy + r * level * Math.sin(angle)
      return `${x},${y}`
    }).join(' ')
  })

  // 轴线
  const axes = data.map((_, i) => {
    const angle = i * angleStep - Math.PI / 2
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    return { x1: cx, y1: cy, x2, y2 }
  })

  return (
    <svg viewBox="0 0 100 100" style={{ width: 100, height: 100 }}>
      {/* 背景网格 */}
      {gridPolygons.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="#e8e8e8" strokeWidth="0.5" />
      ))}
      {/* 轴线 */}
      {axes.map((a, i) => (
        <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="#e8e8e8" strokeWidth="0.5" />
      ))}
      {/* 数据多边形 */}
      <polygon
        points={points}
        fill="rgba(22, 119, 255, 0.15)"
        stroke="#1677ff"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* 数据点 */}
      {data.map((d, i) => {
        const angle = i * angleStep - Math.PI / 2
        const norm = d.value / 100
        const x = cx + r * norm * Math.cos(angle)
        const y = cy + r * norm * Math.sin(angle)
        return <circle key={i} cx={x} cy={y} r="2.5" fill="#1677ff" />
      })}
      {/* 标签 */}
      {data.map((d, i) => {
        const angle = i * angleStep - Math.PI / 2
        const lx = cx + (r + 10) * Math.cos(angle)
        const ly = cy + (r + 10) * Math.sin(angle)
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="7"
            fill="#888"
          >
            {d.label}
          </text>
        )
      })}
    </svg>
  )
}

// 条形图：各阶段完成度
function PhaseBarChart({ phases }: { phases: any[] }) {
  if (!phases || phases.length === 0) return null

  const maxH = 40
  const barW = 28
  const gap = 4
  const totalW = phases.length * (barW + gap)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: gap, height: maxH + 16 }}>
      {phases.map((phase) => {
        const pct = phase.totalCount > 0 ? Math.round((phase.completeCount / phase.totalCount) * 100) : 0
        const barH = (pct / 100) * maxH
        const color = pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'
        return (
          <div key={phase.phase} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div
              style={{
                width: barW,
                height: barH || 2,
                background: barH ? color : '#e8e8e8',
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s',
                minHeight: 2,
              }}
            />
            <Text style={{ fontSize: 9, color: '#bbb' }}>{phase.phaseName.replace('阶段', '')}</Text>
          </div>
        )
      })}
    </div>
  )
}

interface ProjectDashboardData {
  projectName: string
  projectPath: string
  phases: any[]
  totalFiles: number
  totalTypes: number
  completeTypes: number
  lastActivity: string | null
}

interface DataBoardProps {
  onSelectProject: (project: { name: string; path: string }) => void
  selectedProjectPath?: string
}

export default function DataBoard({ onSelectProject, selectedProjectPath }: DataBoardProps) {
  const { projectRoot } = useAppStore()
  const apiReady = useElectronAPI()
  const [allData, setAllData] = useState<{ projects: ProjectDashboardData[]; totalProjects: number; overallHealth: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const cachedProjectRoot = useRef<string>('')
  const cachedData = useRef<{ projects: ProjectDashboardData[]; totalProjects: number; overallHealth: number } | null>(null)

  useEffect(() => {
    if (!apiReady || !projectRoot) return
    // 路径变化时清除旧缓存
    if (projectRoot !== cachedProjectRoot.current) {
      cachedData.current = null
      cachedProjectRoot.current = ''
      setAllData(null)
    }
    // 相同路径且已有缓存，跳过重新获取
    if (projectRoot === cachedProjectRoot.current && cachedData.current !== null) {
      setAllData(cachedData.current)
      return
    }
    let cancelled = false
    setLoading(true)
    window.electronAPI.scanAllProjectsCompleteness(projectRoot)
      .then((data: any) => {
        if (!cancelled) {
          cachedData.current = data
          cachedProjectRoot.current = projectRoot
          setAllData(data)
        }
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiReady, projectRoot])

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Spin size="small" />
        <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>加载看板数据...</div>
      </div>
    )
  }

  if (!allData || allData.totalProjects === 0) {
    return null
  }

  const { projects = [], totalProjects, overallHealth } = allData
  const selectedData = projects.find(p => p.projectPath === selectedProjectPath)

  // 全局统计
  const totalFiles = projects.reduce((s, p) => s + (p.totalFiles || 0), 0)
  const avgCompleteness = overallHealth || 0

  // 活跃项目数（30天内有更新）
  const activeProjects = projects.filter(p => {
    if (!p.lastActivity) return false
    const days = (Date.now() - new Date(p.lastActivity).getTime()) / (1000 * 60 * 60 * 24)
    return days <= 30
  }).length

  // 计算活跃度得分 (0-100)
  const activityScore = totalProjects > 0
    ? Math.round((activeProjects / totalProjects) * 100)
    : 0

  return (
    <div style={{
      background: '#fafafa',
      borderRadius: 8,
      padding: '14px 16px',
      marginBottom: 14,
      border: '1px solid #f0f0f0',
    }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space size={4}>
          <DashboardOutlined style={{ color: '#1677ff', fontSize: 12 }} />
          <Text strong style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>数据看板</Text>
        </Space>
        <Badge
          count={`${totalProjects} 个项目`}
          style={{ backgroundColor: '#1677ff', fontSize: 10 }}
        />
      </div>

      {/* 大字报指标 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
        marginBottom: 14,
      }}>
        {/* 健康度 */}
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: '10px 8px',
          textAlign: 'center',
          border: '1px solid #f0f0f0',
        }}>
          <div style={{
            fontSize: 22,
            fontWeight: 700,
            color: avgCompleteness >= 80 ? '#52c41a' : avgCompleteness >= 50 ? '#fa8c16' : '#ff4d4f',
            lineHeight: 1,
          }}>
            {avgCompleteness}%
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>总体完整度</div>
        </div>

        {/* 活跃项目 */}
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: '10px 8px',
          textAlign: 'center',
          border: '1px solid #f0f0f0',
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1677ff', lineHeight: 1 }}>
            {activeProjects}/{totalProjects}
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>活跃项目</div>
        </div>

        {/* 总文件数 */}
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: '10px 8px',
          textAlign: 'center',
          border: '1px solid #f0f0f0',
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#722ed1', lineHeight: 1 }}>
            {totalFiles}
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>文档总数</div>
        </div>

        {/* 雷达图 */}
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #f0f0f0',
        }}>
          <RadarChart
            completeness={avgCompleteness}
            activity={activityScore}
            fileCount={totalFiles}
          />
        </div>
      </div>

      {/* 选中项目详情 */}
      {selectedData ? (
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: '12px 14px',
          border: '1px solid #e8e8e8',
          marginBottom: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileTextOutlined style={{ color: '#1677ff' }} />
              <Text strong style={{ fontSize: 13 }}>{selectedData.projectName}</Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <FireOutlined style={{ color: getActivityColor(selectedData.lastActivity), fontSize: 11 }} />
              <Text style={{ fontSize: 10, color: getActivityColor(selectedData.lastActivity) }}>
                {getActivityLabel(selectedData.lastActivity)}
              </Text>
            </div>
          </div>

          {/* 阶段完成度条形图 */}
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 10, color: '#bbb', display: 'block', marginBottom: 6 }}>各阶段完成度</Text>
            <PhaseBarChart phases={selectedData.phases || []} />
          </div>

          {/* 项目指标 */}
          <div style={{
            display: 'flex',
            gap: 12,
            paddingTop: 8,
            borderTop: '1px solid #f5f5f5',
          }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
                {selectedData.totalFiles}
              </div>
              <div style={{ fontSize: 10, color: '#bbb' }}>文件数</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
                {selectedData.totalTypes > 0 ? `${Math.round((selectedData.completeTypes / selectedData.totalTypes) * 100)}%` : '0%'}
              </div>
              <div style={{ fontSize: 10, color: '#bbb' }}>完整度</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
                {selectedData.phases?.filter((ph: any) => ph.completeCount === 0).length || 0}
              </div>
              <div style={{ fontSize: 10, color: '#bbb' }}>缺项阶段</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#fff',
          borderRadius: 8,
          padding: '10px 14px',
          border: '1px solid #f0f0f0',
          marginBottom: 10,
          fontSize: 11,
          color: '#bbb',
          textAlign: 'center',
        }}>
          点击项目卡片查看详情
        </div>
      )}

      {/* 项目列表 */}
      <div style={{ maxHeight: 160, overflow: 'auto' }}>
        {projects.map(proj => {
          const pct = proj.totalTypes > 0 ? Math.round((proj.completeTypes / proj.totalTypes) * 100) : 0
          const isSelected = proj.projectPath === selectedProjectPath
          return (
            <div
              key={proj.projectPath}
              onClick={() => onSelectProject({ name: proj.projectName, path: proj.projectPath })}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 6px',
                borderRadius: 6,
                background: isSelected ? '#f0f5ff' : 'transparent',
                border: `1px solid ${isSelected ? '#1677ff' : 'transparent'}`,
                cursor: 'pointer',
                marginBottom: 3,
                gap: 8,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f5f5f5' }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
            >
              <Progress
                type="circle"
                percent={pct}
                size={24}
                strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
                format={() => ''}
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {proj.projectName}
                </div>
                <div style={{ fontSize: 10, color: '#999' }}>
                  {proj.completeTypes}/{proj.totalTypes} 种 · {proj.totalFiles} 个文件
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <ClockCircleOutlined style={{ color: getActivityColor(proj.lastActivity), fontSize: 10 }} />
                <Text style={{ fontSize: 10, color: getActivityColor(proj.lastActivity) }}>
                  {getActivityLabel(proj.lastActivity)}
                </Text>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
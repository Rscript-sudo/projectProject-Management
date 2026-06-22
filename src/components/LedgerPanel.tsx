import { useState, useEffect, useMemo } from 'react'
import { Typography, Input, Spin, Tag, App, Empty } from 'antd'
import { SearchOutlined, FileTextOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { AllLedgersData, LedgerEntry } from '../vite-env'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text } = Typography

interface LedgerPanelProps {
  projectPath: string
  projectName: string
}

// 分类标签颜色
const CATEGORY_COLORS: Record<string, string> = {
  contract: 'blue',
  correspondence: 'purple',
  hazard: 'red',
  meeting: 'green',
  construction: 'orange',
  log: 'cyan',
}

const CATEGORY_LABELS: Record<string, string> = {
  contract: '合同',
  correspondence: '函件',
  hazard: '隐患',
  meeting: '会议',
  construction: '方案',
  log: '日志',
}

export default function LedgerPanel({ projectPath }: LedgerPanelProps) {
  const apiReady = useElectronAPI()
  const { message } = App.useApp()
  const [ledgers, setLedgers] = useState<AllLedgersData | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!apiReady || !projectPath) return
    let cancelled = false
    setLoading(true)
    window.electronAPI.getProjectLedgers(projectPath)
      .then(data => { if (!cancelled) setLedgers(data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiReady, projectPath])

  // 跨所有分类搜索
  const results = useMemo(() => {
    if (!ledgers || !query.trim()) return []

    const q = query.trim().toLowerCase()
    const matches: Array<{ category: string; label: string; entry: LedgerEntry }> = []

    for (const [key, info] of Object.entries(ledgers)) {
      if (!info?.items?.length) continue
      for (const entry of info.items) {
        if ((entry.fileName || '').toLowerCase().includes(q)) {
          matches.push({ category: key, label: info.label, entry })
        }
      }
    }

    return matches
  }, [ledgers, query])

  const handleOpenFile = (entry: LedgerEntry) => {
    if (!projectPath || !entry.subDir) {
      message.info('文件路径未知，无法打开')
      return
    }
    const filePath = `${projectPath}/${entry.subDir || ''}/${entry.fileName}`.replace(/\/+/g, '/')
    window.electronAPI.openFile(filePath)
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="small" />
        <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>加载索引中...</div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>文档搜索</Text>
        {ledgers && (
          <Tag style={{ fontSize: 10, margin: 0, border: 'none', background: '#f5f5f5', color: '#999' }}>
            {Object.values(ledgers).reduce((s, l) => s + (l.items?.length || 0), 0)} 份
          </Tag>
        )}
      </div>

      <Input
        size="small"
        placeholder="搜索文档名称（如：整改通知单）"
        prefix={<SearchOutlined style={{ color: '#bbb' }} />}
        value={query}
        onChange={e => setQuery(e.target.value)}
        allowClear
        style={{ borderRadius: 6, fontSize: 12 }}
      />

      <div style={{ marginTop: 10 }}>
        {!query.trim() ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#bbb' }}>
            <SearchOutlined style={{ fontSize: 22, color: '#d9d9d9', marginBottom: 6 }} />
            <div style={{ fontSize: 11 }}>输入文档名称搜索</div>
          </div>
        ) : results.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ fontSize: 11, color: '#bbb' }}>未找到「{query}」相关文档</span>}
            style={{ margin: '16px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.map((r, i) => (
              <div
                key={`${r.category}-${r.entry.fileName}-${i}`}
                onClick={() => handleOpenFile(r.entry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e6f4ff'; e.currentTarget.style.borderColor = '#91caff' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#f0f0f0' }}
              >
                <FileTextOutlined style={{ color: '#1677ff', fontSize: 12, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.entry.fileName}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <Tag color={CATEGORY_COLORS[r.category] || 'default'} style={{ fontSize: 9, margin: 0, lineHeight: '16px', height: 16, padding: '0 5px' }}>
                      {CATEGORY_LABELS[r.category] || r.label}
                    </Tag>
                    {r.entry.createdAt && (
                      <Text style={{ fontSize: 10, color: '#aaa' }}>{r.entry.createdAt}</Text>
                    )}
                  </div>
                </div>
                <FolderOpenOutlined style={{ color: '#bbb', fontSize: 12, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

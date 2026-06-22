/**
 * 全局搜索组件 — Cmd+K 唤起，支持文件名和内容关键词搜索
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Input, List, Typography, Spin, Badge, Empty } from 'antd'
import { FileTextOutlined, SearchOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useElectronAPI } from '../hooks/useElectronAPI'

const { Text } = Typography

interface SearchResult {
  id: string
  projectName: string
  projectPath: string
  relativePath: string
  fileName: string
  docType: string
  mtime: string
  content?: string
}

interface GlobalSearchProps {
  open: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
}

// 高亮匹配文本
function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <span>{text}</span>
  const parts = text.split(new RegExp(`(${keyword})`, 'gi'))
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase()
          ? <mark key={i} style={{ background: '#ffe58f', padding: '0 1px' }}>{part}</mark>
          : part
      )}
    </span>
  )
}

export default function GlobalSearch({ open, onClose, onOpenFile }: GlobalSearchProps) {
  const apiReady = useElectronAPI()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const inputRef = useRef<any>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 打开时自动聚焦
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // 搜索防抖
  const performSearch = useCallback(async (q: string) => {
    if (!q.trim() || !apiReady) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await window.electronAPI.searchQuery(q.trim(), { limit: 20 })
      setResults(res || [])
    } catch (e) {
      console.error('[GlobalSearch] Query failed:', e)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [apiReady])

  useEffect(() => {
    if (!open) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setSearching(true)
    searchTimerRef.current = setTimeout(() => performSearch(query), 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [query, open, performSearch])

  // 建立索引（首次使用时）
  useEffect(() => {
    if (!open || !apiReady) return
    window.electronAPI.searchStatus()
      .then(async (status: { docCount: number; lastUpdated: string | null }) => {
        if (!status.docCount) {
          // 索引为空，先建立索引
          setRebuilding(true)
          try {
            await window.electronAPI.searchRebuild((current: number, total: number) => {
              // 进度回调，暂不展示详细信息
            })
          } catch (e) {
            console.warn('[GlobalSearch] Index rebuild failed:', e)
          } finally {
            setRebuilding(false)
          }
        }
      })
      .catch(e => {
        console.warn('[GlobalSearch] Status check failed:', e)
      })
  }, [open, apiReady])

  const handleResultClick = (result: SearchResult) => {
    onOpenFile(result.id)
    onClose()
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      centered
      styles={{ body: { padding: 0 } }}
    >
      {/* 搜索框 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        gap: 10,
      }}>
        <SearchOutlined style={{ color: '#bbb', fontSize: 16, flexShrink: 0 }} />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索文件名、内容、文档类型..."
          variant="borderless"
          style={{ fontSize: 15 }}
          onPressEnter={() => performSearch(query)}
        />
        {loading && <Spin size="small" />}
      </div>

      {/* 结果列表 */}
      <div style={{ maxHeight: 400, overflow: 'auto', padding: '8px 0' }}>
        {!apiReady ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
            系统初始化中...
          </div>
        ) : results.length === 0 && query.trim() && !loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
            <Empty description={`未找到"${query}"相关文档`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : results.length === 0 && !query.trim() ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#bbb', fontSize: 12 }}>
            {rebuilding ? (
              <span style={{ color: '#1677ff' }}>正在建立索引，请稍候...</span>
            ) : (
              <>输入关键词开始搜索，支持：文件名、内容、文档类型</>
            )}
          </div>
        ) : (
          <List
            dataSource={results}
            renderItem={(item: SearchResult) => (
              <List.Item
                key={item.id}
                onClick={() => handleResultClick(item)}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: '#e6f4ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <FileTextOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                    </div>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Highlight text={item.fileName} keyword={query} />
                      <Badge
                        count={item.docType}
                        style={{ fontSize: 10, background: '#f0f0f0', color: '#888' }}
                      />
                    </div>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      <span style={{ color: '#1677ff' }}>{item.projectName}</span>
                      <span style={{ margin: '0 4px', color: '#d9d9d9' }}>·</span>
                      {item.relativePath}
                      <span style={{ margin: '0 4px', color: '#d9d9d9' }}>·</span>
                      <ClockCircleOutlined style={{ marginRight: 2 }} />
                      {formatDate(item.mtime)}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>

      {/* 底部提示 */}
      {results.length > 0 && (
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid #f0f0f0',
          fontSize: 11,
          color: '#bbb',
          display: 'flex',
          gap: 12,
        }}>
          <span>↑↓ 导航</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      )}
    </Modal>
  )
}
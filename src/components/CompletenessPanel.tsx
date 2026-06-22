import { Button, Collapse, Badge, Tooltip, Progress, Typography, Alert } from 'antd'
import {
  CheckCircleFilled,
  WarningFilled,
  MinusCircleFilled,
  PlusOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import React, { useState, useEffect, useMemo } from 'react'
import type { ScanCompletenessResult, PhaseGroup, DocTypeStatus } from '../vite-env'

const { Text } = Typography

const STATUS_CONFIG = {
  complete: { icon: <CheckCircleFilled style={{ color: '#52c41a' }} />, color: '#f6ffed', border: '#b7eb8f' },
  partial: { icon: <WarningFilled style={{ color: '#fa8c16' }} />, color: '#fffbe6', border: '#ffe58f' },
  missing: { icon: <MinusCircleFilled style={{ color: '#d9d9d9' }} />, color: '#fafafa', border: '#e8e8e8' },
} as const

const DocTypeRow = React.memo(function DocTypeRow({ item, onCreate }: { item: DocTypeStatus; onCreate: (docType: string) => void }) {
  const status = item.status || 'missing'
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.missing
  const dateStr = item.lastModified
    ? new Date(item.lastModified).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '6px 8px',
      borderRadius: 6,
      background: cfg.color,
      border: `1px solid ${cfg.border}`,
      marginBottom: 4,
      gap: 8,
    }}>
      <Tooltip title={status === 'complete' ? '已有文件' : status === 'partial' ? '部分文件' : '暂无文件'}>
        {cfg.icon}
      </Tooltip>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.docType}
        </div>
        <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>
          {(item.fileCount || 0) > 0 ? `${item.fileCount} 个文件` : '无文件'}
          {dateStr && ` · ${dateStr}`}
        </div>
      </div>
      {status !== 'complete' && (
        <Tooltip title={`使用模板创建${item.docType}`}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined style={{ fontSize: 11 }} />}
            onClick={() => onCreate(item.docType)}
            style={{ fontSize: 11, padding: '0 4px', height: 22 }}
          >
            创建
          </Button>
        </Tooltip>
      )}
    </div>
  )
})

function PhaseSection({ group, onCreate }: { group: PhaseGroup; onCreate: (docType: string) => void }) {
  return (
    <div style={{ padding: '2px 0' }}>
      {(group.items || []).map(item => (
        <DocTypeRow key={item.docType} item={item} onCreate={onCreate} />
      ))}
    </div>
  )
}

// 优先级定义：阶段顺序 + 关键文档
const PHASE_ORDER = ['01_项目前期', '02_准备阶段', '03_实施阶段', '04_验收阶段']
const KEY_DOCS = [
  { docType: '监理规划', phase: '02_准备阶段' },
  { docType: '监理细则', phase: '02_准备阶段' },
  { docType: '总监任命书', phase: '02_准备阶段' },
  { docType: '开工条件检查表', phase: '02_准备阶段' },
  { docType: '施工组织设计报审', phase: '02_准备阶段' },
  { docType: '监理日志', phase: '03_实施阶段' },
  { docType: '监理周报', phase: '03_实施阶段' },
  { docType: '监理月报', phase: '03_实施阶段' },
  { docType: '监理整改通知书', phase: '03_实施阶段' },
  { docType: '会议纪要', phase: '03_实施阶段' },
]

interface CompletenessPanelProps {
  result: ScanCompletenessResult
  onCreateDoc: (docType: string) => void
}

export default function CompletenessPanel({ result, onCreateDoc }: CompletenessPanelProps) {
  const { phases = [], totalTypes = 0, completeTypes = 0, totalFiles = 0 } = result
  const pct = totalTypes > 0 ? Math.round((completeTypes / totalTypes) * 100) : 0

  // 默认展开所有阶段
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(phases.map(g => g.phase)))

  // phases 变化时重置展开状态（切换项目时）
  useEffect(() => {
    setExpandedKeys(new Set(phases.map(g => g.phase)))
  }, [phases])

  // 智能推荐：按阶段顺序找出前 3 个缺失的"关键文档"
  const suggestions = useMemo(() => {
    const tips: { phase: string; phaseName: string; docType: string }[] = []
    const allItems = phases.flatMap(g => g.items || [])

    // 1. 优先按阶段顺序找关键文档缺失
    for (const keyDoc of KEY_DOCS) {
      if (tips.length >= 3) break
      const target = allItems.find(i => i.docType === keyDoc.docType && i.phase === keyDoc.phase)
      if (target && target.status !== 'complete') {
        const phaseGroup = phases.find(g => g.phase === keyDoc.phase)
        tips.push({
          phase: keyDoc.phase,
          phaseName: phaseGroup?.phaseName || keyDoc.phase,
          docType: keyDoc.docType,
        })
      }
    }

    // 2. 不足 3 条时，补充当前阶段的任意缺失文档
    if (tips.length < 3) {
      for (const phase of PHASE_ORDER) {
        if (tips.length >= 3) break
        const phaseGroup = phases.find(g => g.phase === phase)
        if (!phaseGroup) continue
        for (const item of phaseGroup.items || []) {
          if (tips.length >= 3) break
          if (item.status === 'complete') continue
          if (tips.find(t => t.docType === item.docType && t.phase === phase)) continue
          tips.push({
            phase,
            phaseName: phaseGroup.phaseName,
            docType: item.docType,
          })
        }
      }
    }

    return tips
  }, [phases])

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text strong style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>资料完整性检查</Text>
        <Badge
          count={`${completeTypes}/${totalTypes}`}
          style={{ backgroundColor: pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f' }}
        />
      </div>

      <Progress
        percent={pct}
        size="small"
        showInfo={false}
        strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
        style={{ marginBottom: 12 }}
      />

      <div style={{ fontSize: 11, color: '#999', marginBottom: 10 }}>
        共 {totalFiles} 个文件，{completeTypes}/{totalTypes} 种资料已完善
      </div>

      {/* 智能建议 */}
      {suggestions.length > 0 && (
        <Alert
          type="info"
          showIcon
          icon={<BulbOutlined />}
          message={
            <Text style={{ fontSize: 12 }}>建议优先补全</Text>
          }
          description={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {suggestions.map((s, idx) => (
                <div key={`${s.phase}-${s.docType}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 11, color: '#888', minWidth: 16 }}>{idx + 1}.</Text>
                  <Text style={{ fontSize: 12, flex: 1 }}>
                    <Text strong>{s.docType}</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>（{s.phaseName}）</Text>
                  </Text>
                  <Button
                    type="link"
                    size="small"
                    style={{ fontSize: 11, padding: 0, height: 20 }}
                    onClick={() => onCreateDoc(s.docType)}
                  >
                    立即生成 →
                  </Button>
                </div>
              ))}
            </div>
          }
          style={{ marginBottom: 12, padding: '8px 10px' }}
        />
      )}

      <Collapse
        ghost
        size="small"
        activeKey={Array.from(expandedKeys) as string[]}
        onChange={(keys) => setExpandedKeys(new Set(Array.isArray(keys) ? keys : keys || []))}
        items={phases.map(group => ({
          key: group.phase,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{group.phaseName}</span>
              <Badge
                count={`${group.completeCount}/${group.totalCount}`}
                style={{
                  backgroundColor: group.completeCount === group.totalCount ? '#52c41a' : group.completeCount > 0 ? '#fa8c16' : '#d9d9d9',
                  fontSize: 10,
                }}
              />
            </div>
          ),
          children: <PhaseSection group={group} onCreate={onCreateDoc} />,
        }))}
      />
    </div>
  )
}
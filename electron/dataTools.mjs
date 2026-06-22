/**
 * DataTool 注册表 — AI 数据查询工具
 *
 * 每个工具定义：
 *  - id / name：唯一标识和展示名
 *  - keywords：用户输入中的关键词（用于渲染进程意图匹配）
 *  - query(projectName)：返回结构化数据（给 LLM 格式化用）
 *  - summary：工具功能简述（给 LLM 理解用）
 *
 * 设计原则：
 *  - 查询只针对选定项目（projectName 必传）
 *  - 输出是聚合过的结构化数据，而非原始 SQL 行
 *  - 失败时返回空数据，不抛异常
 */

import { getDb } from './db/database.mjs'

function safeQuery(fn) {
  try {
    return fn()
  } catch (e) {
    console.error('[dataTools] query failed:', e.message)
    return {}
  }
}

export const DATA_TOOLS = [
  // ==================== 进度 ====================
  {
    id: 'progress_summary',
    name: '进度概况',
    keywords: ['进度', '进展', '滞后', '延误', '完成率', '百分比', '横道图', '计划', '节点'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const nodes = db.prepare(
        'SELECT * FROM progress_node WHERE project_name = ? ORDER BY plan_start ASC'
      ).all(projectName)

      const total = nodes.length
      const completed = nodes.filter(n => n.progress_percent >= 100).length
      const today = new Date().toISOString().split('T')[0]
      const delayed = nodes.filter(n =>
        n.progress_percent < 100 && !n.actual_end
        && n.plan_end && n.plan_end < today
      ).length
      const totalWeight = nodes.reduce((s, n) => s + n.weight, 0)
      const weightedPct = totalWeight > 0
        ? (nodes.reduce((s, n) => s + n.progress_percent * n.weight, 0) / totalWeight).toFixed(1)
        : '0.0'

      return {
        总节点数: total,
        已完成: completed,
        滞后: delayed,
        进行中: total - completed - delayed,
        加权总进度: `${weightedPct}%`,
        节点详情: nodes.map(n => ({
          名称: n.name,
          计划: `${n.plan_start || '—'} ~ ${n.plan_end || '—'}`,
          实际: n.actual_start ? `${n.actual_start || ''} ~ ${n.actual_end || '进行中'}` : '未开始',
          进度: `${n.progress_percent}%`,
          权重: n.weight,
        })),
      }
    }),
    summary: '获取当前项目的进度节点完成情况及滞后统计',
  },

  // ==================== 隐患 ====================
  {
    id: 'hazard_open',
    name: '未闭环隐患',
    keywords: ['隐患', '安全问题', '未整改', '危险源', '安全风险', '整改'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const all = db.prepare(
        "SELECT * FROM hazard WHERE project_name = ? ORDER BY created_at DESC"
      ).all(projectName)
      const open = all.filter(h => h.status !== '已关闭')

      return {
        总隐患数: all.length,
        未闭环: open.length,
        隐患清单: open.map(h => ({
          位置: h.location || '—',
          描述: h.description || '—',
          严重程度: h.severity,
          状态: h.status,
          截止期限: h.deadline || '—',
          维度: h.dimension_name || h.dimension || '—',
          创建时间: h.created_at ? h.created_at.slice(0, 10) : '—',
        })),
      }
    }),
    summary: '获取当前项目的未闭环隐患清单',
  },

  // ==================== 付款 ====================
  {
    id: 'payment_status',
    name: '付款状态',
    keywords: ['付款', '支付', '资金', '进度款', '审批', '投资'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const requests = db.prepare(
        'SELECT * FROM payment_request WHERE project_name = ? ORDER BY created_at DESC'
      ).all(projectName)
      const totalRequested = requests.reduce((s, r) => s + r.amount, 0)
      const approved = requests.filter(r => r.status === '已通过' || r.status === '已支付')

      return {
        付款申请总数: requests.length,
        累计申请金额: totalRequested,
        已审批金额: approved.reduce((s, r) => s + r.amount, 0),
        审批中笔数: requests.filter(r => r.status === '审批中').length,
        付款记录: requests.slice(0, 10).map(r => ({
          期次: r.period,
          申请金额: r.amount,
          状态: r.status,
          审批阶段: r.approval_stage,
          累计支付: r.cumulative_amount || 0,
          累计占比: r.cumulative_percent ? `${r.cumulative_percent}%` : '—',
        })),
      }
    }),
    summary: '获取当前项目的付款申请和审批状态',
  },

  // ==================== 合同 ====================
  {
    id: 'contract_overview',
    name: '合同概况',
    keywords: ['合同', '签约', '甲方', '乙方', '合同额', '采购'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const contracts = db.prepare(
        'SELECT * FROM contract WHERE project_name = ? ORDER BY created_at DESC'
      ).all(projectName)

      return {
        合同总数: contracts.length,
        总合同额: contracts.reduce((s, c) => s + (c.amount || 0), 0),
        合同列表: contracts.map(c => ({
          名称: c.contract_name,
          类型: c.contract_type || '—',
          甲方: c.party_a || '—',
          乙方: c.party_b || '—',
          金额: c.amount || 0,
          状态: c.status,
          起止: c.start_date ? `${c.start_date} ~ ${c.end_date || '—'}` : '—',
        })),
      }
    }),
    summary: '获取当前项目的合同列表和金额统计',
  },

  // ==================== 函件/台账 ====================
  {
    id: 'correspondence_recent',
    name: '近期函件',
    keywords: ['函件', '通知', '联系单', '台账', '发文', '收文', '发出'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const items = db.prepare(
        'SELECT * FROM correspondence WHERE project_name = ? ORDER BY created_at DESC LIMIT 20'
      ).all(projectName)

      return {
        函件总数: items.length,
        函件列表: items.map(c => ({
          类型: c.doc_type,
          编号: c.file_number || '—',
          事由: c.subject || '—',
          被致送单位: c.respondent || '—',
          状态: c.status,
          期限: c.deadline || '—',
          日期: c.created_at ? c.created_at.slice(0, 10) : '—',
        })),
      }
    }),
    summary: '获取当前项目近期发出的函件台账',
  },

  // ==================== 项目基本信息 ====================
  {
    id: 'project_meta',
    name: '项目基本信息',
    keywords: ['项目信息', '基本信息', '概况', '参建单位', '项目类型'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const meta = db.prepare(
        'SELECT * FROM project_meta WHERE project_name = ?'
      ).get(projectName)

      if (!meta) return {}

      return {
        项目名称: meta.project_name,
        项目类型: meta.project_type || '—',
        建设单位: meta.owner_unit || '—',
        施工单位: meta.contractor || '—',
        监理单位: meta.supervisor_unit || '—',
        总监理工程师: meta.chief_engineer || '—',
        合同金额: meta.contract_amount || '—',
        工期: meta.start_date ? `${meta.start_date} ~ ${meta.end_date || '—'}` : '—',
      }
    }),
    summary: '获取当前项目的基本信息和参建单位',
  },

  // ==================== 照片归档 ====================
  {
    id: 'photo_recent',
    name: '近期照片',
    keywords: ['照片', '影像', '拍照', '图片', '归档'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const photos = db.prepare(
        'SELECT * FROM photo WHERE project_name = ? ORDER BY created_at DESC LIMIT 20'
      ).all(projectName)

      return {
        照片总数: photos.length,
        照片列表: photos.map(p => ({
          文件名: p.file_name,
          拍摄部位: p.location || '—',
          拍摄日期: p.shoot_date || '—',
          标签: p.tags || '—',
          描述: p.description || '—',
        })),
      }
    }),
    summary: '获取当前项目的最新归档照片信息',
  },

  // ==================== 照片扫描归档 ====================
  {
    id: 'photo_scan',
    name: '照片归档',
    keywords: ['照片', '照片归档', '整理照片', '归档照片', '扫描照片', '重命名', '整理图片'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const months = db.prepare(
        "SELECT DISTINCT substr(shoot_date,1,7) as month, COUNT(*) as count FROM photo WHERE project_name = ? GROUP BY month ORDER BY month DESC LIMIT 12"
      ).all(projectName)
      const total = db.prepare("SELECT COUNT(*) as c FROM photo WHERE project_name = ?").get(projectName)

      return {
        照片总数: total?.c || 0,
        归档月份: months.map(m => `${m.month}（${m.count}张）`),
      }
    }),
    summary: '检查当前项目照片归档状态',
  },

  // ==================== 变更与索赔 ====================
  {
    id: 'change_claim',
    name: '变更与索赔',
    keywords: ['变更', '索赔', '签证', '增减'],
    query: (projectName) => safeQuery(() => {
      const db = getDb()
      const changes = db.prepare(
        'SELECT * FROM change_order WHERE project_name = ? ORDER BY created_at DESC'
      ).all(projectName)
      const claims = db.prepare(
        'SELECT * FROM claim WHERE project_name = ? ORDER BY created_at DESC'
      ).all(projectName)

      return {
        变更单: {
          总数: changes.length,
          列表: changes.map(c => ({
            编号: c.change_number || '—',
            事由: c.subject || '—',
            金额变化: c.amount_change || 0,
            工期变化: c.schedule_change ? `${c.schedule_change}天` : '—',
            状态: c.status,
          })),
        },
        索赔: {
          总数: claims.length,
          列表: claims.map(c => ({
            编号: c.claim_number || '—',
            事由: c.subject || '—',
            索赔金额: c.amount || 0,
            索赔方: c.claimant || '—',
            状态: c.status,
          })),
        },
      }
    }),
    summary: '获取当前项目的工程变更和索赔信息',
  },
]

/**
 * 根据用户输入关键词匹配对应的 DataTool ID 列表
 * @param {string} input - 用户输入
 * @returns {string[]} 匹配的工具 ID 数组
 */
export function matchDataTools(input) {
  const lower = input.toLowerCase()
  const matched = new Set()

  for (const tool of DATA_TOOLS) {
    for (const kw of tool.keywords) {
      if (lower.includes(kw)) {
        matched.add(tool.id)
        break
      }
    }
  }

  // 如果用户提到"项目情况"、"总体情况"等宽泛词，返回所有核心工具
  if (/项目情况|总体|全貌|总览|整体|概况/.test(lower)) {
    for (const t of DATA_TOOLS) matched.add(t.id)
  }

  return [...matched]
}

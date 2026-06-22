/**
 * 照片归档 IPC — 拖拽上传、按月归档、AI 智能归档
 * 数据源：SQLite photo 表（B1 已建）
 * 文件落地：项目下 04_照片档案/{YYYY-MM}/{部位}/原始.jpg
 */

import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'

// 支持的图片扩展名
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif'])

/** 递归扫描目录下的所有图片文件 */
function scanImageFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...scanImageFiles(fullPath))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (IMAGE_EXTS.has(ext)) {
        results.push(fullPath)
      }
    }
  }
  return results
}

/** 从文件名或文件元数据中提取拍摄日期 */
function extractShootDate(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath))
  // 尝试从文件名中提取日期：20260101 或 2026-01-01 或 2026_01_01
  const dateMatch = fileName.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/)
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
  }
  // 回退：文件修改时间
  try {
    const stat = fs.statSync(filePath)
    const d = stat.mtime
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** 从文件路径推断可能的部位关键词 */
function inferLocationFromPath(filePath, projectPath) {
  const rel = path.relative(projectPath, filePath)
  const parts = rel.split(path.sep).filter(Boolean)
  // 取文件所在目录名作为部位线索（跳过顶层项目目录）
  if (parts.length >= 2) {
    return parts[parts.length - 2] || '未分类'
  }
  return '未分类'
}

/** 标准化文件名：YYYYMMDD_部位_描述_NNN.jpg */
function generateStandardName(date, location, description, index) {
  const dateStr = date.replace(/-/g, '')
  const loc = location.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 20)
  const desc = (description || '').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 30)
  const idx = String(index).padStart(3, '0')
  return `${dateStr}_${loc}_${desc}_${idx}.jpg`
}

export function register(ipcMain) {
  // 列表
  ipcMain.handle('photo:list', safeCall((_, { projectPath, yearMonth, location, limit }) => {
    const projectName = path.basename(projectPath)
    return repo.listPhotos(projectName, { yearMonth, location, limit })
  }))

  // 月份列表（用于按月归档侧栏）
  ipcMain.handle('photo:months', safeCall((_, { projectPath }) => {
    const projectName = path.basename(projectPath)
    const all = repo.listPhotos(projectName, { limit: 10000 })
    const months = {}
    for (const p of all) {
      const ym = (p.shoot_date || '').slice(0, 7)
      if (!ym) continue
      months[ym] = (months[ym] || 0) + 1
    }
    return Object.entries(months)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, count]) => ({ month, count }))
  }))

  // 新增
  ipcMain.handle('photo:add', safeCall((_, { projectPath, photo }) => {
    const projectName = path.basename(projectPath)
    const id = repo.insertPhoto({ project_name: projectName, ...photo })
    repo.logAudit(projectName, 'photo.add', 'photo', id, { file_name: photo.file_name })
    return { success: true, id }
  }))

  // 删除
  ipcMain.handle('photo:delete', safeCall((_, { id }) => {
    const db = repo.getDb()
    const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(id)
    if (!row) return { success: false }
    if (row.file_path && fs.existsSync(row.file_path)) {
      try { fs.unlinkSync(row.file_path) } catch {}
    }
    db.prepare('DELETE FROM photo WHERE id = ?').run(id)
    return { success: true }
  }))

  // 更新元数据
  ipcMain.handle('photo:update', safeCall((_, { id, updates }) => {
    const db = repo.getDb()
    const allowed = ['location', 'tags', 'description', 'linked_hazard_id', 'linked_node_id']
    const fields = []
    const params = []
    for (const k of allowed) {
      if (updates[k] !== undefined) {
        fields.push(`${k} = ?`)
        params.push(updates[k])
      }
    }
    if (!fields.length) return { success: false, error: '无可更新字段' }
    params.push(id)
    db.prepare(`UPDATE photo SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return { success: true }
  }))

  // 手动归档单个文件
  ipcMain.handle('photo:archive', safeCall(async (_, { projectPath, srcPath, shootDate, location, tags, description }) => {
    const projectName = path.basename(projectPath)
    if (!fs.existsSync(srcPath)) return { success: false, error: '源文件不存在' }

    const ym = (shootDate || new Date().toISOString().slice(0, 10)).slice(0, 7)
    const loc = (location || '未分类').replace(/[\/\\:*?"<>|]/g, '_')
    const archiveDir = path.join(projectPath, '04_照片档案', ym, loc)
    fs.mkdirSync(archiveDir, { recursive: true })

    const ext = path.extname(srcPath) || '.jpg'
    const baseName = path.basename(srcPath, ext)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const fileName = `${baseName}_${stamp}${ext}`
    const destPath = path.join(archiveDir, fileName)

    fs.copyFileSync(srcPath, destPath)

    const id = repo.insertPhoto({
      project_name: projectName,
      file_name: fileName,
      file_path: destPath,
      shoot_date: shootDate || new Date().toISOString().slice(0, 10),
      location: loc,
      tags: tags || '',
      description: description || '',
    })
    repo.logAudit(projectName, 'photo.archive', 'photo', id, { location: loc })
    return { success: true, id, destPath }
  }))

  // ===== AI 智能归档 =====
  // 扫描目录 → 自动分析文件名/路径 → 按月份+部位重命名 → 移动到归档目录
  ipcMain.handle('photo:aiArchive', safeCall(async (_, { projectPath, scanDir, aiConfig }) => {
    const projectName = path.basename(projectPath)
    if (!fs.existsSync(scanDir)) return { success: false, error: '扫描目录不存在' }

    // 1. 扫描图片
    const allFiles = scanImageFiles(scanDir)
    if (allFiles.length === 0) return { success: true, total: 0, archived: 0, message: '未发现图片文件' }

    // 2. 提取每个文件的元数据
    const fileInfos = allFiles.map(fp => {
      const shootDate = extractShootDate(fp)
      const locFromPath = inferLocationFromPath(fp, projectPath)
      return {
        path: fp,
        name: path.basename(fp),
        shootDate,
        month: shootDate.slice(0, 7),
        locationHint: locFromPath,
        size: fs.statSync(fp).size,
      }
    })

    // 3. AI 批量分析（分批，每批最多 50 张）
    const BATCH_SIZE = 50
    const results = []

    for (let i = 0; i < fileInfos.length; i += BATCH_SIZE) {
      const batch = fileInfos.slice(i, i + BATCH_SIZE)
      const namesText = batch.map((f, idx) =>
        `  ${i + idx + 1}. 文件名="${f.name}"  路径线索="${f.locationHint}"  日期=${f.shootDate}`
      ).join('\n')

      // 如果没有配置 AI，用路径推断（降级方案）
      if (!aiConfig?.apiKey) {
        for (const f of batch) {
          results.push({
            srcPath: f.path,
            shootDate: f.shootDate,
            location: f.locationHint,
            description: f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
            tags: f.locationHint,
          })
        }
        continue
      }

      // 有 AI 配置：调用 LLM 分析文件名
      try {
        const url = aiConfig.baseUrl
          ? `${aiConfig.baseUrl}/chat/completions`
          : 'https://api.deepseek.com/chat/completions'

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.apiKey || ''}`,
          },
          body: JSON.stringify({
            model: aiConfig.model || 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: `你是工程现场照片管理助手。根据文件名和路径线索，推断每张照片的拍摄部位、描述和标签。

返回 JSON 数组，每个元素格式：
{
  "index": 序号(从1开始),
  "location": "部位名称（如"机房"、"弱电间"、"配电室"），2-6个字",
  "description": "简短描述（8-20字）",
  "tags": "逗号分隔的关键词标签"
}

要求：
- 部位名称要有工程现场感，不要编造
- 描述基于文件名中的线索合理推测
- 不确定的标注"待确认"`,
              },
              { role: 'user', content: `请分析以下 ${batch.length} 张现场照片：\n${namesText}` },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        })

        if (!resp.ok) {
          // API 调用失败，降级用路径推断
          for (const f of batch) {
            results.push({
              srcPath: f.path,
              shootDate: f.shootDate,
              location: f.locationHint,
              description: f.name.replace(/\.[^.]+$/, ''),
              tags: f.locationHint,
            })
          }
          continue
        }

        const data = await resp.json()
        let parsed = []
        try {
          const text = data.choices?.[0]?.message?.content || '[]'
          const json = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
          parsed = JSON.parse(json)
        } catch {
          // 解析失败，降级
          for (const f of batch) {
            parsed.push({
              index: batch.indexOf(f) + 1,
              location: f.locationHint,
              description: f.name.replace(/\.[^.]+$/, ''),
              tags: f.locationHint,
            })
          }
        }

        for (const item of parsed) {
          const idx = (item.index || 1) - 1
          const f = batch[idx] || batch[0]
          results.push({
            srcPath: f.path,
            shootDate: f.shootDate,
            location: item.location || f.locationHint,
            description: item.description || f.name.replace(/\.[^.]+$/, ''),
            tags: item.tags || f.locationHint,
          })
        }
      } catch (e) {
        // 网络异常，降级
        for (const f of batch) {
          results.push({
            srcPath: f.path,
            shootDate: f.shootDate,
            location: f.locationHint,
            description: f.name.replace(/\.[^.]+$/, ''),
            tags: f.locationHint,
          })
        }
      }
    }

    // 4. 按月份分组归档（直接执行，不交互）
    const byMonth = {}
    for (const r of results) {
      const month = r.shootDate.slice(0, 7)
      if (!byMonth[month]) byMonth[month] = []
      byMonth[month].push(r)
    }

    let archived = 0
    const archiveLog = []

    for (const [month, files] of Object.entries(byMonth)) {
      // 按月内按部位分组
      const byLoc = {}
      for (const f of files) {
        if (!byLoc[f.location]) byLoc[f.location] = []
        byLoc[f.location].push(f)
      }

      for (const [loc, group] of Object.entries(byLoc)) {
        const locSafe = loc.replace(/[\/\\:*?"<>|]/g, '_')
        const archiveDir = path.join(projectPath, '04_照片档案', month, locSafe)
        fs.mkdirSync(archiveDir, { recursive: true })

        group.forEach((file, idx) => {
          const ext = path.extname(file.srcPath) || '.jpg'
          const newName = generateStandardName(file.shootDate, file.location, file.description, idx + 1)
          const destPath = path.join(archiveDir, newName)

          try {
            fs.copyFileSync(file.srcPath, destPath)
            const id = repo.insertPhoto({
              project_name: projectName,
              file_name: newName,
              file_path: destPath,
              shoot_date: file.shootDate,
              location: file.location,
              tags: file.tags || '',
              description: file.description || '',
            })
            archived++
            archiveLog.push({ src: file.srcPath, dest: destPath, id })
          } catch (e) {
            console.error(`[photo:aiArchive] copy failed: ${file.srcPath}`, e.message)
          }
        })
      }
    }

    repo.logAudit(projectName, 'photo.aiArchive', 'photo', 0, {
      total: allFiles.length,
      archived,
      months: Object.keys(byMonth),
    })

    return {
      success: true,
      total: allFiles.length,
      archived,
      months: Object.keys(byMonth),
      summary: `发现 ${allFiles.length} 张图片，已归档 ${archived} 张到 ${Object.keys(byMonth).length} 个月份目录`,
    }
  }))
}

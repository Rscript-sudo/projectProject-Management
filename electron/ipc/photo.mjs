/**
 * 照片归档 IPC — 拖拽上传、按月归档、AI 智能归档
 * 数据源：SQLite photo 表（B1 已建）
 * 文件落地：项目下 04_照片档案/{YYYY-MM}/{部位}/原始.jpg
 */

import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { getSettings } from './shared.mjs'
import * as repo from '../db/repo.mjs'
import { getDb } from '../db/database.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'
import { resolveAvailableFileName } from '../shared/fileNameCollision.mjs'

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
  } catch (e) {
    console.warn('[photo] 读取文件时间失败，用当前日期兜底:', e.message)
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
function generateStandardName(date, location, description, index, extension = '.jpg') {
  const dateStr = date.replace(/-/g, '')
  const loc = location.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 20)
  const desc = (description || '').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 30)
  const idx = String(index).padStart(3, '0')
  const ext = IMAGE_EXTS.has(String(extension).toLowerCase()) ? String(extension).toLowerCase() : '.jpg'
  return `${dateStr}_${loc}_${desc}_${idx}${ext}`
}

/** OpenAI 兼容图文接口使用的 data URL；过大或不兼容格式仅使用文件线索。 */
function imageDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : null
  if (!mime || fs.statSync(filePath).size > 12 * 1024 * 1024) return null
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
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
    const db = getDb()
    const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(id)
    if (!row) return { success: false }
    const relationCount = repo.countBusinessRelations(row.project_name, 'photo', id)
    if (relationCount > 0) return { success: false, error: `该照片存在 ${relationCount} 条业务关联，请先解除关联后再删除` }
    // v1.2.1 P0 修复：删前 isPathSafe 校验，防 photo:update 改 file_path 绕过
    if (row.file_path) {
      if (!isPathSafe(row.file_path)) {
        return { success: false, error: `文件路径不安全，拒绝删除：${row.file_path}` }
      }
      if (fs.existsSync(row.file_path)) {
        try { fs.unlinkSync(row.file_path) } catch {}
      }
    }
    db.prepare('DELETE FROM photo WHERE id = ?').run(id)
    return { success: true }
  }))

  // 更新元数据
  ipcMain.handle('photo:update', safeCall((_, { id, updates }) => {
    const db = getDb()
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
    const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(id)
    if (row && updates.linked_hazard_id) repo.createBusinessRelation({
      project_name: row.project_name, source_type: 'photo', source_id: id,
      target_type: 'hazard', target_id: updates.linked_hazard_id, relation_type: 'hazard_evidence',
    })
    if (row && updates.linked_node_id) repo.createBusinessRelation({
      project_name: row.project_name, source_type: 'photo', source_id: id,
      target_type: 'progress_node', target_id: updates.linked_node_id, relation_type: 'progress_evidence',
    })
    return { success: true }
  }))

  // 手动归档单个文件
  ipcMain.handle('photo:archive', safeCall(async (_, { projectPath, srcPath, shootDate, location, tags, description }) => {
    if (!projectPath || !isPathSafe(projectPath)) return { success: false, error: '项目路径不安全' }
    if (!srcPath || !isPathSafe(srcPath)) return { success: false, error: '源文件路径不安全' }
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
    if (!projectPath || !isPathSafe(projectPath)) return { success: false, error: '项目路径不安全' }
    if (!scanDir || !isPathSafe(scanDir)) return { success: false, error: '扫描目录不安全' }
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

    // 3. AI 批量分析：文本和图片共用当前 API / 模型配置。
    const settings = getSettings()
    const selectedModel = aiConfig?.model || settings.model || ''
    const BATCH_SIZE = 6
    const results = []

    for (let i = 0; i < fileInfos.length; i += BATCH_SIZE) {
      const batch = fileInfos.slice(i, i + BATCH_SIZE)
      // 如果没有配置 AI（前端 hasApiKey=false 或显式禁用），用路径推断（降级方案）
      const apiKey = aiConfig?.apiKey || settings.apiKey
      if (!apiKey) {
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

      // 有 AI 配置：使用当前模型识别真实图片内容。
      try {
        const baseUrl = aiConfig?.baseUrl || settings.baseUrl
        const url = baseUrl
          ? `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
          : 'https://api.deepseek.com/chat/completions'
        const userContent = [
              { type: 'text', text: `请逐张识别以下 ${batch.length} 张工程现场图片，按图片前的序号返回结果。` },
              ...batch.flatMap((f, idx) => {
                const dataUrl = imageDataUrl(f.path)
                const label = { type: 'text', text: `\n${idx + 1}. 文件名="${f.name}" 路径线索="${f.locationHint}" 日期=${f.shootDate}` }
                return dataUrl ? [label, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] : [label]
              }),
            ]

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: selectedModel || 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: `你是工程现场图片识别与归档助手。有图片时必须以图像内容为主，结合文件名和路径线索，识别工程部位、工序或设备、现场状态、简短描述和标签。

返回 JSON 数组，每个元素格式：
{
  "index": 序号(从1开始),
  "location": "部位名称（如"机房"、"弱电间"、"配电室"），2-6个字",
  "description": "简短描述（8-20字）",
  "tags": "逗号分隔的关键词标签"
}

要求：
- 不得凭空编造项目名、楼层、轴线、设备编号和隐患结论
- 描述要包含图片中可见的主体和状态
- 不确定的标注"待确认"`,
              },
              { role: 'user', content: userContent },
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
          // v1.2.1 P0 修复：严格校验 idx 范围，越界走降级（不静默用 batch[0]）
          // 旧逻辑 batch[idx] || batch[0] → AI 输出 index:99 但 batch.length=50 时静默错位
          if (idx < 0 || idx >= batch.length) {
            console.warn(`[photo:aiArchive] AI 返回 index ${item.index} 越界 batch.length=${batch.length}，跳过该条`)
            continue
          }
          const f = batch[idx]
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
          const newName = generateStandardName(file.shootDate, file.location, file.description, idx + 1, ext)
          // v1.2.2 P0 修复：同名检测，每次基于"已占用全集"挑下一个空位
          //   v1.2.1 算法有 bug——子 agent 端到端测试发现第 3 次产 a-1-2.jpg
          //   根因：循环只检测 finalName，不看已尝试过的"a-1"族
          //   正确算法：把所有 -N 后缀都跳过，dup 继续递增
          const finalName = resolveAvailableFileName(archiveDir, newName)
          const destPath = path.join(archiveDir, finalName)

          try {
            fs.copyFileSync(file.srcPath, destPath)
            const id = repo.insertPhoto({
              project_name: projectName,
              file_name: finalName,
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
      recognitionMode: '当前模型图片识别',
    }
  }))

  // AI 助手图片识别：只读取并分析，不移动、不重命名原文件。
  ipcMain.handle('photo:recognizeImages', safeCall(async (_, { paths = [] } = {}) => {
    const imagePaths = Array.from(new Set(paths))
      .filter(fp => typeof fp === 'string' && fs.existsSync(fp) && IMAGE_EXTS.has(path.extname(fp).toLowerCase()))
      .slice(0, 6)
    if (imagePaths.length === 0) return { success: false, error: '没有可识别的图片文件' }

    const settings = getSettings()
    const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey : ''
    if (!apiKey) return { success: false, error: '请先在 AI 配置中设置 API Key' }
    const recognitionModel = String(settings.model || '').trim()
    if (!recognitionModel) return { success: false, error: '请先在 AI 配置中选择模型' }
    const baseUrl = settings.baseUrl
    if (!baseUrl) return { success: false, error: '图片模型 API 地址未配置' }

    const content = [
      { type: 'text', text: `请识别以下 ${imagePaths.length} 张工程现场图片。只描述图片中可见事实，不推测未显示的信息。` },
      ...imagePaths.flatMap((fp, index) => {
        const dataUrl = imageDataUrl(fp)
        const label = { type: 'text', text: `\n图片${index + 1}：${path.basename(fp)}` }
        return dataUrl ? [label, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] : [label]
      }),
    ]
    const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: recognitionModel,
        messages: [
          { role: 'system', content: `你是工程监理现场图片识别助手。逐张输出：可见部位或对象、施工或设备状态、可见问题、判断依据、需要用户补充的信息。严禁仅凭图片断定质量合格或违规，严禁编造时间、项目、楼层、人员、尺寸和规范条款。最后汇总可用于文档写作的客观事实。不要输出思考过程。` },
          { role: 'user', content },
        ],
        temperature: 0.2,
        max_tokens: 1800,
      }),
    })
    if (!response.ok) {
      let error = `图片识别失败 (${response.status})`
      try { const data = await response.json(); error = data.error?.message || data.error || error } catch {}
      return { success: false, error: `当前模型「${recognitionModel}」未能识别图片：${error}。请确认所选模型支持图片输入。` }
    }
    const data = await response.json()
    const recognized = data.choices?.[0]?.message?.content || ''
    if (!recognized) return { success: false, error: '图文模型未返回识别结果' }
    if (/(未检测到|无法(?:查看|读取|识别)|不能(?:看到|访问)|仅收到).{0,18}(图片|图像|文件名)/i.test(recognized)) {
      return { success: false, error: `图文模型「${recognitionModel}」没有实际读取图片。请检查模型是否支持 OpenAI 兼容的 image_url 输入。` }
    }
    return { success: true, content: recognized, model: recognitionModel }
  }))
}

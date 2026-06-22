/**
 * 搜索服务 — 使用 FlexSearch 索引项目文件，支持全文检索
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { safeCall } from './safe.mjs'
import { readProjectIndex } from './shared.mjs'

// FlexSearch 动态导入
let FlexSearch = null
let cachedFlexSearchEngine = null
let cachedDocs = []

async function getFlexSearch() {
  if (!FlexSearch) {
    const module = await import('flexsearch')
    FlexSearch = module.default
  }
  return FlexSearch
}

// 构建并缓存 FlexSearch 引擎
async function buildFlexSearchEngine(docs) {
  const FlexSearchMod = await getFlexSearch()
  const engine = new FlexSearchMod.Index({ tokenize: 'full', resolution: 9 })
  for (const doc of docs) {
    try {
      engine.add(doc.id, `${doc.fileName} ${doc.content} ${doc.docType}`)
    } catch {
      // ignore
    }
  }
  return engine
}

// 获取索引存储路径
function getSearchIndexPath() {
  return path.join(app.getPath('userData'), 'search-index.json')
}

// 加载索引
function loadIndex() {
  const indexPath = getSearchIndexPath()
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    }
  } catch (e) {
    console.warn('[SearchIndex] Failed to load:', e.message)
  }
  return { meta: { version: 1, lastUpdated: null }, index: {} }
}

// 保存索引
function saveIndex(data) {
  const indexPath = getSearchIndexPath()
  try {
    fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf8')
  } catch (e) {
    console.error('[SearchIndex] Failed to save:', e.message)
  }
}

// 扫描项目目录收集文件
async function collectFiles(projectPath, maxDepth = 10) {
  const files = []

  function scanDir(dirPath, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (['.docx', '.xlsx', '.pdf', '.txt', '.md'].includes(ext)) {
          files.push(fullPath)
        }
      } else if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1)
      }
    }
  }

  scanDir(projectPath, 0)
  return files
}

// 读取文本文件内容（用于索引）
async function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    if (ext === '.txt' || ext === '.md') {
      return fs.readFileSync(filePath, 'utf8').slice(0, 5000)
    }
    if (ext === '.docx') {
      return await readDocxContent(filePath)
    }
    if (ext === '.xlsx') {
      return await readXlsxContent(filePath)
    }
    // pdf 暂不支持读取内容，仅索引文件名
  } catch (e) {
    console.warn('[readFileContent] Failed:', filePath, e.message)
  }
  return ''
}

// 解析 docx 正文 — 提取所有 <w:t> 文本节点拼接
async function readDocxContent(filePath) {
  // 读取限制：10MB 以上的文件不解析正文（避免 OOM）
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) return ''

  const buffer = fs.readFileSync(filePath)
  const PizZip = (await import('pizzip')).default
  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')
  if (!docXml) return ''

  const xml = docXml.asText()
  // 提取 <w:t>...</w:t> 之间的文本
  const matches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
  const text = matches
    .map(m => m.replace(/<[^>]+>/g, ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 5000)
}

// 解析 xlsx 正文 — 提取所有 sheet 的所有单元格文本
async function readXlsxContent(filePath) {
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) return ''

  const XLSX = await import('xlsx')
  const wb = XLSX.readFile(filePath)
  const parts = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c })
        const cell = ws[cellRef]
        if (cell && cell.v != null) {
          parts.push(String(cell.v))
        }
      }
    }
  }
  return parts.join(' ').slice(0, 5000)
}

// 构建单个项目的搜索索引
async function buildProjectIndex(projectName, projectPath) {
  const files = await collectFiles(projectPath)
  const docs = []

  for (const filePath of files) {
    const relativePath = path.relative(projectPath, filePath)
    const fileName = path.basename(filePath, path.extname(filePath))
    const content = await readFileContent(filePath)
    const stat = fs.statSync(filePath)

    docs.push({
      id: filePath,
      projectName,
      projectPath,
      relativePath,
      fileName,
      content: content.slice(0, 2000),
      docType: guessDocType(relativePath),
      mtime: stat.mtime.toISOString(),
    })
  }

  return docs
}

// 从路径猜文档类型
function guessDocType(relativePath) {
  const lower = relativePath.toLowerCase()
  const types = [
    ['整改通知书', '整改'],
    ['安全通知书', '安全'],
    ['工程联系单', '联系单'],
    ['会议纪要', '纪要'],
    ['监理日志', '日志'],
    ['监理周报', '周报'],
    ['监理月报', '月报'],
    ['停工令', '停工'],
    ['施工方案', '方案'],
    ['监理规划', '规划'],
    ['监理细则', '细则'],
  ]
  for (const [type, keyword] of types) {
    if (lower.includes(keyword)) return type
  }
  return '文档'
}

// 全量重建所有项目索引
async function rebuildAllIndexes(progressCallback) {
  const index = loadIndex()
  const projectIndex = readProjectIndex()

  let FlexSearchEngine
  try {
    const FlexSearchMod = await getFlexSearch()
    FlexSearchEngine = new FlexSearchMod.Index({
      tokenize: 'full',
      resolution: 9,
    })
  } catch (e) {
    console.warn('[Search] FlexSearch init failed:', e.message)
  }

  const allDocs = []
  let processed = 0
  const total = projectIndex.projects.length

  for (const proj of projectIndex.projects) {
    if (!fs.existsSync(proj.path)) continue
    try {
      const docs = await buildProjectIndex(proj.name, proj.path)
      allDocs.push(...docs)

      if (FlexSearchEngine) {
        for (const doc of docs) {
          try {
            FlexSearchEngine.add(doc.id, `${doc.fileName} ${doc.content} ${doc.docType}`)
          } catch {
            // ignore
          }
        }
      }

      processed++
      if (progressCallback) progressCallback(processed, total, proj.name)
    } catch (e) {
      console.warn('[Search] Index project failed:', proj.name, e.message)
    }
  }

  index.meta = { version: 1, lastUpdated: new Date().toISOString() }
  index.index = allDocs
  saveIndex(index)

  return { docs: allDocs, FlexSearchEngine }
}

export function register(ipcMain) {
  // 触发索引重建（后台）
  ipcMain.handle('search:rebuild', safeCall(async (_, onProgress) => {
    const result = await rebuildAllIndexes(onProgress)
    // 重建后更新缓存引擎
    if (result.docs.length > 0) {
      cachedFlexSearchEngine = await buildFlexSearchEngine(result.docs)
      cachedDocs = [...result.docs]
    }
    return { success: true, docCount: result.docs.length }
  }))

  // 搜索文件
  ipcMain.handle('search:query', safeCall(async (_, query, options = {}) => {
    const { limit = 20 } = options || {}

    const index = loadIndex()
    const docs = index.index || []

    // 尝试使用缓存的 FlexSearch 引擎
    if (cachedFlexSearchEngine && docs.length > 0 && cachedDocs.length === docs.length) {
      try {
        const fsResults = await cachedFlexSearchEngine.searchAsync(query, { limit })
        return fsResults.map(id => docs.find(d => String(d.id) === String(id))).filter(Boolean)
      } catch (e) {
        console.warn('[Search] FlexSearch query failed, falling back:', e.message)
      }
    }

    // 缓存无效，重新构建引擎
    if (docs.length > 0) {
      try {
        cachedFlexSearchEngine = await buildFlexSearchEngine(docs)
        cachedDocs = [...docs]
        const fsResults = await cachedFlexSearchEngine.searchAsync(query, { limit })
        return fsResults.map(id => docs.find(d => String(d.id) === String(id))).filter(Boolean)
      } catch (e) {
        console.warn('[Search] FlexSearch rebuild failed, falling back:', e.message)
      }
    }

    // 降级：简单的字符串包含搜索
    const lowerQuery = query.toLowerCase()
    const filtered = docs
      .filter(doc =>
        doc.fileName.toLowerCase().includes(lowerQuery) ||
        doc.content.toLowerCase().includes(lowerQuery) ||
        doc.docType.toLowerCase().includes(lowerQuery) ||
        doc.relativePath.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit)

    return filtered
  }))

  // 获取索引状态
  ipcMain.handle('search:status', safeCall(async () => {
    const index = loadIndex()
    return {
      docCount: Array.isArray(index.index) ? index.index.length : 0,
      lastUpdated: index.meta?.lastUpdated || null,
    }
  }))
}
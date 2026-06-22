import path from 'path'
import fs from 'fs'
import os from 'os'
import { safeCall } from './safe.mjs'

/**
 * 校验 filePath 必须在用户主目录或系统临时目录下（防止被诱导写 /etc/passwd 等）
 * 严格模式：绝对路径必须解析后落在允许前缀内
 */
function isPathSafe(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const resolved = path.resolve(filePath)
  const home = os.homedir()
  const tmp = os.tmpdir()
  const desktop = path.join(home, 'Desktop')
  return resolved.startsWith(home + path.sep) ||
         resolved.startsWith(tmp + path.sep) ||
         resolved === home ||
         resolved === tmp
}

export function register(ipcMain) {
  ipcMain.handle('fs:getDirTree', (_, dirPath, maxDepth = 2) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return { name: path.basename(dirPath || ''), path: dirPath || '', children: [], type: 'folder' }
      }

      const safeDepth = Math.min(Math.max(1, maxDepth || 2), 99)

      const readDir = (currentPath, depth) => {
        if (depth <= 0) return []
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.'))
          return entries.map(entry => {
            const entryPath = path.join(currentPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                path: entryPath,
                type: 'folder',
                children: readDir(entryPath, depth - 1),
              }
            } else {
              return {
                name: entry.name,
                path: entryPath,
                type: 'file',
                ext: path.extname(entry.name).toLowerCase(),
              }
            }
          }).sort((a, b) => {
            if (a.type === 'folder' && b.type === 'file') return -1
            if (a.type === 'file' && b.type === 'folder') return 1
            return a.name.localeCompare(b.name)
          })
        } catch (e) {
          console.error('[getDirTree] Error reading dir:', currentPath, e.message)
          return []
        }
      }

      const children = readDir(dirPath, safeDepth)
      return { name: path.basename(dirPath), path: dirPath, children, type: 'folder' }
    } catch (e) {
      console.error('[getDirTree] Error:', dirPath, e.message)
      return { name: path.basename(dirPath || ''), path: dirPath || '', children: [], type: 'folder' }
    }
  })

  ipcMain.handle('fs:readFile', (_, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null
      if (!fs.statSync(filePath).isFile()) return null
      const ext = path.extname(filePath).toLowerCase()
      if (['.json', '.txt', '.md'].includes(ext)) {
        return fs.readFileSync(filePath, 'utf8')
      }
      const stats = fs.statSync(filePath)
      return { name: path.basename(filePath), size: stats.size, modified: stats.mtime.toISOString(), isBinary: true }
    } catch (e) {
      console.error('[fs:readFile]', e.message)
      return null
    }
  })

  ipcMain.handle('fs:writeFile', safeCall((_, filePath, content) => {
    if (!filePath) return { success: false, error: '文件路径无效' }
    if (!isPathSafe(filePath)) return { success: false, error: '禁止写入系统目录' }
    // 安全：确保写入的是普通文件（非目录、非常规文件）
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return { success: false, error: '不是有效的文件' }
    } catch {
      // 文件不存在时可以写入，这是预期行为
    }
    fs.writeFileSync(filePath, content, 'utf8')
    return { success: true }
  }))

  ipcMain.handle('fs:deleteFile', safeCall((_, filePath) => {
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
    if (!isPathSafe(filePath)) return { success: false, error: '禁止删除系统目录文件' }
    fs.unlinkSync(filePath)
    return { success: true }
  }))

  // 重命名文件或文件夹
  ipcMain.handle('fs:renameFile', safeCall((_, filePath, newName) => {
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
    if (!isPathSafe(filePath)) return { success: false, error: '禁止操作系统目录' }
    if (!newName || !newName.trim()) return { success: false, error: '新名称无效' }
    if (/[\\/:*?"<>|]/.test(newName)) return { success: false, error: '名称包含非法字符' }
    const dir = path.dirname(filePath)
    const newPath = path.join(dir, newName.trim())
    if (newPath === filePath) return { success: true, path: filePath }
    if (fs.existsSync(newPath)) return { success: false, error: '同名文件已存在' }
    fs.renameSync(filePath, newPath)
    return { success: true, path: newPath }
  }))

  // 移动文件到目标目录
  ipcMain.handle('fs:moveFile', safeCall((_, filePath, targetDir) => {
    if (!fs.existsSync(filePath)) return { success: false, error: '源文件不存在' }
    if (!isPathSafe(filePath)) return { success: false, error: '禁止移动系统目录文件' }
    if (!fs.existsSync(targetDir)) return { success: false, error: '目标目录不存在' }
    if (!fs.statSync(targetDir).isDirectory()) return { success: false, error: '目标不是目录' }
    const fileName = path.basename(filePath)
    const targetPath = path.join(targetDir, fileName)
    if (targetPath === filePath) return { success: true, path: filePath }
    if (fs.existsSync(targetPath)) return { success: false, error: '目标位置已存在同名文件' }
    fs.renameSync(filePath, targetPath)
    return { success: true, path: targetPath }
  }))
}

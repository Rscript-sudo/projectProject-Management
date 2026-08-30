import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { isPathSafe } from '../shared/pathSafety.mjs'

/**
 * 校验 filePath 必须在用户主目录或系统临时目录下（防止被诱导写 /etc/passwd 等）
 * 严格模式：绝对路径必须解析后落在允许前缀内
 * v1.2.1 P0 修复：增加敏感目录黑名单（~/.ssh、~/.aws、~/.gnupg、系统目录）
 * v1.2.2 修复：手动展开 ~ 为 home 目录（macOS path.resolve 不展开波浪号）
 */
export { isPathSafe } from '../shared/pathSafety.mjs'

export function register(ipcMain, { trashItem } = {}) {
  ipcMain.handle('fs:getDirTree', (_, dirPath, maxDepth = 2) => {
    try {
      if (!dirPath || !isPathSafe(dirPath)) {
        return { name: '', path: dirPath || '', children: [], type: 'folder' }
      }
      if (!fs.existsSync(dirPath)) {
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
      if (!filePath || !isPathSafe(filePath)) return null
      if (!fs.existsSync(filePath)) return null
      if (!fs.statSync(filePath).isFile()) return null
      const ext = path.extname(filePath).toLowerCase()
      if (['.json', '.txt', '.md'].includes(ext)) {
        // v1.2.1 P2 修复：限制文本文件最大 10MB（防主进程 OOM）
        const MAX_TEXT_SIZE = 10 * 1024 * 1024
        const stats = fs.statSync(filePath)
        if (stats.size > MAX_TEXT_SIZE) {
          return { error: `文件过大（${(stats.size / 1024 / 1024).toFixed(1)} MB > 10 MB），拒绝读取` }
        }
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

  ipcMain.handle('fs:deleteFile', safeCall(async (_, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { success: false, error: '文件路径无效' }
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
    if (!isPathSafe(filePath)) return { success: false, error: '禁止删除系统目录文件' }
    if (typeof trashItem !== 'function') return { success: false, error: '系统废纸篓不可用' }
    await trashItem(filePath)
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
    if (!isPathSafe(targetDir)) return { success: false, error: '禁止移动到系统目录' }
    if (!fs.existsSync(targetDir)) return { success: false, error: '目标目录不存在' }
    if (!fs.statSync(targetDir).isDirectory()) return { success: false, error: '目标不是目录' }
    const fileName = path.basename(filePath)
    const targetPath = path.join(targetDir, fileName)
    if (targetPath === filePath) return { success: true, path: filePath }
    if (fs.existsSync(targetPath)) return { success: false, error: '目标位置已存在同名文件' }
    // v1.2.1 P2 修复：跨设备（EXDEV）fallback 到 copy+delete
    try {
      fs.renameSync(filePath, targetPath)
    } catch (e) {
      if (e.code === 'EXDEV') {
        // 跨设备：rename 不允许 → 走 copy + delete
        fs.copyFileSync(filePath, targetPath)
        fs.unlinkSync(filePath)
      } else {
        throw e
      }
    }
    return { success: true, path: targetPath }
  }))
}

import path from 'path'
import fs from 'fs'
import os from 'os'

function expandTilde(value) {
  if (!value) return value
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

function resolveRoot(root) {
  try { return fs.realpathSync(root) } catch { return path.resolve(root) }
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/**
 * 只允许用户主目录或系统临时目录内、且不位于敏感目录中的路径。
 * 对不存在的目标会解析其最近存在的父目录，防止符号链接绕过边界。
 */
export function isPathSafe(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const expanded = path.resolve(expandTilde(filePath))
  let existingParent = expanded
  while (!fs.existsSync(existingParent)) {
    const parent = path.dirname(existingParent)
    if (parent === existingParent) return false
    existingParent = parent
  }

  let resolvedParent
  try { resolvedParent = fs.realpathSync(existingParent) } catch { return false }
  const resolved = path.resolve(resolvedParent, path.relative(existingParent, expanded))
  const home = os.homedir()
  const safeRoots = [resolveRoot(home), resolveRoot(os.tmpdir())]
  if (!safeRoots.some(root => isWithin(resolved, root))) return false

  const blocked = [
    path.join(home, '.ssh'), path.join(home, '.aws'), path.join(home, '.gnupg'), path.join(home, '.kube'),
    '/etc', '/System', '/Library',
  ]
  return !blocked.some(blockedPath => isWithin(resolved, resolveRoot(blockedPath)))
}

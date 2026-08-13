import path from 'path'
import fs from 'fs'

/** 在目录中为文件名找到第一个未占用的序号，保持原文件名优先。 */
export function resolveAvailableFileName(archiveDir, fileName) {
  const ext = path.extname(fileName)
  const nameNoExt = ext ? fileName.slice(0, -ext.length) : fileName
  let duplicate = 0
  let candidate = fileName
  while (fs.existsSync(path.join(archiveDir, candidate))) {
    duplicate++
    if (duplicate > 999) throw new Error(`文件重名次数超过上限：${fileName}`)
    candidate = `${nameNoExt}-${duplicate}${ext}`
  }
  return candidate
}

import fs from 'node:fs'
import path from 'node:path'
import { statFile } from '@electron/asar'

const releaseRoot = path.resolve('release')
const candidates = [
  path.join(releaseRoot, 'mac-arm64', '项目文档管理系统.app'),
  path.join(releaseRoot, 'mac', '项目文档管理系统.app'),
]
const appPath = candidates.find(candidate => fs.existsSync(candidate))

if (!appPath) {
  throw new Error(`未找到 macOS 应用包：${candidates.join('、')}`)
}

const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar')
const requiredFiles = [
  'electron/main.mjs',
  'electron/templateRegistry.mjs',
  'src/shared/builtin-doc-types.json',
  'src/shared/field-aliases.json',
  'src/shared/templateReadiness.mjs',
]

const missing = requiredFiles.filter(file => {
  try {
    statFile(asarPath, file)
    return false
  } catch {
    return true
  }
})

if (missing.length) {
  throw new Error(`安装包缺少运行时文件：${missing.join('、')}`)
}

console.log(`[verify:package] PASS — ${requiredFiles.length} 个运行时文件均已写入 app.asar`)

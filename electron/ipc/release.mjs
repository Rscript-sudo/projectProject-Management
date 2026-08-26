import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { safeCall } from './safe.mjs'
import { getDb } from '../db/database.mjs'

function digest(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') }

export function register(ipcMain) {
  ipcMain.handle('release:preflight', safeCall(() => ({
    success: true, version: app.getVersion(), platform: process.platform, arch: process.arch,
    packaged: app.isPackaged, signed: process.platform === 'darwin' ? Boolean(process.mas || process.env.CSC_NAME) : null,
    databaseIntegrity: getDb().pragma('integrity_check', { simple: true }),
  })))
  ipcMain.handle('release:prepareUpdate', safeCall(async (_, { packagePath, expectedSha256, changelog = '', minimumVersion = '' }) => {
    if (!packagePath || !fs.existsSync(packagePath)) throw new Error('更新包不存在')
    const actualSha256 = digest(packagePath)
    if (expectedSha256 && actualSha256.toLowerCase() !== String(expectedSha256).toLowerCase()) throw new Error('SHA-256 校验失败')
    if (minimumVersion && app.getVersion().localeCompare(minimumVersion, undefined, { numeric: true }) < 0) throw new Error(`当前版本低于更新所需最低版本 ${minimumVersion}`)
    const recoveryDir = path.join(app.getPath('userData'), 'update-recovery', `${Date.now()}`); fs.mkdirSync(recoveryDir, { recursive: true })
    await getDb().backup(path.join(recoveryDir, 'pre-update.db'))
    const stagedPackage = path.join(recoveryDir, path.basename(packagePath)); fs.copyFileSync(packagePath, stagedPackage)
    fs.writeFileSync(path.join(recoveryDir, 'CHANGELOG.md'), changelog || '# 本次更新\n\n未提供更新说明。\n', 'utf8')
    fs.writeFileSync(path.join(recoveryDir, 'recovery.json'), JSON.stringify({ previousVersion: app.getVersion(), stagedPackage, sha256: actualSha256, createdAt: new Date().toISOString() }, null, 2), 'utf8')
    return { success: true, recoveryDir, stagedPackage, sha256: actualSha256, changelogPath: path.join(recoveryDir, 'CHANGELOG.md') }
  }))
}

import { app, shell } from 'electron'
import {
  GITEE_RELEASE_API,
  GITEE_RELEASE_SITE,
  buildUpdateCheckResult,
  isTrustedGiteeUpdateUrl,
} from './updateSource.mjs'

export function register(ipcMain) {
  ipcMain.handle('app:getInfo', () => ({ name: app.getName(), version: app.getVersion(), repository: GITEE_RELEASE_SITE }))

  ipcMain.handle('update:check', async () => {
    const currentVersion = app.getVersion()
    try {
      const response = await fetch(`${GITEE_RELEASE_API}/latest`, {
        headers: { Accept: 'application/json', 'User-Agent': 'project-management-system' },
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 404) {
        return { success: true, provider: 'gitee', currentVersion, latestVersion: currentVersion, hasUpdate: false, releaseName: '尚未发布', releaseUrl: `${GITEE_RELEASE_SITE}/releases`, downloadUrl: null, assetName: null, publishedAt: null }
      }
      if (!response.ok) throw new Error(`Gitee 返回 ${response.status}`)
      const release = await response.json()
      const attachmentsResponse = await fetch(`${GITEE_RELEASE_API}/${release.id}/attach_files?per_page=100`, {
        headers: { Accept: 'application/json', 'User-Agent': 'project-management-system' },
        signal: AbortSignal.timeout(10000),
      })
      if (!attachmentsResponse.ok) throw new Error(`Gitee 附件服务返回 ${attachmentsResponse.status}`)
      const attachments = await attachmentsResponse.json()
      return buildUpdateCheckResult(currentVersion, release, attachments)
    } catch (error) {
      return { success: false, provider: 'gitee', currentVersion, error: `无法连接 Gitee 更新服务：${error.message}` }
    }
  })

  ipcMain.handle('update:download', async (_, downloadUrl) => {
    if (!isTrustedGiteeUpdateUrl(downloadUrl)) return { success: false, error: '更新下载地址无效' }
    await shell.openExternal(downloadUrl)
    return { success: true }
  })
}

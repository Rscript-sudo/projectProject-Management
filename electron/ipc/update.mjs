import { app, shell } from 'electron'

// 发布仓库固定在应用内，避免前端传入任意下载地址。
const RELEASE_API = 'https://api.github.com/repos/Rscript-sudo/projectProject-Management/releases/latest'
const RELEASE_PREFIX = 'https://github.com/Rscript-sudo/projectProject-Management/releases/download/'

function compareVersions(left, right) {
  const parse = value => String(value || '0').replace(/^v/i, '').split('-')[0].split('.').map(n => Number(n) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1
  }
  return 0
}

function selectAsset(assets = []) {
  const suffix = process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.AppImage'
  return assets.find(asset => asset.name.endsWith(suffix) && !asset.name.endsWith('.blockmap')) || null
}

export function register(ipcMain) {
  ipcMain.handle('app:getInfo', () => ({ name: app.getName(), version: app.getVersion(), repository: 'Rscript-sudo/projectProject-Management' }))

  ipcMain.handle('update:check', async () => {
    const currentVersion = app.getVersion()
    try {
      const response = await fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'project-management-system' },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
      const release = await response.json()
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '')
      const asset = selectAsset(release.assets)
      return { success: true, currentVersion, latestVersion, hasUpdate: compareVersions(latestVersion, currentVersion) > 0, releaseName: release.name || `v${latestVersion}`, releaseUrl: release.html_url, downloadUrl: asset?.browser_download_url || null, assetName: asset?.name || null, publishedAt: release.published_at || null }
    } catch (error) {
      return { success: false, currentVersion, error: `无法连接 GitHub 更新服务：${error.message}` }
    }
  })

  ipcMain.handle('update:download', async (_, downloadUrl) => {
    if (!downloadUrl || !String(downloadUrl).startsWith(RELEASE_PREFIX)) return { success: false, error: '更新下载地址无效' }
    await shell.openExternal(downloadUrl)
    return { success: true }
  })
}

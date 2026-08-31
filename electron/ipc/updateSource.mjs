export const GITEE_RELEASE_OWNER = 'micfree'
export const GITEE_RELEASE_REPO = 'project-management'
export const GITEE_RELEASE_SITE = `https://gitee.com/${GITEE_RELEASE_OWNER}/${GITEE_RELEASE_REPO}`
export const GITEE_RELEASE_API = `https://gitee.com/api/v5/repos/${GITEE_RELEASE_OWNER}/${GITEE_RELEASE_REPO}/releases`

export function compareVersions(left, right) {
  const parse = value => String(value || '0').replace(/^v/i, '').split('-')[0].split('.').map(n => Number(n) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1
  }
  return 0
}

function installerCandidates(assets, platform, arch) {
  const normalized = (assets || []).filter(asset => asset && asset.name && asset.browser_download_url)
  if (platform === 'win32') {
    return normalized.filter(asset => /\.exe$/i.test(asset.name)).sort((a, b) => {
      const score = item => /setup/i.test(item.name) ? 0 : /portable|绿色/i.test(item.name) ? 2 : 1
      return score(a) - score(b)
    })
  }
  if (platform === 'darwin') {
    const dmgAssets = normalized.filter(asset => /\.dmg$/i.test(asset.name))
    const expected = arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|intel/i
    const knownArchitecture = /arm64|aarch64|x64|x86_64|intel/i
    const exact = dmgAssets.filter(asset => expected.test(asset.name))
    return exact.length ? exact : dmgAssets.filter(asset => !knownArchitecture.test(asset.name))
  }
  return normalized.filter(asset => /\.AppImage$/i.test(asset.name))
}

export function selectInstallerAsset(assets = [], platform = process.platform, arch = process.arch) {
  return installerCandidates(assets, platform, arch)[0] || null
}

export function getReleasePageUrl(tagName = '') {
  const tag = encodeURIComponent(String(tagName || '').trim())
  return tag ? `${GITEE_RELEASE_SITE}/releases/tag/${tag}` : `${GITEE_RELEASE_SITE}/releases`
}

export function isTrustedGiteeUpdateUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'gitee.com') return false
    const repositoryPath = `/${GITEE_RELEASE_OWNER}/${GITEE_RELEASE_REPO}/`
    const apiPath = `/api/v5/repos/${GITEE_RELEASE_OWNER}/${GITEE_RELEASE_REPO}/releases/`
    return url.pathname.startsWith(repositoryPath) || url.pathname.startsWith(apiPath)
  } catch {
    return false
  }
}

export function buildUpdateCheckResult(currentVersion, release, attachments = [], platform = process.platform, arch = process.arch) {
  const latestVersion = String(release?.tag_name || '').replace(/^v/i, '')
  const asset = selectInstallerAsset(attachments, platform, arch)
  return {
    success: true,
    provider: 'gitee',
    currentVersion,
    latestVersion,
    hasUpdate: Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0,
    releaseName: release?.name || `v${latestVersion}`,
    releaseUrl: getReleasePageUrl(release?.tag_name),
    downloadUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    publishedAt: release?.created_at || null,
  }
}

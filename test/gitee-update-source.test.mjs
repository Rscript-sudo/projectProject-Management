import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUpdateCheckResult,
  compareVersions,
  getReleasePageUrl,
  isTrustedGiteeUpdateUrl,
  selectInstallerAsset,
} from '../electron/ipc/updateSource.mjs'

const assets = [
  { name: '项目文档管理系统 1.5.0.exe', browser_download_url: 'https://gitee.com/micfree/project-management/attach_files/1/download' },
  { name: '项目文档管理系统 Setup 1.5.0.exe', browser_download_url: 'https://gitee.com/micfree/project-management/attach_files/2/download' },
  { name: '项目文档管理系统-1.5.0-x64.dmg', browser_download_url: 'https://gitee.com/micfree/project-management/attach_files/3/download' },
  { name: '项目文档管理系统-1.5.0-arm64.dmg', browser_download_url: 'https://gitee.com/micfree/project-management/attach_files/4/download' },
]

test('Gitee 更新比较使用语义化版本', () => {
  assert.equal(compareVersions('1.5.0', '1.4.9'), 1)
  assert.equal(compareVersions('v1.4.2', '1.4.2'), 0)
  assert.equal(compareVersions('1.4.1', '1.4.2'), -1)
})

test('根据平台和架构选择正确的 Gitee Release 附件', () => {
  assert.match(selectInstallerAsset(assets, 'win32', 'x64').name, /Setup/)
  assert.match(selectInstallerAsset(assets, 'darwin', 'arm64').name, /arm64/)
  assert.match(selectInstallerAsset(assets, 'darwin', 'x64').name, /x64/)
  assert.equal(selectInstallerAsset(assets.filter(item => !/x64/.test(item.name)), 'darwin', 'x64'), null, '不得向 Intel Mac 提供 arm64 安装包')
})

test('只允许打开指定 Gitee 发行仓库的链接', () => {
  assert.equal(isTrustedGiteeUpdateUrl('https://gitee.com/micfree/project-management/releases/tag/v1.5.0'), true)
  assert.equal(isTrustedGiteeUpdateUrl('https://gitee.com/micfree/project-management/attach_files/4/download'), true)
  assert.equal(isTrustedGiteeUpdateUrl('https://gitee.com/other/repo/releases/tag/v1.5.0'), false)
  assert.equal(isTrustedGiteeUpdateUrl('http://gitee.com/micfree/project-management/releases/tag/v1.5.0'), false)
  assert.equal(isTrustedGiteeUpdateUrl('https://gitee.com.evil.example/micfree/project-management/releases'), false)
})

test('将 Gitee Release 和附件整理为客户端更新结果', () => {
  const result = buildUpdateCheckResult('1.4.2', {
    id: 88,
    tag_name: 'v1.5.0',
    name: '正式版 v1.5.0',
    created_at: '2026-09-01T09:00:00+08:00',
  }, assets, 'darwin', 'arm64')
  assert.equal(result.provider, 'gitee')
  assert.equal(result.hasUpdate, true)
  assert.equal(result.assetName, '项目文档管理系统-1.5.0-arm64.dmg')
  assert.equal(result.releaseUrl, getReleasePageUrl('v1.5.0'))
})

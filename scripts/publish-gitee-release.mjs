#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'micfree'
const REPO = 'project-management'
const API = `https://gitee.com/api/v5/repos/${OWNER}/${REPO}`
const token = String(process.env.GITEE_TOKEN || '').trim()
const [tagName, ...inputFiles] = process.argv.slice(2)

function fail(message) {
  console.error(`[publish:gitee] ${message}`)
  process.exit(1)
}

if (!token) fail('缺少 GITEE_TOKEN；请把仅具有发行权限的 Gitee 私人令牌放入环境变量')
if (!/^v\d+\.\d+\.\d+$/.test(String(tagName || ''))) fail('用法：npm run publish:gitee -- v1.2.3 <安装包路径...>')
if (!inputFiles.length) fail('至少需要一个安装包或更新描述文件')

function expandInput(value) {
  const absolute = path.resolve(value)
  const name = path.basename(absolute)
  if (!name.includes('*')) return [absolute]
  const dir = path.dirname(absolute)
  if (!fs.existsSync(dir)) return []
  const escaped = name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  const matcher = new RegExp(`^${escaped}$`, 'i')
  return fs.readdirSync(dir).filter(item => matcher.test(item)).map(item => path.join(dir, item))
}

const files = [...new Set(inputFiles.flatMap(expandInput))]
if (!files.length) fail('输入路径没有匹配到任何文件')
for (const file of files) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`文件不存在：${file}`)
}

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (`v${packageJson.version}` !== tagName) fail(`package.json 版本为 v${packageJson.version}，与发布标签 ${tagName} 不一致`)

function endpoint(pathname) {
  const url = new URL(`${API}${pathname}`)
  url.searchParams.set('access_token', token)
  return url
}

async function parseResponse(response, action) {
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) fail(`${action}失败（${response.status}）：${typeof data === 'string' ? data : data?.message || JSON.stringify(data)}`)
  return data
}

async function getOrCreateRelease() {
  const existing = await fetch(endpoint(`/releases/tags/${encodeURIComponent(tagName)}`), {
    headers: { Accept: 'application/json', 'User-Agent': 'project-management-release-publisher' },
  })
  if (existing.ok) return await existing.json()
  if (existing.status !== 404) return await parseResponse(existing, '查询 Gitee Release')

  const form = new FormData()
  form.set('access_token', token)
  form.set('tag_name', tagName)
  form.set('name', `项目文档管理系统 ${tagName}`)
  form.set('body', process.env.GITEE_RELEASE_NOTES || `项目文档管理系统 ${tagName} 正式发行版。\n\n请根据操作系统下载本页附件中的安装包。`)
  form.set('prerelease', 'false')
  form.set('target_commitish', 'main')
  const created = await fetch(`${API}/releases`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'User-Agent': 'project-management-release-publisher' },
    body: form,
  })
  return await parseResponse(created, '创建 Gitee Release')
}

async function listAttachments(releaseId) {
  const response = await fetch(endpoint(`/releases/${releaseId}/attach_files?per_page=100`), {
    headers: { Accept: 'application/json', 'User-Agent': 'project-management-release-publisher' },
  })
  return await parseResponse(response, '查询 Gitee Release 附件')
}

async function uploadAttachment(releaseId, file) {
  const form = new FormData()
  form.set('access_token', token)
  const content = await fs.promises.readFile(file)
  form.set('file', new Blob([content]), path.basename(file))
  const response = await fetch(`${API}/releases/${releaseId}/attach_files`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'User-Agent': 'project-management-release-publisher' },
    body: form,
  })
  return await parseResponse(response, `上传 ${path.basename(file)}`)
}

const release = await getOrCreateRelease()
const existing = await listAttachments(release.id)
for (const file of files) {
  const name = path.basename(file)
  const size = fs.statSync(file).size
  const sameName = existing.find(item => item.name === name)
  if (sameName) {
    if (Number(sameName.size) !== size) fail(`已存在同名但大小不同的附件：${name}；请先在 Gitee 删除旧附件`)
    console.log(`[publish:gitee] 跳过已上传附件：${name}`)
    continue
  }
  await uploadAttachment(release.id, file)
  console.log(`[publish:gitee] 已上传：${name}`)
}

console.log(`[publish:gitee] 发布完成：https://gitee.com/${OWNER}/${REPO}/releases/tag/${tagName}`)

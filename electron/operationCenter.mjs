import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import PizZip from 'pizzip'

const VERSION = 2
const MAX_TASKS = 300
const MAX_EVENTS = 1200

function storePath() { return path.join(app.getPath('userData'), 'operation-center.json') }
function emptyStore() { return { version: VERSION, tasks: [], events: [] } }
const cancelHandlers = new Map()
function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return { ...emptyStore(), ...parsed, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], events: Array.isArray(parsed.events) ? parsed.events : [] }
  } catch { return emptyStore() }
}
function writeStore(store) {
  const target = storePath(); fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ ...store, version: VERSION }, null, 2), 'utf8')
  fs.renameSync(temporary, target)
}
function redact(value) {
  if (value == null) return value
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1***')
    .replace(/("?apiKey"?\s*:\s*"?)[^",}\s]+/gi, '$1***')
    .slice(0, 12000)
}
export function createTask(input = {}) {
  const store = readStore(); const now = new Date().toISOString()
  const timeoutMs = Math.max(1000, Math.min(Number(input.timeoutMs) || 180000, 30 * 60 * 1000))
  const task = { id: crypto.randomUUID(), type: String(input.type || 'general'), title: String(input.title || '后台任务'), projectPath: String(input.projectPath || ''), status: 'queued', stage: 'queued', progress: 0, retryable: false, attempts: 0, maxAttempts: Math.max(1, Math.min(Number(input.maxAttempts) || 2, 5)), timeoutMs, createdAt: now, updatedAt: now, metadata: input.metadata || {} }
  store.tasks.unshift(task); store.tasks = store.tasks.slice(0, MAX_TASKS); writeStore(store); return task
}
export function updateTask(id, patch = {}) {
  const store = readStore(); const task = store.tasks.find(item => item.id === id)
  if (!task) throw new Error('任务不存在或已被清理')
  const allowed = ['status', 'stage', 'progress', 'retryable', 'error', 'result', 'metadata', 'attempts', 'requestId']
  for (const key of allowed) if (patch[key] !== undefined) task[key] = key === 'error' ? redact(patch[key]) : patch[key]
  task.updatedAt = new Date().toISOString()
  if (['succeeded', 'failed', 'cancelled'].includes(task.status)) task.finishedAt = task.updatedAt
  writeStore(store); return task
}
export function registerTaskCancellation(id, handler) { cancelHandlers.set(id, handler); return () => cancelHandlers.delete(id) }
export function cancelTask(id, reason = '用户取消') {
  const store = readStore(); const task = store.tasks.find(item => item.id === id)
  if (!task) throw new Error('任务不存在或已被清理')
  if (['succeeded', 'failed', 'cancelled'].includes(task.status)) return task
  try { cancelHandlers.get(id)?.() } finally { cancelHandlers.delete(id) }
  task.status = 'cancelled'; task.stage = 'cancelled'; task.error = redact(reason); task.retryable = true; task.progress = Math.max(0, task.progress || 0); task.updatedAt = new Date().toISOString(); task.finishedAt = task.updatedAt
  store.events.unshift({ id: crypto.randomUUID(), taskId: id, level: 'warn', stage: 'cancelled', message: redact(reason), detail: '', createdAt: task.updatedAt })
  writeStore(store); return task
}
export function retryTask(id) {
  const store = readStore(); const task = store.tasks.find(item => item.id === id)
  if (!task) throw new Error('任务不存在或已被清理')
  if (!['failed', 'cancelled', 'interrupted'].includes(task.status) || !task.retryable) throw new Error('该任务当前不可重试')
  if ((task.attempts || 0) >= (task.maxAttempts || 2)) throw new Error('任务已达到最大重试次数')
  task.status = 'queued'; task.stage = 'retry_requested'; task.progress = 0; task.error = ''; task.finishedAt = null; task.updatedAt = new Date().toISOString()
  store.events.unshift({ id: crypto.randomUUID(), taskId: id, level: 'info', stage: 'retry_requested', message: '任务已进入重试队列，请重新执行原操作', detail: '', createdAt: task.updatedAt })
  writeStore(store); return task
}
export function recoverInterruptedTasks() {
  const store = readStore(); let recovered = 0; const now = Date.now()
  for (const task of store.tasks) {
    if (!['running', 'validating'].includes(task.status)) continue
    const age = now - new Date(task.updatedAt || task.createdAt).getTime()
    if (age < Math.max(30000, task.timeoutMs || 180000)) continue
    task.status = 'interrupted'; task.stage = 'recovered_after_restart'; task.retryable = true; task.error = '应用退出或任务超时，已安全恢复为可重试状态'; task.updatedAt = new Date().toISOString(); task.finishedAt = task.updatedAt; recovered++
    store.events.unshift({ id: crypto.randomUUID(), taskId: task.id, level: 'warn', stage: task.stage, message: task.error, detail: '', createdAt: task.updatedAt })
  }
  if (recovered) writeStore(store)
  return { recovered }
}
export function appendDiagnostic(input = {}) {
  const store = readStore()
  const event = { id: crypto.randomUUID(), taskId: input.taskId || '', level: ['warn', 'error'].includes(input.level) ? input.level : 'info', stage: String(input.stage || ''), message: redact(input.message || ''), detail: redact(input.detail || ''), createdAt: new Date().toISOString() }
  store.events.unshift(event); store.events = store.events.slice(0, MAX_EVENTS); writeStore(store); return event
}
export function listOperations(filters = {}) {
  recoverInterruptedTasks()
  const store = readStore()
  const tasks = store.tasks.filter(task => (!filters.projectPath || task.projectPath === filters.projectPath) && (!filters.status || task.status === filters.status))
  const events = store.events.filter(event => !filters.taskId || event.taskId === filters.taskId)
  return { version: VERSION, tasks: tasks.slice(0, Number(filters.limit) || 100), events: events.slice(0, 300) }
}
export function clearFinishedOperations() {
  const store = readStore(); const active = new Set(store.tasks.filter(task => !['succeeded', 'failed', 'cancelled'].includes(task.status)).map(task => task.id))
  store.tasks = store.tasks.filter(task => active.has(task.id)); store.events = store.events.filter(event => active.has(event.taskId)); writeStore(store)
  return { success: true }
}

export function resolveModelCapabilities(model = '') {
  const name = String(model).toLowerCase()
  const vision = /(vision|vl|multimodal|gpt-4o|gpt-5|claude-3|claude-4|gemini|minimax)/.test(name)
  return { model: String(model), text: true, vision, streaming: true, structuredOutput: /(gpt|claude|gemini|deepseek|minimax|qwen)/.test(name), maxImages: vision ? 20 : 0 }
}
export function routeModel(candidates = [], requirements = {}) {
  const profiles = [...new Set((Array.isArray(candidates) ? candidates : []).filter(Boolean))].map(resolveModelCapabilities)
  const compatible = profiles.filter(profile => (!requirements.vision || profile.vision) && (!requirements.structuredOutput || profile.structuredOutput) && (!requirements.streaming || profile.streaming))
  const selected = compatible[0] || null
  return { selected, compatible, rejected: profiles.filter(profile => !compatible.includes(profile)), reason: selected ? '' : `没有模型满足能力要求：${Object.entries(requirements).filter(([, enabled]) => enabled).map(([key]) => key).join('、')}` }
}

export function scoreDocumentQuality(docType, content) {
  const text = String(content || '').trim(); const checks = []
  const add = (id, label, passed, severity = 'warning') => checks.push({ id, label, passed, severity })
  add('non_empty', '正文不为空', text.length >= 20, 'error')
  add('no_markdown', '无 Markdown 或模型解释残留', !/(^|\n)#{1,6}\s|```|作为AI|以下是/.test(text))
  add('no_placeholders', '无待补充占位符', !/(待补充|待填写|\{\{[^}]+\}\})/.test(text))
  add('no_fabricated_clause', '无无法核验的条款式表达', !/第\s*\d+(?:\.\d+)*\s*条/.test(text) || /依据|规范|合同/.test(text))
  if (/整改通知书|安全通知书|停工令/.test(docType)) {
    add('notice_facts', '包含问题事实', /问题|发现|检查|存在/.test(text), 'error')
    add('notice_actions', '包含可执行要求', /整改|要求|应当|复查|报验/.test(text), 'error')
    add('notice_close_loop', '包含复核或闭环安排', /复核|复查|闭环|回复|报验/.test(text))
  }
  const score = Math.round(checks.reduce((sum, check) => sum + (check.passed ? (check.severity === 'error' ? 20 : 10) : 0), 0) / checks.reduce((sum, check) => sum + (check.severity === 'error' ? 20 : 10), 0) * 100)
  return { docType, score, passed: checks.every(check => check.passed || check.severity !== 'error'), checks }
}

export function auditDocxTemplate(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.docx' || !fs.existsSync(filePath)) throw new Error('模板文件不存在或不是 DOCX')
  const stat = fs.statSync(filePath); if (stat.size > 50 * 1024 * 1024) throw new Error('模板超过 50MB，拒绝导入')
  const zip = new PizZip(fs.readFileSync(filePath)); const names = Object.keys(zip.files)
  const issues = []; const xml = names.filter(name => /^word\/.*\.xml$/.test(name)).map(name => zip.file(name)?.asText() || '').join('\n')
  const placeholders = [...xml.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(match => match[1].trim())
  const duplicates = [...new Set(placeholders.filter((field, index) => placeholders.indexOf(field) !== index))]
  if (!placeholders.length) issues.push({ severity: 'warning', code: 'NO_PLACEHOLDERS', message: '模板未发现 {{字段}} 占位符' })
  if (duplicates.length) issues.push({ severity: 'info', code: 'REPEATED_FIELDS', message: `重复字段：${duplicates.join('、')}` })
  if (names.some(name => /vbaProject\.bin$/i.test(name))) issues.push({ severity: 'error', code: 'MACRO', message: '模板包含宏，拒绝作为受控模板' })
  if (/TargetMode="External"/i.test(xml)) issues.push({ severity: 'warning', code: 'EXTERNAL_LINK', message: '模板含外部链接关系' })
  return { success: !issues.some(issue => issue.severity === 'error'), filePath, size: stat.size, fields: [...new Set(placeholders)], issues, checkedAt: new Date().toISOString() }
}

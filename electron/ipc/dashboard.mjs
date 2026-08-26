import path from 'path'
import { safeCall } from './safe.mjs'
import { readProjectIndex } from './shared.mjs'
import { getDb } from '../db/database.mjs'
import { scanProjectCompleteness } from './completeness.mjs'

export function buildPortfolioDashboard() {
  const db = getDb(); const today = new Date().toISOString().slice(0, 10)
  const projects = readProjectIndex().projects.map(project => {
    const name = project.name || path.basename(project.path)
    const check = scanProjectCompleteness(project.path)
    const hazards = db.prepare("SELECT * FROM hazard WHERE project_name = ? AND status NOT IN ('已关闭','已整改') ORDER BY deadline").all(name)
    const letters = db.prepare("SELECT * FROM correspondence WHERE project_name = ? AND status NOT IN ('已关闭','已回复') ORDER BY deadline").all(name)
    const progress = db.prepare('SELECT COALESCE(AVG(progress_percent),0) value FROM progress_node WHERE project_name = ?').get(name).value
    const errors = check.issueSummary.error || 0; const warnings = check.issueSummary.warning || 0
    const health = Math.max(0, Math.round(100 - errors * 12 - warnings * 3 - hazards.filter(item => item.deadline && item.deadline < today).length * 8))
    const todos = [...hazards.map(item => ({ type: '隐患', id: item.id, title: item.description, due: item.deadline })), ...letters.map(item => ({ type: '函件', id: item.id, title: item.subject || item.file_name, due: item.deadline }))]
    return { name, path: project.path, health, progress: Math.round(progress), issueCount: check.issues.length, todoCount: todos.length, todos, calendar: todos.filter(item => item.due), phaseCompletion: check.totalTypes ? Math.round(check.completeTypes / check.totalTypes * 100) : 0 }
  })
  return { projects, rankings: [...projects].sort((a, b) => a.health - b.health), todos: projects.flatMap(project => project.todos.map(todo => ({ ...todo, projectName: project.name }))), calendar: projects.flatMap(project => project.calendar.map(item => ({ ...item, projectName: project.name }))) }
}

export function register(ipcMain) { ipcMain.handle('dashboard:portfolio', safeCall(() => buildPortfolioDashboard())) }

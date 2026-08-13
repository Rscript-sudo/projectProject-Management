/**
 * 项目资料解析与进度导入。
 * 本模块只做本地提取和确定性字段识别；AI 只能使用用户确认后入账的数据。
 */
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { safeCall } from './safe.mjs'
import * as repo from '../db/repo.mjs'
import { parseMaterial as parseLocalMaterial } from '../materialParser.mjs'

export { parseLocalMaterial as parseMaterial }

export function register(ipcMain) {
  ipcMain.handle('material:parse', safeCall(async (_, { filePath }) => parseLocalMaterial(filePath)))
  ipcMain.handle('material:importProgress', safeCall(async (_, { projectPath, nodes, sourceFile }) => {
    if (!projectPath) throw new Error('未选择项目')
    const projectName = path.basename(projectPath)
    const validNodes = Array.isArray(nodes) ? nodes.filter(node => String(node?.name || '').trim()) : []
    if (!validNodes.length) throw new Error('没有可导入的进度节点')
    const sourceHash = sourceFile && fs.existsSync(sourceFile) ? crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex') : ''
    const imported = repo.importProgressNodes(projectName, validNodes, sourceFile || '手工导入', sourceHash)
    if (imported.duplicate) return { success: false, duplicate: true, error: '该进度表已导入过；请在台账中编辑节点，避免重复累计。' }
    repo.logAudit(projectName, 'progress.import', 'progress_node', imported.ids[0], { count: imported.ids.length, sourceFile: sourceFile || '', sourceHash, batchId: imported.batchId })
    return { success: true, count: imported.ids.length, ids: imported.ids, batchId: imported.batchId }
  }))
}

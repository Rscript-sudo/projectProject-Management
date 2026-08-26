// 项目类型 → SOP 加载器（主进程 IPC）
// 真相源（优先级）：
//   1. userData/customSop/{code}/safety-notice.json  ← 用户上传（v1.x 新增）
//   2. src/shared/sop/{code}/safety-notice.json     ← 内置
// v1.2.1（2026-06-28 接入）：解决 SOP JSON 文件是死文件的问题
// v1.x（2026-08-19）：加 userData/customSop 优先级，支持用户自定义专业上传 SOP
//
// 调用流程：
//   1. 前端 ProjectView.handleSend → resolveProjectType(projectType)
//   2. 调 window.electronAPI.readSop({projectType, docType})
//   3. 主进程读 SOP JSON，返回 sections（每节必含要点+禁用术语）
//   4. buildDocPrompt 把 sections 拼进 sopInjection 注入 prompt
//
// 兜底：SOP 文件缺失 → 返回空对象，前端降级到 aiService.ts 内嵌 router 的 enabledSections/disabledSections 摘要

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { fileURLToPath } from 'url'
import { getProjectTypeProfile, normalizeProjectType } from '../../src/shared/projectProfile.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * SOP 文件路径解析（优先级：用户上传 → 内置源码 → null）
 *
 * 从 electron/ipc/sop.mjs 出发 → ../../src/shared/sop/
 */
function resolveSopPath(projectType) {
  const code = normalizeProjectType(projectType)
  // 没有该专业 SOP 时明确返回空，而不是悄悄套用土建 SOP。
  if (code === 'unclassified') return { code, path: null, source: null }

  // 1. 用户上传的 SOP（自定义专业或覆盖内置）
  const customPath = path.join(
    app.getPath('userData'),
    'customSop',
    code,
    'safety-notice.json'
  )
  if (fs.existsSync(customPath)) {
    return { code, path: customPath, source: 'custom' }
  }

  // 2. 内置 SOP（源码目录）
  const builtinPath = path.join(__dirname, '..', '..', 'src', 'shared', 'sop', code, 'safety-notice.json')
  if (fs.existsSync(builtinPath)) {
    return { code, path: builtinPath, source: 'builtin' }
  }

  return { code, path: null, source: null }
}

/**
 * 写用户自定义 SOP 到 userData/customSop/{code}/safety-notice.json
 * 校验：sections 是对象、_字数下限 是对象
 */
function writeCustomSop(code, sopData) {
  if (typeof sopData !== 'object' || sopData === null) {
    return { ok: false, error: 'SOP 必须是 JSON 对象' }
  }
  // 基础校验
  if (sopData.sections !== undefined && (typeof sopData.sections !== 'object' || Array.isArray(sopData.sections))) {
    return { ok: false, error: 'sections 必须是对象（key → 节内容）' }
  }
  if (sopData._字数下限 !== undefined && (typeof sopData._字数下限 !== 'object' || Array.isArray(sopData._字数下限))) {
    return { ok: false, error: '_字数下限 必须是对象（docType → 数字）' }
  }
  const targetDir = path.join(app.getPath('userData'), 'customSop', code)
  fs.mkdirSync(targetDir, { recursive: true })
  const targetPath = path.join(targetDir, 'safety-notice.json')
  // 原子写
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(sopData, null, 2), 'utf8')
  fs.renameSync(tempPath, targetPath)
  return { ok: true, path: targetPath }
}

/**
 * 删除用户自定义 SOP（恢复走内置）
 */
function removeCustomSop(code) {
  const targetPath = path.join(app.getPath('userData'), 'customSop', code, 'safety-notice.json')
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
    return { ok: true, removed: true }
  }
  return { ok: true, removed: false }
}

export function register(ipcMain) {
  /**
   * 读取项目类型 SOP
   * 入参：{projectType: '信息化', docType?: '安全通知书'}
   * 出参：{
   *   found: boolean,
   *   projectType: string,
   *   sopFile: string,         // 相对路径（用于校准声明展示）
   *   source: 'custom' | 'builtin' | null,  // v1.x：哪个来源
   *   sections: Array<{title, mustInclude, forbiddenTerms}>,
   *   globalForbiddenTerms: string[],
   *   minWords: number,        // 当前 docType 的字数下限
   * }
   *
   * 文件不存在 → 返回 found: false，前端降级
   */
  ipcMain.handle('sop:read', (_, params = {}) => {
    try {
      const { projectType = '未分类', docType = '' } = params
      const resolved = resolveSopPath(projectType)
      const profile = getProjectTypeProfile(resolved.code)
      if (!resolved.path || !fs.existsSync(resolved.path)) {
        return {
          found: false,
          projectType: profile.label,
          projectTypeCode: resolved.code,
          sopFile: resolved.path ? path.relative(path.join(__dirname, '..', '..'), resolved.path) : '',
          source: null,
          sections: [],
          globalForbiddenTerms: [],
          minWords: 0,
        }
      }

      const raw = JSON.parse(fs.readFileSync(resolved.path, 'utf8'))
      const sections = []
      for (const [key, value] of Object.entries(raw.sections || {})) {
        if (!value || typeof value !== 'object') continue
        sections.push({
          title: value.标题 || key,
          mustInclude: Array.isArray(value.必含要点) ? value.必含要点 : [],
          forbiddenTerms: Array.isArray(value.禁用术语) ? value.禁用术语 : [],
        })
      }

      // 取字数下限
      const minWords = (raw._字数下限 && docType && raw._字数下限[docType]) || 0

      return {
        found: true,
        projectType: profile.label,
        projectTypeCode: resolved.code,
        sopFile: path.relative(path.join(__dirname, '..', '..'), resolved.path),
        source: resolved.source,  // 'custom' | 'builtin'
        sections,
        globalForbiddenTerms: Array.isArray(raw._禁用条款) ? raw._禁用条款 : [],
        minWords,
      }
    } catch (e) {
      console.error('[sop:read] Error:', e.message)
      return {
        found: false,
        projectType: params.projectType || '未分类',
        sopFile: '',
        source: null,
        sections: [],
        globalForbiddenTerms: [],
        minWords: 0,
        error: e.message,
      }
    }
  })

  /**
   * 上传自定义 SOP（写入 userData/customSop/{code}/safety-notice.json）
   * 入参：{code, sopData}  code 是 projectType 的英文 code
   */
  ipcMain.handle('sop:uploadCustom', (_, params = {}) => {
    try {
      const { code, sopData } = params
      if (!code) return { ok: false, error: '缺少 code' }
      // 校验 code 是已注册的（内置或自定义）
      const normalized = normalizeProjectType(code)
      if (!normalized || normalized === 'unclassified') {
        return { ok: false, error: `未知专业 code：${code}` }
      }
      const result = writeCustomSop(normalized, sopData)
      if (result.ok) {
        console.log(`[sop:uploadCustom] 写入 ${normalized} SOP → ${result.path}`)
      }
      return result
    } catch (e) {
      console.error('[sop:uploadCustom] Error:', e.message)
      return { ok: false, error: e.message }
    }
  })

  /**
   * 删除自定义 SOP（恢复走内置）
   */
  ipcMain.handle('sop:removeCustom', (_, params = {}) => {
    try {
      const { code } = params
      if (!code) return { ok: false, error: '缺少 code' }
      const normalized = normalizeProjectType(code)
      return removeCustomSop(normalized)
    } catch (e) {
      console.error('[sop:removeCustom] Error:', e.message)
      return { ok: false, error: e.message }
    }
  })
}

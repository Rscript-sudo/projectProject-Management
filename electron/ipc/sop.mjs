// 项目类型 → SOP 加载器（主进程 IPC）
// 单一真相源：src/shared/sop/{projectType}/safety-notice.json
// v1.2.1（2026-06-28 接入）：解决 SOP JSON 文件是死文件的问题
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
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * SOP 文件路径解析
 * src/shared/sop/{projectType}/safety-notice.json
 *
 * 从 electron/ipc/sop.mjs 出发 → ../../src/shared/sop/
 */
function resolveSopPath(projectType) {
  // 标准化 key：信息化 → information
  const map = {
    '土建': 'civil',
    '市政': 'municipal',
    '房建': 'building',
    '信息化': 'information',
    '园林': 'landscape',
    '钢结构': 'steel',
    '装饰': 'decoration',
  }
  const folder = map[projectType] || 'civil'
  return path.join(__dirname, '..', '..', 'src', 'shared', 'sop', folder, 'safety-notice.json')
}

export function register(ipcMain) {
  /**
   * 读取项目类型 SOP
   * 入参：{projectType: '信息化', docType?: '安全通知书'}
   * 出参：{
   *   found: boolean,
   *   projectType: string,
   *   sopFile: string,         // 相对路径（用于校准声明展示）
   *   sections: Array<{title, mustInclude, forbiddenTerms}>,
   *   globalForbiddenTerms: string[],
   *   minWords: number,        // 当前 docType 的字数下限
   * }
   *
   * 文件不存在 → 返回 found: false，前端降级
   */
  ipcMain.handle('sop:read', (_, params = {}) => {
    try {
      const { projectType = '土建', docType = '' } = params
      const sopPath = resolveSopPath(projectType)
      if (!fs.existsSync(sopPath)) {
        return {
          found: false,
          projectType,
          sopFile: path.relative(path.join(__dirname, '..', '..'), sopPath),
          sections: [],
          globalForbiddenTerms: [],
          minWords: 0,
        }
      }

      const raw = JSON.parse(fs.readFileSync(sopPath, 'utf8'))
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
        projectType,
        sopFile: path.relative(path.join(__dirname, '..', '..'), sopPath),
        sections,
        globalForbiddenTerms: Array.isArray(raw._禁用条款) ? raw._禁用条款 : [],
        minWords,
      }
    } catch (e) {
      console.error('[sop:read] Error:', e.message)
      return {
        found: false,
        projectType: params.projectType || '土建',
        sopFile: '',
        sections: [],
        globalForbiddenTerms: [],
        minWords: 0,
        error: e.message,
      }
    }
  })
}
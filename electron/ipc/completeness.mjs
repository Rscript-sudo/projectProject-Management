import path from 'path'
import fs from 'fs'
import { safeCall } from './safe.mjs'
import { readProjectIndex } from './shared.mjs'

const PHASE_NAMES = {
  '01_项目前期': '项目前期',
  '02_准备阶段': '准备阶段',
  '03_实施阶段': '实施阶段',
  '04_验收阶段': '验收阶段',
  '05_缺陷责任期': '缺陷责任期',
}

const DOC_TYPE_DIRS = [
  { docType: '项目合同', phase: '01_项目前期', directory: '01_项目前期/01_项目合同' },
  { docType: '招标文件', phase: '01_项目前期', directory: '01_项目前期/02_招标文件' },
  { docType: '投标文件', phase: '01_项目前期', directory: '01_项目前期/03_投标文件' },
  { docType: '设计文件', phase: '02_准备阶段', directory: '02_准备阶段/01_设计文件' },
  { docType: '监理规划', phase: '02_准备阶段', directory: '02_准备阶段/02_监理规划' },
  { docType: '监理细则', phase: '02_准备阶段', directory: '02_准备阶段/03_监理细则' },
  { docType: '开工条件检查表', phase: '02_准备阶段', directory: '02_准备阶段/04_开工报审/01_开工条件检查表' },
  { docType: '承建资格报审', phase: '02_准备阶段', directory: '02_准备阶段/04_开工报审/02_承建资格报审' },
  { docType: '施工组织设计报审', phase: '02_准备阶段', directory: '02_准备阶段/04_开工报审/03_施工组织设计报审' },
  { docType: '总监任命书', phase: '02_准备阶段', directory: '02_准备阶段/04_开工报审/04_总监任命书' },
  { docType: '图纸会审', phase: '02_准备阶段', directory: '02_准备阶段/05_图纸会审' },
  { docType: '监理日志', phase: '03_实施阶段', directory: '03_实施阶段/01_监理日志' },
  { docType: '监理周报', phase: '03_实施阶段', directory: '03_实施阶段/02_监理周报' },
  { docType: '监理月报', phase: '03_实施阶段', directory: '03_实施阶段/03_监理月报' },
  { docType: '会议纪要', phase: '03_实施阶段', directory: '03_实施阶段/04_会议纪要' },
  { docType: '安全管理', phase: '03_实施阶段', directory: '03_实施阶段/05_安全管理' },
  { docType: '监理整改通知书', phase: '03_实施阶段', directory: '03_实施阶段/06_往来函件/01_监理整改通知书' },
  { docType: '监理安全通知书', phase: '03_实施阶段', directory: '03_实施阶段/06_往来函件/02_监理安全通知书' },
  { docType: '工程联系单', phase: '03_实施阶段', directory: '03_实施阶段/06_往来函件/03_工程联系单' },
  { docType: '工程函件', phase: '03_实施阶段', directory: '03_实施阶段/06_往来函件/04_工程函件' },
  { docType: '停工令', phase: '03_实施阶段', directory: '03_实施阶段/06_往来函件/05_停工令' },
  { docType: '专项汇报', phase: '03_实施阶段', directory: '03_实施阶段/07_专项汇报' },
  { docType: '项目进度', phase: '03_实施阶段', directory: '03_实施阶段/08_项目进度' },
  { docType: '安全资料', phase: '03_实施阶段', directory: '03_实施阶段/09_安全资料' },
  { docType: '问题清单', phase: '03_实施阶段', directory: '03_实施阶段/10_问题清单' },
  { docType: '审计报告', phase: '03_实施阶段', directory: '03_实施阶段/11_审计报告' },
  { docType: '施工方案', phase: '03_实施阶段', directory: '03_实施阶段/12_施工方案' },
  { docType: '监理总结', phase: '04_验收阶段', directory: '04_验收阶段/01_监理总结' },
  { docType: '进场报验', phase: '04_验收阶段', directory: '04_验收阶段/02_进场报验' },
  { docType: '隐蔽工程', phase: '04_验收阶段', directory: '04_验收阶段/03_隐蔽工程' },
  { docType: '分部分项验收', phase: '04_验收阶段', directory: '04_验收阶段/04_分部分项验收' },
  { docType: '竣工移交', phase: '04_验收阶段', directory: '04_验收阶段/05_竣工移交' },
  { docType: '缺陷责任期', phase: '05_缺陷责任期', directory: '05_缺陷责任期' },
]

function scanDirForFiles(dirPath, maxDepth = 20) {
  if (!fs.existsSync(dirPath)) return { fileCount: 0, lastModified: null }

  try {
    let latestMtime = null
    let fileCount = 0

    function countRecursive(currentPath, depth) {
      if (depth > maxDepth) return
      let entries
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true })
      } catch (e) {
        console.warn('[scanDirForFiles]', currentPath, e.message)
        return
      }
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        if (entry.isFile() && !entry.name.startsWith('.')) {
          fileCount++
          try {
            const stat = fs.statSync(fullPath)
            if (!latestMtime || stat.mtime > latestMtime) latestMtime = stat.mtime
          } catch (e) { console.warn('[scanDirForFiles]', fullPath, e.message) }
        } else if (entry.isDirectory()) {
          countRecursive(fullPath, depth + 1)
        }
      }
    }

    countRecursive(dirPath, 0)
    return { fileCount, lastModified: latestMtime ? latestMtime.toISOString() : null }
  } catch {
    return { fileCount: 0, lastModified: null }
  }
}

export function register(ipcMain) {
  ipcMain.handle('fs:scanProjectCompleteness', safeCall((_, projectPath) => {
    const projectName = path.basename(projectPath)
    const phases = {}

    for (const def of DOC_TYPE_DIRS) {
      const phaseName = PHASE_NAMES[def.phase] || def.phase
      if (!phases[def.phase]) {
        phases[def.phase] = { phase: def.phase, phaseName, items: [], completeCount: 0, totalCount: 0 }
      }

      const fullDir = path.join(projectPath, def.directory)
      const { fileCount, lastModified } = scanDirForFiles(fullDir)

      let status
      if (!fs.existsSync(fullDir)) {
        status = 'missing'
      } else if (fileCount === 0) {
        status = 'partial'
      } else {
        status = 'complete'
      }

      if (status === 'complete') phases[def.phase].completeCount++
      phases[def.phase].totalCount++

      phases[def.phase].items.push({
        docType: def.docType,
        phase: def.phase,
        phaseName,
        directory: def.directory,
        status,
        fileCount,
        lastModified,
      })
    }

    const phaseList = Object.values(phases).sort((a, b) => a.phase.localeCompare(b.phase))
    const totalFiles = phaseList.reduce((sum, p) => sum + p.items.reduce((s, i) => s + i.fileCount, 0), 0)
    const totalTypes = phaseList.reduce((sum, p) => sum + p.totalCount, 0)
    const completeTypes = phaseList.reduce((sum, p) => sum + p.completeCount, 0)

    return { projectPath, projectName, phases: phaseList, totalFiles, totalTypes, completeTypes }
  }))

  ipcMain.handle('fs:scanAllProjectsCompleteness', safeCall((_, rootPath) => {
    const index = readProjectIndex()
    const results = []

    for (const proj of index.projects) {
      if (!fs.existsSync(proj.path)) continue

      const projectName = path.basename(proj.path)
      const phases = {}
      let projectLatestMtime = null

      for (const def of DOC_TYPE_DIRS) {
        const phaseName = PHASE_NAMES[def.phase] || def.phase
        if (!phases[def.phase]) {
          phases[def.phase] = { phase: def.phase, phaseName, items: [], completeCount: 0, totalCount: 0 }
        }

        const fullDir = path.join(proj.path, def.directory)
        const { fileCount, lastModified } = scanDirForFiles(fullDir)

        let status
        if (!fs.existsSync(fullDir)) {
          status = 'missing'
        } else if (fileCount === 0) {
          status = 'partial'
        } else {
          status = 'complete'
        }

        if (status === 'complete') phases[def.phase].completeCount++
        phases[def.phase].totalCount++

        phases[def.phase].items.push({
          docType: def.docType,
          phase: def.phase,
          phaseName,
          directory: def.directory,
          status,
          fileCount,
          lastModified,
        })

        if (lastModified) {
          const mtime = new Date(lastModified)
          if (!projectLatestMtime || mtime > projectLatestMtime) {
            projectLatestMtime = mtime
          }
        }
      }

      const phaseList = Object.values(phases).sort((a, b) => a.phase.localeCompare(b.phase))
      const totalFiles = phaseList.reduce((sum, p) => sum + p.items.reduce((s, i) => s + i.fileCount, 0), 0)
      const totalTypes = phaseList.reduce((sum, p) => sum + p.totalCount, 0)
      const completeTypes = phaseList.reduce((sum, p) => sum + p.completeCount, 0)

      results.push({
        projectPath: proj.path,
        projectName,
        phases: phaseList,
        totalFiles,
        totalTypes,
        completeTypes,
        lastActivity: projectLatestMtime ? projectLatestMtime.toISOString() : null,
      })
    }

    const totalProjects = results.length
    const overallHealth = totalProjects > 0
      ? Math.round(results.reduce((sum, r) => sum + (r.totalTypes > 0 ? (r.completeTypes / r.totalTypes) * 100 : 0), 0) / totalProjects)
      : 0

    return { projects: results, totalProjects, overallHealth }
  }))
}
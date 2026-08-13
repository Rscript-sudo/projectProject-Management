import fs from 'fs'
import path from 'path'

const REGISTRY_FILE = 'template-registry.json'
// 与文档生成中心保持同一套文种。即使系统尚无内置模板，用户也能先导入自己的 Word 模板使用。
const SUPPORTED_DOC_TYPES = [
  '监理日志', '监理周报', '监理月报', '会议纪要', '整改通知书', '安全通知书', '工程联系单', '停工令',
  '开工通知', '竣工通知', '工程变更单', '工程款支付证书', '进度分析报告', '开工条件检查表',
  '承建资格报审表', '施工组织设计报审表', '总监理工程师任命书', '监理规划', '监理细则',
  '方案审核意见', '索赔报告', '巡视记录', '安全检查记录', '质量评估报告', '付款审核意见', '通用文档',
]

export function getTemplateRegistryPath(userDataPath) {
  return path.join(userDataPath, 'template-library', REGISTRY_FILE)
}

function readRegistry(userDataPath) {
  const registryPath = getTemplateRegistryPath(userDataPath)
  try {
    if (fs.existsSync(registryPath)) {
      const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      return { version: 1, templates: Array.isArray(data.templates) ? data.templates : [] }
    }
  } catch (e) {
    console.error('[templateRegistry] Failed to read registry:', e.message)
  }
  return { version: 1, templates: [] }
}

function writeRegistry(userDataPath, registry) {
  const registryPath = getTemplateRegistryPath(userDataPath)
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  const temporary = `${registryPath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), 'utf8')
  fs.renameSync(temporary, registryPath)
}

export function listTemplateLibrary(userDataPath) {
  return readRegistry(userDataPath).templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function importTemplateToLibrary({ userDataPath, sourcePath, docType, scope = 'professional', projectType = '通用', name }) {
  if (!SUPPORTED_DOC_TYPES.includes(docType)) throw new Error(`不支持的文种：${docType}`)
  if (!fs.existsSync(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.docx') throw new Error('请选择有效的 Word 模板文件')
  if (!['global', 'professional'].includes(scope)) throw new Error('模板范围无效')

  const registry = readRegistry(userDataPath)
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const safeName = path.basename(sourcePath).replace(/[^\w\u4e00-\u9fff.-]/g, '_')
  const targetDir = path.join(userDataPath, 'template-library', scope, projectType || '通用', docType)
  fs.mkdirSync(targetDir, { recursive: true })
  const targetPath = path.join(targetDir, `${id}_${safeName}`)
  fs.copyFileSync(sourcePath, targetPath)
  // 在导入时即扫描占位符：用户无需研究模板语法，也能判断模板是否可直接生成。
  const { getTemplatePlaceholders } = await import('./templateService.mjs')
  const fields = await getTemplatePlaceholders(targetPath)
  const entry = { id, name: name?.trim() || path.basename(sourcePath, '.docx'), docType, scope, projectType: scope === 'global' ? '通用' : (projectType || '通用'), path: targetPath, sourceName: path.basename(sourcePath), fields, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  registry.templates.push(entry)
  writeRegistry(userDataPath, registry)
  return entry
}

/** 编辑后的企业模板可重新扫描字段，不必再次导入或新建副本。 */
export async function refreshTemplateLibraryEntry({ userDataPath, templateId }) {
  const registry = readRegistry(userDataPath)
  const entry = registry.templates.find(item => item.id === templateId)
  if (!entry) throw new Error('未找到企业模板')
  if (!fs.existsSync(entry.path)) throw new Error('企业模板文件不存在')
  const { getTemplatePlaceholders } = await import('./templateService.mjs')
  entry.fields = await getTemplatePlaceholders(entry.path)
  entry.updatedAt = new Date().toISOString()
  writeRegistry(userDataPath, registry)
  return entry
}

export function resolveLibraryTemplate(userDataPath, { docType, projectType, selectedTemplateId }) {
  const templates = listTemplateLibrary(userDataPath).filter(item => item.docType === docType && fs.existsSync(item.path))
  if (selectedTemplateId) {
    const selected = templates.find(item => item.id === selectedTemplateId)
    if (selected) return selected
  }
  return templates.find(item => item.scope === 'professional' && item.projectType === projectType)
    || templates.find(item => item.scope === 'global')
    || null
}

export { SUPPORTED_DOC_TYPES }

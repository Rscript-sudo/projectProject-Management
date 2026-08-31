import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SUPPORTED_CODES = new Set([
  'civil', 'municipal', 'building', 'information', 'communication', 'power',
  'landscape', 'steel', 'decoration',
])

/** 正式件保存门禁：按项目专业 SOP 扫描跨专业禁用术语。 */
export function findProfessionalForbiddenTerms(projectTypeCode, content, sopRoot = path.resolve(__dirname, '..', '..', 'src', 'shared', 'sop')) {
  const code = String(projectTypeCode || '').trim()
  if (!SUPPORTED_CODES.has(code)) return []
  const sopPath = path.join(sopRoot, code, 'safety-notice.json')
  if (!fs.existsSync(sopPath)) return []
  const sop = JSON.parse(fs.readFileSync(sopPath, 'utf8'))
  const terms = [
    ...(sop._禁用条款 || []),
    ...Object.values(sop.sections || {}).flatMap(section => section?.禁用术语 || []),
  ]
  return [...new Set(terms.filter(term => term && String(content || '').includes(term)))]
}


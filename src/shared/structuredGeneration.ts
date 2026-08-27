import { parseStructuredContent } from '../services/aiService'

export interface StructuredDocumentEnvelope {
  schemaVersion: 1
  docType: string
  fields: Record<string, string>
  body: string
  sourceFormat: 'json' | 'legacy' | 'plain'
}

function extractJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!cleaned.startsWith('{')) return null
  try { return JSON.parse(cleaned) } catch { return null }
}

export function normalizeStructuredDocument(docType: string, content: string): StructuredDocumentEnvelope {
  const text = String(content || '').trim()
  const json = extractJson(text)
  if (json && typeof json === 'object') {
    const fields = Object.fromEntries(Object.entries(json.fields || {}).map(([key, value]) => [key, String(value ?? '').trim()]))
    const body = String(json.body || fields['正文内容'] || fields['正文'] || '').trim()
    if (body && !fields['正文内容']) fields['正文内容'] = body
    return { schemaVersion: 1, docType: String(json.docType || docType), fields, body, sourceFormat: 'json' }
  }
  const fields = parseStructuredContent(text)
  const hasFields = Object.keys(fields).length > 0
  const body = String(fields['正文内容'] || fields['正文'] || fields['内容'] || (hasFields ? '' : text)).trim()
  if (body && !fields['正文内容']) fields['正文内容'] = body
  return { schemaVersion: 1, docType, fields, body, sourceFormat: hasFields ? 'legacy' : 'plain' }
}

export function validateStructuredDocument(envelope: StructuredDocumentEnvelope, requiredFields: string[] = []) {
  const missing = requiredFields.filter(field => !String(envelope.fields[field] || '').trim())
  const errors: string[] = []
  if (!envelope.body && !Object.values(envelope.fields).some(Boolean)) errors.push('正文为空')
  if (missing.length) errors.push(`缺少字段：${missing.join('、')}`)
  return { valid: errors.length === 0, errors, missing }
}

/** @deprecated 无调用方，待清理 */
export function serializeStructuredDocument(envelope: StructuredDocumentEnvelope) {
  const entries = Object.entries(envelope.fields).filter(([, value]) => String(value).trim())
  if (!entries.length) return envelope.body
  return entries.map(([key, value]) => `【${key}】${value}`).join('\n\n')
}

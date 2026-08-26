const PLACEHOLDER_PATTERNS = [/待补充/g, /待核对/g, /\{[^{}]+\}/g, /\[TODO\]/gi]

export function evaluateAiDraft({ content = '', sop = {}, requiredFields = [], knownFacts = [] }) {
  const text = String(content)
  const forbiddenTerms = [
    ...(sop._禁用条款 || []),
    ...Object.values(sop.sections || {}).flatMap(section => section.禁用术语 || []),
  ]
  const crossSpecialtyTerms = [...new Set(forbiddenTerms.filter(term => term && text.includes(term)))]
  const missingFields = requiredFields.filter(field => !text.includes(field))
  const placeholders = [...new Set(PLACEHOLDER_PATTERNS.flatMap(pattern => text.match(pattern) || []))]
  const sourceMarkers = [...text.matchAll(/\[来源:(?:E|S)(\d+)\]/g)].map(match => match[0])
  const unsupportedFacts = knownFacts.length
    ? text.split(/[\u3002\uff01\uff1b\n]/).map(value => value.trim()).filter(Boolean)
      .filter(sentence => /\d/.test(sentence) && !knownFacts.some(fact => sentence.includes(fact)) && !/\[来源:(?:E|S)\d+\]/.test(sentence))
    : []
  const metrics = {
    fabricationCount: unsupportedFacts.length,
    missingFieldCount: missingFields.length,
    crossSpecialtyCount: crossSpecialtyTerms.length,
    placeholderCount: placeholders.length,
    evidenceMarkerCount: sourceMarkers.length,
  }
  return {
    passed: metrics.fabricationCount + metrics.missingFieldCount + metrics.crossSpecialtyCount + metrics.placeholderCount === 0,
    metrics, missingFields, crossSpecialtyTerms, placeholders, unsupportedFacts, sourceMarkers,
  }
}

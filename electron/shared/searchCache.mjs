/**
 * 根据影响搜索结果的字段生成稳定指纹。
 * 文档数不变但正文或 mtime 改变时，缓存必须失效。
 */
export function getDocsFingerprint(docs) {
  return docs.map(doc => [doc.id, doc.mtime, doc.fileName, doc.content, doc.docType].join('\u0001')).join('\u0002')
}

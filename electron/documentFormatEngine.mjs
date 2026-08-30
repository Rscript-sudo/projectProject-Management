/**
 * 统一文档排版引擎 v1.0
 *
 * 这是运行时唯一的版式真相源。模板、系统结构化文档和无模板降级文档
 * 均从这里读取页面、字体、字号、段落和页码规则。
 */

export const FORMAT_ENGINE_VERSION = '2.0.0'
export const FORMAT_SPEC_ID = 'gbt9704-2012-v1'
export const FORMAT_SPEC = Object.freeze({ id: FORMAT_SPEC_ID, version: FORMAT_ENGINE_VERSION, name: 'GB/T 9704-2012 工程文档排版规范', compatibleFrom: '1.0.0' })

export const PAGE = Object.freeze({
  width: 11906,
  height: 16838,
  margin: Object.freeze({ top: 2098, bottom: 1984, left: 1587, right: 1474, header: 720, footer: 720 }),
})

export const FONTS = Object.freeze({
  // PingFang SC 在 macOS/LibreOffice/WPS 的中英文回退最稳定；旧公文字体
  // 在未安装 Office 字体的机器上会只显示数字和拉丁字符，中文正文整段消失。
  title: 'PingFang SC',
  heading: 'PingFang SC',
  subheading: 'PingFang SC',
  body: 'PingFang SC',
  pageNumber: 'PingFang SC',
})

const bodyStyles = Object.freeze({
  title: Object.freeze({ font: FONTS.title, size: 44, bold: false, align: 'center', before: 0, after: 280, firstLine: 0 }),
  h1: Object.freeze({ font: FONTS.heading, size: 32, bold: false, align: 'left', before: 160, after: 0, firstLine: 0, keepNext: true }),
  h2: Object.freeze({ font: FONTS.subheading, size: 32, bold: true, align: 'left', before: 0, after: 0, firstLine: 0, keepNext: true }),
  h3: Object.freeze({ font: FONTS.body, size: 32, bold: false, align: 'left', before: 0, after: 0, firstLine: 0, keepNext: true }),
  h4: Object.freeze({ font: FONTS.body, size: 32, bold: false, align: 'left', before: 0, after: 0, firstLine: 0, keepNext: true }),
  body: Object.freeze({ font: FONTS.body, size: 32, bold: false, align: 'justify', before: 0, after: 0, firstLine: 640, line: 560 }),
  closing: Object.freeze({ font: FONTS.body, size: 32, bold: false, align: 'left', before: 160, after: 0, firstLine: 0, line: 560 }),
  meta: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'left', before: 0, after: 80, firstLine: 0, line: 440 }),
  tableHeader: Object.freeze({ font: FONTS.heading, size: 21, bold: true, align: 'center', firstLine: 0, line: 360 }),
  tableBody: Object.freeze({ font: FONTS.body, size: 21, bold: false, align: 'center', firstLine: 0, line: 360 }),
})

const tableCellStyles = Object.freeze({
  ...bodyStyles,
  title: Object.freeze({ ...bodyStyles.title, size: 40, after: 220 }),
  h1: Object.freeze({ font: FONTS.heading, size: 28, bold: true, align: 'left', before: 80, after: 0, firstLine: 0, keepNext: true }),
  h2: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'justify', before: 0, after: 0, firstLine: 560, keepNext: true }),
  h3: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'justify', before: 0, after: 0, firstLine: 0, left: 560, hanging: 560, keepNext: true }),
  h4: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'justify', before: 0, after: 0, firstLine: 560, keepNext: true }),
  body: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'justify', before: 0, after: 0, firstLine: 560, line: 420 }),
  closing: Object.freeze({ font: FONTS.body, size: 28, bold: false, align: 'right', before: 120, after: 0, firstLine: 0, line: 420 }),
  meta: Object.freeze({ font: FONTS.body, size: 24, bold: false, align: 'left', before: 0, after: 60, firstLine: 0, line: 400 }),
})

const TABLE_CELL_DOC_TYPES = new Set(['整改通知书', '安全通知书', '工程联系单', '停工令', '开工通知', '竣工通知'])
const FORM_DOC_TYPES = new Set(['监理日志', '开工条件检查表', '承建资格报审表', '施工组织设计报审表', '工程款支付证书', '总监理工程师任命书', '工程变更单'])

export function getLayoutLayer(docType = '') {
  if (TABLE_CELL_DOC_TYPES.has(docType)) return 'table_cell_layer'
  if (FORM_DOC_TYPES.has(docType)) return 'form_layer'
  return 'body_layer'
}

export function getFormatProfile(docType = '') {
  const layer = getLayoutLayer(docType)
  return Object.freeze({
    version: FORMAT_ENGINE_VERSION,
    specId: FORMAT_SPEC_ID,
    layer,
    page: PAGE,
    styles: layer === 'table_cell_layer' ? tableCellStyles : bodyStyles,
  })
}

export function detectParagraphRole(text = '') {
  const value = String(text).trim()
  if (/^[一二三四五六七八九十]+[、，。]/.test(value)) return 'h1'
  if (/^[（(][一二三四五六七八九十][）)]/.test(value)) return 'h2'
  if (/^\d+[.、]\s*/.test(value)) return value.length > 20 || value.includes('、') ? 'h3' : 'h3'
  if (/^[（(]\d+[）)]/.test(value)) return 'h4'
  if (/^(?:编制人|审核人|审批人|批准人|总监理工程师|编制单位|编制日期|报告日期|监理单位)/.test(value)) return 'closing'
  return 'body'
}

export function formatAuditFromXml(documentXml = '', stylesXml = '', docType = '', options = {}) {
  const profile = getFormatProfile(docType)
  const issues = []
  const pageSizeTag = documentXml.match(/<w:pgSz\b[^>]*\/>/)?.[0] || ''
  if (!options.preserveTemplateLayout && (!pageSizeTag.includes('w:w="11906"') || !pageSizeTag.includes('w:h="16838"'))) issues.push('纸张不是 A4')
  const margin = profile.page.margin
  const marginTag = documentXml.match(/<w:pgMar\b[^>]*\/>/)?.[0] || ''
  if (!options.preserveTemplateLayout && !['top', 'bottom', 'left', 'right'].every(key => marginTag.includes(`w:${key}="${margin[key]}"`))) issues.push('页边距未统一')
  if (/\{\{|\}\}|【待补充正文内容】|待补充正文内容/.test(documentXml)) issues.push('存在未完成占位内容')
  if (!documentXml.includes('<w:t')) issues.push('文档正文为空')
  if (!options.preserveTemplateLayout && !/FangSong_GB2312|仿宋_GB2312|仿宋|Songti SC|宋体|Arial Unicode MS|PingFang SC/.test(`${documentXml}${stylesXml}`)) issues.push('缺少可用中文正文字体')
  return { valid: issues.length === 0, issues, layer: profile.layer, version: profile.version, specId: profile.specId }
}

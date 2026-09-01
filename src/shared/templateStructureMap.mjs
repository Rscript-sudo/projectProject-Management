function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function cellText(html) {
  return decodeHtml(String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function spanValue(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`${name}=["']?(\\d+)`, 'i'))
  return Math.max(1, Number(match?.[1]) || 1)
}

const SHORT_INLINE_LABEL = /(?:[：:]$|名称|单位|日期|时间|编号|人员|负责人|经理|意见|结论|情况|记录|内容|说明|结果|备注|地点|部位|签字|会签)$/
const FIXED_STANDARD_TEXT = /符合|要求|规范|标准|应当|应按|牢固|平整|正确|良好|清晰|明晰|整齐|设计文件|填写说明/

function isWritableTrailingBlock(text, hasEmptyBlock) {
  if (!hasEmptyBlock) return false
  const normalized = String(text || '').trim()
  // Word 表格经常在固定标准文字后保留一个空段落。只有短标签或明确的叙述栏目
  // 才能把这个空段落视为填写区，防止把整段验收标准误识别成字段。
  return normalized.length > 0 && normalized.length <= 48 && !FIXED_STANDARD_TEXT.test(normalized) && SHORT_INLINE_LABEL.test(normalized)
}

/**
 * 把 mammoth HTML 转成适合 AI 推理的表格坐标图。
 * 标签文字和目标空白单元格分开表达，避免线性纯文本把表头误当填充值。
 */
export function extractTemplateTableStructure(html = '') {
  const tables = []
  const tableMatches = [...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
  for (const [tableIndex, tableMatch] of tableMatches.entries()) {
    const rows = []
    const rowMatches = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    for (const [rowIndex, rowMatch] of rowMatches.entries()) {
      const cells = []
      const cellMatches = [...rowMatch[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
      for (const [cellIndex, match] of cellMatches.entries()) {
        const text = cellText(match[3])
        const hasEmptyBlock = /<(?:p|div)\b[^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/(?:p|div)>/i.test(match[3])
          || /<(?:p|div)\b[^>]*>\s*(?:_+|＿+|—+|-+|（\s*）|\(\s*\))\s*<\/(?:p|div)>/i.test(match[3])
        const empty = !text || /^[_＿\-—（）()\s]+$/.test(text)
        cells.push({
          tableIndex,
          rowIndex,
          cellIndex,
          text,
          empty,
          hasEmptyBlock,
          fillable: empty || isWritableTrailingBlock(text, hasEmptyBlock),
          headerElement: match[1].toLowerCase() === 'th',
          colSpan: spanValue(match[2], 'colspan'),
          rowSpan: spanValue(match[2], 'rowspan'),
        })
      }
      rows.push({ rowIndex, cells })
    }
    tables.push({ tableIndex, rows })
  }
  return tables
}

export function buildTemplateStructureMap(html = '') {
  const tables = extractTemplateTableStructure(html)
  if (!tables.length) return '未提取到表格结构；只能使用段落锚点，禁止把固定标题或栏目名改成占位符。'
  // 大型检查表可能有数十至数百行。把整张表重复发送给模型既慢，也会让大量
  // 固定检查项淹没真正的填值位置。只发送候选行及少量首尾结构样本；坐标仍使用
  // 原始 table/row/cellIndex，因此后续确定性校验不受压缩影响。
  const compactTables = tables.map(table => {
    const lastRow = table.rows.length - 1
    const rows = table.rows.filter((row, index) => {
      const hasFillable = row.cells.some(cell => cell.fillable)
      const hasLabelCue = row.cells.some(cell => /[：:]$/.test(cell.text) || /名称|单位|日期|时间|编号|负责人|经理|结论|意见|备注/.test(cell.text))
      return hasFillable || hasLabelCue || index < 3 || index >= lastRow - 1
    }).slice(0, 24).map(row => ({
      r: row.rowIndex,
      c: row.cells.map(cell => ({
        c: cell.cellIndex,
        t: cell.text.slice(0, 120),
        f: cell.fillable ? 1 : 0,
        cs: cell.colSpan,
        rs: cell.rowSpan,
      })),
    }))
    return { t: table.tableIndex, totalRows: table.rows.length, rows }
  })
  return JSON.stringify({
    instruction: '压缩坐标：t=表，r=行，c=格，f=1才是可写值区，cs/rs=合并跨度。字段定位必须指向目标填值区域，不能覆盖标签文字；未列出的中间行是固定内容摘要，不逐项扩写。',
    tables: compactTables,
  })
}

const FIXED_HEADERS = new Set(['序号', '项目', '规格型号', '单位', '数量', '设计数量', '实际数量', '检查结果', '检查内容', '检查标准', '质量标准', '备注'])
const PROJECT_FIELDS = /^(?:工程名称|项目名称|项目编号|工程编号|建设单位|施工单位|监理单位|设计单位|项目监理机构)$/
const AI_FIELDS = /意见|结论|情况|记录|内容|说明|措施|原因|问题/
const LABEL_CUE = /名称|单位|日期|时间|编号|人员|负责人|经理|意见|结论|情况|记录|内容|说明|结果|备注|地址|地点|范围|金额|数量|工期|电话|联系人|是否|要求|依据|签字|会签/
const ANSWER_LIKE = /^(?:正常|异常|一般|符合要求|不符合要求|一致|不一致|有|无|已.{0,6}|未.{0,6}|万用表|读表)$/
const NARRATIVE_SECTIONS = ['施工当日完成主要工作量', '工程质量检查、试验情况及施工重点、关键部位旁站记录', '施工过程中存在的问题及汇报处理情况', '前期问题的跟踪处理情况', '安全文明施工记录', '其他情况', '施工情况', '发现情况', '处理意见', '综合评价及意见', '简图及综合评价']

function suggestionFor(label, placement = {}) {
  const raw = String(label || '').replace(/[：:（）()\s]/g, '')
  // 长句通常是检查标准或已填写样例，绝不能截取尾部 12 字伪造字段名。
  if (!raw || (!placement.allowLong && raw.length > 24) || /[，。；;]/.test(raw) || FIXED_STANDARD_TEXT.test(raw)) return null
  const name = raw
  if (!name || FIXED_HEADERS.has(name)) return null
  const mode = PROJECT_FIELDS.test(name) ? 'project' : AI_FIELDS.test(name) ? 'ai' : 'ai'
  const isProject = mode === 'project'
  const isCheckRecord = /检查记录$/.test(name)
  return {
    name,
    label: name,
    mode,
    hint: isProject ? '从项目资料读取正式值，不得改写或推测' : `仅从用户输入或已归档资料提取“${name}”；不得推测`,
    reason: '根据模板标签与相邻填值区确定',
    anchorText: String(label || '').trim(),
    insertPosition: 'after',
    ...placement,
    rule: {
      source: isProject ? '项目资料' : '用户输入与项目资料',
      requirement: isProject ? '读取项目正式值，不改写' : isCheckRecord ? `只填写用户或现场记录明确提供的“${name}”事实；没有对应检查事实时留空，不得用通用监理话术填满检查表` : `仅整理或提取已明确提供的“${name}”，不得补造事实`,
      required: false,
      minWords: 0,
      maxWords: isProject ? 80 : isCheckRecord ? 80 : 300,
      antiFabrication: true,
      missingInfoPolicy: '留空',
    },
  }
}

/**
 * 本地快速识别：常见“标签 + 空白值区”和段落冒号字段无需等待大模型。
 * 只返回结构能确定的字段；复杂语义仍可回退到 AI。
 */
export function deriveTemplateFieldSuggestions(content = '', html = '') {
  const result = []
  const seen = new Set()
  const add = item => {
    if (!item) return
    const placement = {
      tableIndex: item.tableIndex,
      rowIndex: item.rowIndex,
      cellIndex: item.cellIndex,
      paragraphIndex: item.paragraphIndex,
      anchorText: item.anchorText,
      insertPosition: item.insertPosition,
      block: item.block === true,
      prefix: item.prefix,
      replaceTail: item.replaceTail === true,
    }
    if (seen.has(item.name)) {
      const existing = result.find(entry => entry.name === item.name)
      if (existing) existing.placements = [...(existing.placements || [placement]), placement]
      return
    }
    seen.add(item.name)
    item.placements = [placement]
    result.push(item)
  }
  const tables = extractTemplateTableStructure(html)
  for (const table of tables) {
    for (const row of table.rows) {
      const nonempty = row.cells.filter(cell => !cell.empty)
      const next = table.rows[row.rowIndex + 1]
      for (const cell of row.cells) {
        const cellLabel = cell.text.replace(/[：:]$/, '').trim()
        const inlineMatch = cell.text.match(/^([^：:]{2,24})[：:]$/)
        if (inlineMatch) add(suggestionFor(inlineMatch[1], {
          tableIndex: table.tableIndex,
          rowIndex: row.rowIndex,
          cellIndex: cell.cellIndex,
        }))
        const sameCellProject = cell.text.match(/^(工程名称|项目名称|项目编号|工程编号|建设单位|施工单位|监理单位|设计单位|项目监理机构)([：:])(.+)$/)
        if (sameCellProject) add(suggestionFor(sameCellProject[1], {
          tableIndex: table.tableIndex,
          rowIndex: row.rowIndex,
          cellIndex: cell.cellIndex,
          insertPosition: 'replace',
          prefix: `${sameCellProject[1]}${sameCellProject[2]}`,
        }))
        const narrativeName = NARRATIVE_SECTIONS.find(name => cellLabel === name || cellLabel.startsWith(`${name} `))
        if (!narrativeName) continue
        add(suggestionFor(narrativeName, {
          tableIndex: table.tableIndex,
          rowIndex: row.rowIndex,
          cellIndex: cell.cellIndex,
          block: true,
          allowLong: true,
        }))
      }
      // 已填写过的样例模板也需要参数化。项目主数据标签右侧若仍是固定文本，
      // 把值单元格标为 replace，避免生成结果混入旧项目名称或旧参建单位。
      for (const cell of row.cells) {
        if (!PROJECT_FIELDS.test(cell.text.replace(/[：:]$/, '').trim())) continue
        const valueCell = row.cells[cell.cellIndex + 1]
        if (!valueCell || valueCell.empty || /\{\{[^}]+\}\}/.test(valueCell.text)) continue
        const item = suggestionFor(cell.text, { tableIndex: table.tableIndex, rowIndex: row.rowIndex, cellIndex: valueCell.cellIndex })
        if (item) {
          item.insertPosition = 'replace'
          item.reason = '项目字段右侧仍为固定样例值，生成前应替换为项目资料'
          add(item)
        }
      }
      // 多列表头 + 下一行多空格是明细数据区。每列建立独立字段，保证渲染时
      // 值进入对应单元格；旧版单一“工程量明细行”会把整行文本挤进第一窄列。
      if (nonempty.length >= 3 && next?.cells.filter(cell => cell.fillable).length >= 3) {
        for (const header of nonempty) {
          const target = next.cells[header.cellIndex]
          if (!target?.fillable || /^(?:序号|项目)$/.test(header.text)) continue
          const item = suggestionFor(`表格行${header.text}`, { tableIndex: table.tableIndex, rowIndex: target.rowIndex, cellIndex: target.cellIndex })
          if (item) {
            item.anchorText = header.text
            item.hint = `仅提取用户明确提供的“${header.text}”原始值；未提供时留空，不得补造`
            item.rule.requirement = item.hint
            add(item)
          }
        }
        continue
      }
      // 检查表采用“检查项目/检查标准/检查记录/检查结论”列。标准是固定依据，
      // 只把记录与结论的空格映射为字段；结论后续按人工确认字段处理。
      const headerRow = table.rows.find(candidate => candidate.cells.some(cell => cell.text === '检查记录') && candidate.cells.some(cell => cell.text === '检查结论'))
      const qualityEndRow = headerRow ? table.rows.find(candidate => candidate.rowIndex > headerRow.rowIndex && candidate.cells.some(cell => cell.text === '工程量统计'))?.rowIndex : undefined
      if (headerRow && row.rowIndex > headerRow.rowIndex && (qualityEndRow == null || row.rowIndex < qualityEndRow) && /^\d+$/.test(row.cells[0]?.text || '')) {
        const recordHeader = headerRow.cells.find(cell => cell.text === '检查记录')
        const conclusionHeader = headerRow.cells.find(cell => cell.text === '检查结论')
        const itemCell = row.cells.find((cell, index) => index > 0 && /[\u4e00-\u9fa5]/.test(cell.text) && cell.text.length <= 16)
        if (itemCell) {
          const recordTarget = row.cells[recordHeader?.cellIndex]
          const conclusionTarget = row.cells[conclusionHeader?.cellIndex]
          if (recordTarget?.fillable) add(suggestionFor(`${itemCell.text}检查记录`, { tableIndex: table.tableIndex, rowIndex: row.rowIndex, cellIndex: recordTarget.cellIndex, block: true }))
          if (conclusionTarget?.fillable) add(suggestionFor(`${itemCell.text}检查结论`, { tableIndex: table.tableIndex, rowIndex: row.rowIndex, cellIndex: conclusionTarget.cellIndex }))
        }
      }
      for (const cell of row.cells) {
        if (!cell.fillable) continue
        const left = row.cells[cell.cellIndex - 1]
        if (!left?.text || FIXED_HEADERS.has(left.text) || ANSWER_LIKE.test(left.text) || !LABEL_CUE.test(left.text)) continue
        add(suggestionFor(left.text, { tableIndex: table.tableIndex, rowIndex: row.rowIndex, cellIndex: cell.cellIndex }))
      }
      // “栏目标题 + 同格空段落”是监理日志等模板常见的长文本填写区。
      for (const cell of row.cells) {
        if (!cell.hasEmptyBlock || !cell.fillable || cell.empty) continue
        add(suggestionFor(cell.text, { tableIndex: table.tableIndex, rowIndex: row.rowIndex, cellIndex: cell.cellIndex, block: true }))
      }
    }
  }
  // 表格之外以及带示例值的模板常用“字段名：示例”形式。逐行判断冒号后的
  // 内容：非项目字段已经带有长正文时通常是检查标准（如“埋深及沟底处理：…”），
  // 不能把它当成待填写字段；一行并列多个空签字栏则仍分别保留。
  for (const line of String(content).split(/\r?\n/)) {
    const matches = [...line.matchAll(/([\u4e00-\u9fa5A-Za-z（）()]{2,14})([：:])/g)]
    for (const [index, match] of matches.entries()) {
      const label = match[1].replace(/^.*[。；;，,]/, '').trim()
      const tailStart = (match.index || 0) + match[0].length
      const tailEnd = matches[index + 1]?.index ?? line.length
      const tail = line.slice(tailStart, tailEnd).trim()
      if (tail && !PROJECT_FIELDS.test(label)) continue
      add(suggestionFor(label, { anchorText: `${label}${match[2]}`, replaceTail: PROJECT_FIELDS.test(label) && Boolean(tail) }))
    }
  }
  return result.slice(0, 120)
}

/**
 * 文件选择后自动给出文种/资料包名称。复合 DOCX 不再被输入框默认值绑成“监理日志”。
 */
export function inferTemplateDocumentType(content = '', filename = '', { sitePackage = false } = {}) {
  const text = String(content || '')
  const knownForms = [
    '监理日志', '进场材料检查表', '旁站监理记录表', '施工质量检查表',
    '直埋工艺及隐蔽工程检查表', '随工验收、隐蔽工程检查签证记录',
    '监理通知单', '监理周报', '监理月报', '工程联系单', '验收报告',
  ].filter(name => text.includes(name))
  const forms = [...new Set(knownForms)]
  if (sitePackage && forms.length > 1) {
    return { docType: '站点综合资料包', compound: true, forms }
  }
  if (forms[0]) return { docType: forms[0], compound: false, forms }
  const base = String(filename || '').replace(/\.(?:docx|xlsx)$/i, '').replace(/模板$/i, '').trim()
  return { docType: base || (sitePackage ? '站点资料包' : '未命名模板'), compound: false, forms: [] }
}

/** AI 坐标不可信时按真实表格结构纠偏；无法找到值区的表格标签建议直接丢弃。 */
export function reconcileTemplateFieldPlacements(fields = [], html = '') {
  const tables = extractTemplateTableStructure(html)
  if (!tables.length) return fields
  const at = (tableIndex, rowIndex, cellIndex) => tables[tableIndex]?.rows[rowIndex]?.cells[cellIndex]
  return fields.map(field => {
    const direct = at(field?.tableIndex, field?.rowIndex, field?.cellIndex)
    const anchors = [field?.anchorText, field?.label, field?.name].map(value => String(value || '').replace(/[：:]$/, '').trim()).filter(Boolean)
    const normalizedDirect = String(direct?.text || '').replace(/[：:]$/, '').trim()
    // Word 模板常把“日期：”“施工情况：”或整行叙述栏目与其填写区放在同一个
    // 单元格中。mammoth 不一定输出空段落，cell.fillable 会是 false，但仍可按
    // 已确认的精确文字锚点在同格追加。精确匹配可避免把固定检查标准放宽成字段。
    const isExactAnchoredCell = direct && anchors.some(anchor => normalizedDirect === anchor)
    if (direct?.fillable
      || (isExactAnchoredCell && field?.insertPosition === 'after')
      || (field?.insertPosition === 'replace' && PROJECT_FIELDS.test(String(field?.name || '')))) return field
    for (const table of tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          const normalizedCell = cell.text.replace(/[：:]$/, '').trim()
          if (!anchors.some(anchor => normalizedCell === anchor)) continue
          const candidates = [
            cell.hasEmptyBlock ? cell : null,
            row.cells[cell.cellIndex + 1],
            table.rows[row.rowIndex + 1]?.cells[cell.cellIndex],
          ].filter(candidate => candidate?.fillable)
          const target = candidates[0]
          if (target) return { ...field, tableIndex: target.tableIndex, rowIndex: target.rowIndex, cellIndex: target.cellIndex }
          // 找到了表格标签但没有任何可填区域：它是固定表头，不应成为 AI 字段。
          return null
        }
      }
    }
    return field
  }).filter(Boolean)
}

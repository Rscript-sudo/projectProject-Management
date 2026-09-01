export type TemplateStructureCell = {
  tableIndex: number
  rowIndex: number
  cellIndex: number
  text: string
  empty: boolean
  hasEmptyBlock: boolean
  fillable: boolean
  headerElement: boolean
  colSpan: number
  rowSpan: number
}

export function extractTemplateTableStructure(html?: string): Array<{
  tableIndex: number
  rows: Array<{ rowIndex: number; cells: TemplateStructureCell[] }>
}>

export function buildTemplateStructureMap(html?: string): string
export function deriveTemplateFieldSuggestions(content?: string, html?: string): Array<Record<string, unknown>>
export function inferTemplateDocumentType(content?: string, filename?: string, options?: { sitePackage?: boolean }): { docType: string; compound: boolean; forms: string[] }
export function reconcileTemplateFieldPlacements<T>(fields?: T[], html?: string): T[]

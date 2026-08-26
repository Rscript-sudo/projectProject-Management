// v1.x：内置文种全量清单（唯一真相源）
//
// 以前这份 26 项清单在四处各自手抄（CustomDocTypesPanel / DocTypePromptEditor /
// TemplateCenterModal / electron/templateRegistry.mjs.SUPPORTED_DOC_TYPES）。
// 统一收敛到 canonical JSON `builtin-doc-types.json`：
//   - 渲染层：本文件 import 该 JSON 并导出（三处组件引用本文件）
//   - 主进程：electron/templateRegistry.mjs 用 fs 读取同一份 JSON
//
// 注意：这与 docTypePrompts.default.json 的「有默认提示词的 16 类」是不同维度。
// 这里是全量 26 个内置文种；那 16 类是有专属扩写提示词的子集。
import builtin from './builtin-doc-types.json'

export const BUILTIN_DOC_TYPES = builtin as readonly string[]

export type BuiltinDocType = (typeof BUILTIN_DOC_TYPES)[number]

// v1.x：开箱即用的内置文种清单（唯一真相源）
//
// 以前的全量清单在四处各自手抄（CustomDocTypesPanel / DocTypePromptEditor /
// TemplateCenterModal / electron/templateRegistry.mjs.SUPPORTED_DOC_TYPES）。
// 统一收敛到 canonical JSON `builtin-doc-types.json`：
//   - 渲染层：本文件 import 该 JSON 并导出（三处组件引用本文件）
//   - 主进程：electron/templateRegistry.mjs 用 fs 读取同一份 JSON
//
// 进入本清单必须同时满足：有真实模板、至少一个占位符、已有专属 AI 扩写规则。
// 其他文种由用户通过“新增文种 + 上传模板 + 配置规则”自行建立。
import builtin from './builtin-doc-types.json'

export const BUILTIN_DOC_TYPES = builtin as readonly string[]

export type BuiltinDocType = (typeof BUILTIN_DOC_TYPES)[number]

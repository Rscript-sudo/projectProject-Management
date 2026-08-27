# 项目总览

> 本文件是项目开发的**总说明文档**与**唯一基线**，面向二次开发与标准化建设。所有"项目是什么/架构/数据模型/完成度"的问题都以本文件为准。agent 速查指令见根目录 `AGENTS.md`，测试见 `docs/TESTING.md`，发布见 `RELEASE.md`。
> 最近一次梳理：2026-08-27。以 `package.json` + 代码为真相源。

---

## 一、项目定位

面向监理行业的**项目文档一体化管理桌面应用**。所有能力装在一个 Electron 应用里，本地运行，数据不出本机。

- **核心能力**：AI 流式生成 26 类监理公文 + 全文检索 + 往来函件台账 + 隐患联动闭环 + 进度/投资/合同/照片管理 + 多项目驾驶舱 + 交付包生成 + 自动更新 + 项目备份
- **栈**：Electron 42 + React 19 + TS 5 + Vite 6 + Ant Design 5 + better-sqlite3 + docxtemplater
- **入口**：`electron/main.mjs`（主进程）· `src/main.tsx`（React 根）· `src/App.tsx`（路由）
- **打包产物**：macOS arm64 dmg（开发机）· Windows nsis + portable（CI 出，详见 `RELEASE.md`）
- **当前版本**：v1.4.0（见 `package.json`，详见 `CHANGELOG.md`）

---

## 二、架构骨架

### 三层进程

| 层 | 目录 | 角色 |
|----|------|------|
| 渲染层 | `src/` | React + Ant Design UI；通过 `window.electronAPI.*` 调 IPC |
| 主进程 | `electron/` | Node.js 业务逻辑；SQLite / 文件 / 模板 / AI 调用，全 `.mjs` |
| 桥接 | `electron/preload.cjs` | contextBridge 暴露 IPC；`src/vite-env.d.ts` 同步类型契约 |

### 主进程模块（`electron/`）

| 文件 | 角色 |
|---|---|
| `main.mjs` | 主进程入口；崩溃防护 + DB 初始化 + 窗口创建 |
| `ipc/register.mjs` | **集中挂载所有 `ipcMain.handle`**，新增 IPC 必须在此注册 |
| `ipc/<biz>.mjs` | 每业务一个文件（约 28 个）：`doc` / `sop` / `db` / `filename` / `numbering` / `completeness` / `contract` / `dashboard` / `delivery` / `material` / `payment` / `photo` / `progress` / `project` / `release` / `template` / `shell`(AI) 等 |
| `templateService.mjs` | **模板核心**：`findTemplate` / `buildPlaceholderData` / `renderTemplate` / `renderStructuredSystemDocument` / `renderXlsxTemplate` / `formatDocx`(GB/T 9704) / `validateDeliverableContent` / `sanitize*` 系列 |
| `documentFormatEngine.mjs` | 文档格式引擎 |
| `completenessEngine.mjs` | 完整性引擎 |
| `materialParser.mjs` | 材料解析 |
| `operationCenter.mjs` | 运营中心 |
| `placeholderScan.mjs` | 占位符扫描 + 白名单 |
| `templateRegistry.mjs` | 企业/项目模板库注册表 |
| `db/database.mjs` | SQLite 初始化（WAL 模式）+ 全部建表 DDL |
| `db/migrations.mjs` | schema 迁移 |
| `db/repo.mjs` | 数据访问层 |
| `shared/postProcess.mjs` | 主进程版反编造（与前端 aiService.ts 同源） |
| `shared/pathSafety.mjs` | `isPathSafe` 路径白名单 |

### 渲染层模块（`src/`）

| 文件 | 角色 |
|---|---|
| `services/aiService.ts` | **AI 唯一入口**：`buildDocPrompt` 按 docType 分 case / `postProcess*Guard` / `sanitizeFieldValue` / `sanitizeLetterStyle` / `extractSubject` / `identifyDocType` / `getDocSavePath` / `PROJECT_TYPE_ROUTER` |
| `pages/ProjectView.tsx` | **AI 文档助手**入口（流式 + 非流式两路径都要走 sanitize 防线） |
| `pages/{Inspection,Progress,Payment,Contract,PhotoArchive,DeliveryCenter,PortfolioDashboard,TemplateCenter}View.tsx` | 各业务模块 |
| `shared/` | **字段真相源**：`field-aliases.json` / `project-type-router.json` / `doc-type-min-words.json` / `sop/<type>/*.json` / `builtin-doc-types.json` / `completeness-rules.json` |

### 数据模型（`electron/db/database.mjs`）

一个项目 = `project_meta` 一行 + N 份不同 docType 的公文。核心表：

| 表 | 用途 | 唯一键 |
|---|---|---|
| `project_meta` | 项目元信息（施工单位/业主/合同金额/起止日期） | `project_name` |
| `numbering_rules` | 编号规则（按 docType） | `(project_name, doc_type)` |
| `ledger_simple` | 通用台账（合同/会议/方案/日志） | `(project_name, ledger_type, file_name, created_at)` |
| `correspondence` | 函件业务字段（整改/安全/联系单/函件/停工令）+ 状态机 | `id` |
| `hazard` | 隐患（关联 correspondence 形成闭环） | `id` |
| `progress_node` | 进度节点（横道图数据源，支持父子层级） | `id` |
| `payment_request` / `contract` / `change_order` / `claim` / `photo` | 投资/合同/照片 | `id` |
| `evidence_item` / `document_master_snapshot` | 证据链 + 文档主快照 | `id` |

---

## 三、核心流程：文档生成（详见 `docs/文档生成流程.md`）

```
用户输入 → identifyDocType → buildDocPrompt → callAIStream(SSE)
  → 流式反编造清洗(第2层) → 字数补足 → sanitizeFieldValue
  → 用户点保存 → fs:saveDoc
  → 主进程反编造再过(第3-7层) + 占位符白名单扫描
  → 文件名生成(虚竹v2.0) → 三选一渲染(xlsx/结构化/docxtemplater)
  → GB/T 9704 格式化 → 占号(TOCTOU锁) → 原子落盘 → 双台账登记
```

### 反编造 7 层防线（改 AI 文案必动全链路）

铁律：**禁止 AI 编造**具体时间 / 场景 / 人员 / 法规条款。

| # | 时机 | 位置 |
|---|---|---|
| 1 | prompt 拼装 | `aiService.ts` `ANTI_FABRICATION_RULES` + `buildDocPrompt` typeRules + `PROOF_EXAMPLES` |
| 2 | 流式/非流式返回后 | `ProjectView.tsx` `postProcessFabricationGuard` + `postProcessTimeFields` |
| 3 | 主进程 saveDoc 入口 | `ipc/doc.mjs` 同源双实现 |
| 4 | saveDoc 字数校验前 | `validateDeliverableContent`（markers + forbiddenTerms） |
| 5 | saveDoc 渲染前 | `scanForLeftoverPlaceholders`（白名单） |
| 6 | docxtemplater 渲染后 buffer | `templateService.mjs` 解 zip 扫占位符 |
| 7 | saveDoc 落盘前 | `validateDeliverableContent(renderedText)` 兜底 |

### 三条渲染分支

| 引擎 | 触发条件 | 函数 |
|---|---|---|
| **xlsx** | `config.engine === 'xlsx'` | `renderXlsxTemplate` |
| **结构化系统版式** | 无 override + 无 libraryTemplate + 在白名单 7 类文种 | `renderStructuredSystemDocument` |
| **docxtemplater 真模板** | 项目/企业库覆盖了模板 | `renderTemplate` |

> ⚠️ 白名单内 7 类文种（监理日志/周报/月报/整改通知/安全通知/工程联系单/进度分析）的"系统预置 docx 模板"默认不会被使用。要让真模板生效，必须配项目级 `templateOverrides` 或企业模板库。

### 项目类型 → SOP 路由

`PROJECT_TYPE_ROUTER`（aiService.ts 顶部）按 7 类项目（土建/市政/房建/信息化/园林/钢结构/装饰）加载不同 SOP。**禁止跨类型混用术语**（信息化项目禁用塔吊/扬尘/木工等土建术语），`sanitizeForbiddenTerms` 做兜底。SOP 素材在 `src/shared/sop/<type>/safety-notice.json`。

### 占位符白名单（`placeholderScan.mjs`）

三套：合法残留（`{{未指定时间}}` / `{{待补充：...}}` / `{{CURRENT_DATE}}`）、12 项必填手动填充字段、FieldRegistry alias。不在白名单的 `{{xxx}}` → 阻止保存。

---

## 四、IPC 契约

新增 IPC 必须三处同步（`npm run verify:ipc` 会拦）：

1. `electron/ipc/<biz>.mjs` 里 `ipcMain.handle('channel', ...)`
2. `electron/ipc/register.mjs` 集中挂载
3. `electron/preload.cjs` 暴露 + `src/vite-env.d.ts` 加类型声明

---

## 五、开发命令

```bash
npm run dev               # vite (5173, strictPort) + electron
npm run typecheck         # tsc --noEmit（仅 include src/，不查 electron/）
npm run verify:ipc        # 校验 IPC 契约
npm test                  # node --test test/*.test.mjs（纯逻辑单测）
npm run test:e2e:smoke    # 最小冒烟
npm run test:e2e          # 全部 *.e2e.mjs（需 Electron 环境）
npm run quality:gate      # verify:ipc -> typecheck -> test -> test:e2e -> build:renderer -> npm audit
npm run build             # macOS dmg（本机）
./release.sh vX.Y.Z "msg" # 出 Windows EXE + GitHub Release
```

- 跑单个 e2e：`electron test/<name>.e2e.mjs`；单个单测：`node --test test/<name>.test.mjs`。
- 没有 lint 脚本。类型检查用 `typecheck`。

---

## 六、必懂的坑

- **better-sqlite3 是 native 模块**：装依赖后需 `npx electron-rebuild -f -w better-sqlite3`；ABI 不匹配就 `npm rebuild better-sqlite3`。CI 已内置。
- **vite dev 跑通 ≠ asar 打包跑通**：改完主进程代码必须 `npm run build`（或 `electron-builder --dir`）装机实测。
- **ESM 主进程没有 `__dirname`**：每个 `electron/**/*.mjs` 顶部都要 `const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename)`。
- **vite.config.ts 禁用 manualChunks**：antd 5 + react 19 手动分块会触发循环依赖 / createContext 丢失 / TDZ。不要重新开启。
- **`tsconfig.json` 只 `include: ["src"]`**：`electron/` 不进类型检查，靠 `verify:ipc` + e2e 兜底。

---

## 七、关键约定

- **数据实事求是**：禁止 AI 在周报/月报里估算百分比；数据不足先问，禁止凑数。
- **用户输入是信息源不是逐字稿**：AI 必须归纳，禁止照抄。`extractSubject` 清理头尾命令词。
- **文件名统一走** `electron/ipc/filename.mjs`：`{YYYYMMDD}_{typeCode}_{projectCode}_{summary}_{version}.docx`，禁止各模块自己拼。
- **外部操作（写文件 / 推 git / 发消息）变更前先问**；内部操作（读文件 / 整理）可自主。
- **字段真相源**在 `src/shared/`，不要在别处重复定义。
- **发布与构建默认流程**（除非老板特别说明）：修 bug / 完成新功能后，**只做本地构建 + 代码提交，不推 GitHub、不打 tag、不做 Release**。
  - 本地构建：`npm run build`（macOS dmg 装机验证）。
  - 代码提交：`git add` + `git commit`，**不 `git push`、不 `./release.sh`、不打 tag**。
  - 推 GitHub / 触发 CI / 出 Windows EXE / 建 Release 一律等老板明确指示后才做。

---

## 八、发布

> ⚠️ 默认不发布。只有老板明确说"发布/出包/推 GitHub"时才执行本节流程。

`./release.sh vX.Y.Z "msg"` → push main + 打 tag → CI（`.github/workflows/build-windows.yml`，windows-latest）5-10 分钟后出 Windows EXE 并自动建 GitHub Release。macOS 本机验证用 `npm run build` 出 dmg 装机。版本号规则与故障恢复见 `RELEASE.md`。

---

## 九、文档索引

| 文档 | 用途 |
|---|---|
| `AGENTS.md` | agent 速查指令（开发命令 + 坑 + 关键约定） |
| `docs/PROJECT_OVERVIEW.md` | 本文件，项目总览（开发唯一基线） |
| `docs/文档生成流程.md` | 文档生成全链路 + 7 层防线详细行号 |
| `docs/TESTING.md` | 测试总文档（分层策略 + 如何加测试 + 覆盖面） |
| `RELEASE.md` | 发布流程 + 版本号规则 + 推错救法 |
| `CHANGELOG.md` | 更新日志（版本变更唯一记录） |
| `templates/format-spec/DOCX格式规范.json` | DOCX 格式规范真相源 |

---

## 十、需求完成情况与未完成分析

> 2026-08-26 深度审计。以代码为真相源，对照 v1.0.0 规划与实际实现。
> 项目开发较零散，本节梳理各模块的真实完成度，供二次开发与标准化建设参考。

### 已完成（代码已实现并接入）

| 模块 | 完成度 | 证据 |
|---|---|---|
| **AI 文档生成** | ✅ 完整 | 26 类内置 docType（`builtin-doc-types.json`）+ 自定义 docType + 流式 SSE + 7 层反编造防线 + 字数补足 + 字段清洗 |
| **AI 多 Provider** | ✅ 完整 | `providerConfigs` 支持 deepseek / qwen 等；apiKey 主进程安全存储（v1.0.6 脱敏） |
| **项目类型 SOP 路由** | ✅ 完整 | 7 类项目（土建/市政/房建/信息化/园林/钢结构/装饰）SOP JSON **全部已建**（`src/shared/sop/<type>/safety-notice.json`） |
| **模板系统** | ✅ 完整（v1.3.4 编辑闭环） | 通用模板 20 个（内置）+ 企业/专业/私人模板库 + 项目级 override + 三条渲染分支。模板 AI 扩写编辑中心支持占位符增删、AI 重试/手动兜底及另存私人模板；v1.3.3 起专业模板改为用户上传 |
| **全文检索** | ✅ 完整 | FlexSearch 引擎，Docx/Xlsx 全文索引，跨项目搜索（`search:query/rebuild/status`） |
| **往来函件台账** | ✅ 完整 | 6 类函件 + 5 维度检索 + 状态机（已发出/已回复/已复查/已关闭/超期）+ 自动归档 |
| **隐患联动闭环** | ✅ 完整 | 巡检 → 隐患入台账 → 生成整改通知 → 回执关闭（`hazard` 表关联 `correspondence`） |
| **进度控制** | ✅ 完整 | 节点式横道图（手写 SVG）+ 偏差分析 + 月度对比 + 父子层级 |
| **投资控制** | ✅ 完整 | 5 级审批流 + 累计金额汇总 + 与支付证书联动 |
| **合同管理** | ✅ 完整 | 合同/变更/索赔台账 + 到期预警 |
| **照片归档** | ✅ 完整 | 拖拽上传 + 按月归档 + EXIF + AI 识别归档（`photo:aiArchive`/`recognizeImages`） |
| **SQLite 持久化** | ✅ 完整 | 24 张表 + WAL 模式 + 迁移系统（`migrations.mjs`）+ 主数据变更追溯 |
| **完整性引擎** | ✅ 完整 | 30 类期望文档按阶段扫描（`completenessEngine.mjs`）+ 项目/全项目扫描 + 导出报告 |
| **多项目驾驶舱** | ✅ 完整 | `PortfolioDashboardView` + `dashboard:portfolio` |
| **交付包生成** | ✅ 完整 | `delivery:batchGenerate` + `delivery:createPackage` |
| **运营中心** | ✅ 完整 | 异步任务队列（create/cancel/retry/list/clearFinished）+ 诊断 |
| **自动更新** | ✅ 完整 | `update:check`（查 GitHub Release）+ `update:download`（跳转下载） |
| **项目备份/恢复** | ✅ 完整 | `project:createBackup/listBackups/restoreBackup` |
| **DB 导出** | ✅ 完整 | `db:export`（checkpoint 导出） |
| **聊天会话** | ✅ 完整 | `chat:createSession/listSessions/openSession/archiveSession` + 历史持久化 |
| **自定义类型** | ✅ 完整 | 自定义 docType + 自定义项目类型（`settings:listCustomDocTypes/listCustomProjectTypes`） |
| **Windows 打包** | ✅ 完整 | CI（`build-windows.yml`）出 NSIS + Portable，tag 触发自动 Release |
| **macOS 打包** | ✅ 完整 | 本机 `npm run build` 出 dmg |
| **安全加固** | ✅ 完整（v1.3.1） | IPC 路径校验（`isPathSafe` 全覆盖）+ SQL 表名白名单 + `assertSafeProjectName` 全覆盖 + 防 prompt 注入（`wrapUserInput`）+ 配置原子写 + XSS 防护（`renderMarkdown` 先转义）+ electron 安全配置（nodeIntegration:false / contextIsolation:true / sandbox:true） |

### 未完成 / 待完善

| 项 | 状态 | 说明 | 影响 |
|---|---|---|---|
| **代码签名** | ❌ 未做 | CI 无 CSC/EV 证书配置，Windows 安装被 SmartScreen 拦截 | 用户体验差，需手动点"仍要运行" |
| **多项目并发** | ❌ 未做 | 单窗口单项目，不支持多开实例 | 同时管多个项目需切换 |
| **自动升级（静默）** | ⚠️ 半成品 | `update:download` 仅 `shell.openExternal` 跳转浏览器下载，非应用内静默升级 | 用户需手动下载安装包覆盖 |
| **移动端预览** | ⚠️ 半成品 | `ProjectView.css` 有 `@media` 响应式断点，但无完整移动端适配 | 桌面端为主，移动端不可用 |
| **latest.yml 自动升级** | ⚠️ 未启用 | CI 已生成 `latest.yml`，但 `--publish never`，未配 `generic` provider | 自动升级链路断 |
| **CHANGELOG 同步** | ✅ 已修（v1.3.1） | `CHANGELOG.md` 已补齐 v1.1.0~v1.3.1，版本可追溯 |
| **SOP 内容深度** | ✅ 已对齐（v1.3.2） | 7 类 SOP JSON 全部补齐到信息化深度：8 节 / 45-47 要点 / 标题+适用工艺+禁用术语齐全 / 字数下限 5 类文种 | 跨类型生成质量一致 |
| **结构化模板白名单** | ✅ 已加提示（v1.3.2） | 白名单 7 类文种在模板中心显示「系统版式」徽标 + Alert 说明"要用自己的模板请导入企业模板库" | 用户知情，不再困惑 |

### 文档与代码的偏差（已修正）

本次审计发现并已修正的文档过时点：

| 项 | 修正前 | 修正后 |
|---|---|---|
| 内置 docType 数 | 21 类 | 26 类 |
| SOP 覆盖 | 仅 information，6 类延期 | 7 类全建 |
| 自动更新 | 开发中 | 已实现（check + download） |
| 备份/导出 | 未提及 | 已实现 |

### 二次开发建议优先级

1. **P0 代码签名**：申请 EV 证书，CI 加 `CSC_LINK` 配置，消除 SmartScreen 拦截（老板拍板后续再做）
2. **P1 静默自动升级**：接入 `electron-updater` + `generic` provider，启用 `latest.yml` 链路
3. **P2 多项目并发**：评估多窗口或多标签架构，支持同时打开多个项目

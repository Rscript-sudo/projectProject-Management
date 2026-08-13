# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目定位

Electron 桌面应用，把"监理业务（虚竹）"的 21 类公文生成能力嵌入桌面端。

- **栈**：Electron 42 + React 19 + TS 5 + Vite 6 + Ant Design 5 + better-sqlite3 + docxtemplater
- **入口**：electron/main.mjs（主进程）· src/main.tsx（React 根）· src/App.tsx（路由）
- **打包产物**：macOS arm64 dmg（开发机）· Windows nsis + portable（CI 出，详见 RELEASE.md）

---

## 常用命令

```bash
npm run dev               # 开发模式：vite (5173) + electron，concurrently 拉起
npm run build:renderer    # 只跑 vite build
npm run build             # 产物出 release/项目文档管理系统-1.1.0-arm64.dmg（macOS 当前机）
npm run build:win         # Windows 构建（需在 Windows runner 上跑，本地会卡住）
./release.sh v1.x.x       # 一行命令：commit + push + tag + 触发 CI 自动出 Windows EXE
```

- **没有 lint / test 脚本**（package.json scripts 里没有）。类型检查靠 `npm run build:renderer` 的 vite 编译。
- **better-sqlite3 是 native 模块**，装依赖后会被 `@electron/rebuild` 重新编译；如果遇到 ABI 不匹配就 `npm rebuild better-sqlite3`。
- **改完代码必须打包 + 装机实测**。老板的反馈流程是：本地装 dmg → 跑真实场景 → 抓真实生成的 `.preview.docx` → AI 读出真问题再修。**不要**只靠 dev 模式验。

---

## 架构骨架

### 三层进程

| 层 | 目录 | 角色 |
|----|------|------|
| 渲染层 | `src/` | React + Ant Design UI；通过 `window.electronAPI.*` 调 IPC |
| 主进程 | `electron/` | Node.js 业务逻辑；SQLite / 文件 / 模板 / AI 调用 |
| 桥接 | `electron/preload.cjs` | contextBridge 暴露 IPC；`src/vite-env.d.ts` 同步类型 |

### 主进程业务模块

`electron/ipc/` 下每个业务一个 `.mjs`：

- `register.mjs` — **集中挂载所有 `ipcMain.handle`**，新增 IPC 必须在这里注册
- `doc.mjs` — 文档生成入口（`fs:saveDoc` / `fs:exportPDF`），是反编造三层防线的**第二、三层宿主**
- `sop.mjs` — 项目类型 SOP JSON 读取（`sop:read`）
- `db.mjs` · `database.mjs` · `migrations.mjs` · `repo.mjs` — SQLite 三件套
- `filename.mjs` · `numbering.mjs` · `placeholderScan.mjs` — 文件命名 + 编号引擎 + 占位符扫描

### 渲染层入口

- `src/pages/ProjectView.tsx` — **AI 文档助手**入口（流式 + 非流式两条路径都要走 sanitize 三层防线）
- `src/pages/{InspectionView,ProgressView,PaymentView,ContractView,PhotoArchiveView}.tsx` — B 阶段六大业务模块
- `src/services/aiService.ts` — **唯一 AI 入口**：`buildDocPrompt` 按 16 种 docType 分 case，`postProcessTimeFields` / `postProcessFabricationGuard` / `sanitizeFieldValue` / `sanitizeLetterStyle`（v1.2.7 新增）三层清洗
- `src/shared/` — **字段真相源**：`field-aliases.json`（FieldRegistry alias）· `project-type-router.json`（项目类型 → SOP）· `doc-type-min-words.json`（字数下限）· `sop/{civil|municipal|building|information|landscape|steel|decoration}/safety-notice.json`（动态加载的扩写素材）

### 反编造三层防线（每次改 AI 文案必动）

老板铁律：**禁止 AI 编造**（具体时间 / 场景 / 人员 / 法规条款）。三处都要补：

| 层 | 位置 | 触发时机 |
|----|------|---------|
| 1️⃣ Prompt 防线 | `src/services/aiService.ts` `ANTI_FABRICATION_RULES`（九节）+ `buildDocPrompt` 各 case 的 typeRules + `PROOF_EXAMPLES` | AI 调 prompt 时 |
| 2️⃣ Parse-time 防线 | `src/services/aiService.ts` `sanitizeFieldValue` + `sanitizeLetterStyle`（v1.2.7 新增），导出供 ProjectView 流式/非流式两路径调用 | AI 输出解析时 |
| 3️⃣ 渲染前兜底 | `electron/templateService.mjs` `sanitizeBodyContent` + `sanitizeForbiddenTerms` + `sanitizeLetterStyle`（v1.2.7 同步）+ `electron/placeholderScan.mjs`（保存时扫白名单） | docx 渲染时 / 保存时 |

### 项目类型 → SOP 路由

`PROJECT_TYPE_ROUTER`（内嵌在 aiService.ts 顶部）按 7 类项目（土建/市政/房建/信息化/园林/钢结构/装饰）加载不同 SOP ：

- **禁止跨类型混用术语**（信息化项目禁用塔吊/扬尘/木工等土建术语）。v1.2.5 起的 `sanitizeForbiddenTerms`（templateService.mjs）做兜底。
- **只有 `src/shared/sop/information/safety-notice.json` 已建**；其他 6 类 SOP JSON 暂未补，老板拍板延期。

### 占位符白名单

`electron/placeholderScan.mjs` 管三套：

1. `EXPECTED_PLACEHOLDER_RE` — `{{未指定时间}}` / `{{待补充：...}}` / `{{CURRENT_DATE}}`（AI 主动注入的合法残留）
2. `MANUAL_FILL_PLACEHOLDERS`（12 项）— 三段划分🟡必填字段（监理部联系电话 / 项目编号 / 责任人姓名 / 具体时间 等）
3. FieldRegistry alias — 字段别名表，AI 写的字段名映射到模板占位符

不在白名单的 `{{xxx}}` → 报"AI 输出含未替换占位符"阻止保存。

---

## 关键约定

- **数据实事求是**：禁止 AI 在周报/月报里估算百分比。数据不足先问老板，禁止凑数。
- **用户输入是信息源不是逐字稿**：AI 必须归纳，禁止照抄老板输入。`extractSubject` (aiService.ts) 负责清理头尾命令词。
- **文件名走虚竹 v2.0**：`{YYYYMMDD}_{typeCode}_{projectCode}_{summary}_{version}.docx`，统一从 `electron/ipc/filename.mjs` 调，禁止各模块自己拼。
- **变更前先问**：老板对外部操作（写文件 / 推 git / 发消息）要求确认；内部操作（读文件 / 整理）可自主。
- **ESM 没有 `__dirname`**：主进程每个文件都要 `const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename)`。vite dev 跑通 ≠ asar 打包跑通，必须 `electron-builder --dir` 实测（教训已入 memory/lessons.md）。

---

## 老板改完代码后

```bash
./release.sh v1.x.x "feat: 描述改动"
```

脚本会自动：commit + push + 打 tag + 推 tag → CI 5-10 分钟后在 GitHub Releases 出现 Windows EXE。本地 macOS 验证用 `npm run build` 出 dmg 装机即可。
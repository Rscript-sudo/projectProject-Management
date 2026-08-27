# AGENTS.md

Electron 桌面应用：把"监理业务"26 类公文生成能力嵌入桌面端。栈 = Electron 42 + React 19 + TS 5 + Vite 6 + Ant Design 5 + better-sqlite3 + docxtemplater。

> **文档唯一基线**：
> - 架构全貌 + 数据模型 + 模块清单 + 完成度 → `docs/PROJECT_OVERVIEW.md`
> - 文档生成全链路 + 7 层反编造防线行号 → `docs/文档生成流程.md`
> - 测试分层 + 如何加测试 → `docs/TESTING.md`
> - 发布流程 + 版本号 + 推错救法 → `RELEASE.md`
> - 版本变更记录 → `CHANGELOG.md`
>
> 本文件只放 agent 开发时**必查的速查项**，不重复上述文档内容。

## 常用命令

```bash
npm run dev               # vite (5173, strictPort) + electron，concurrently 拉起
npm run typecheck         # tsc --noEmit（仅 include src/，不查 electron/）
npm run verify:ipc        # 校验 IPC 契约：handler 唯一 + preload 调用都有注册 + vite-env.d.ts 有类型
npm test                  # node --test test/*.test.mjs（纯逻辑单测，不启 Electron）
npm run test:e2e:smoke    # electron test/e2e.mjs（最小冒烟）
npm run test:e2e          # 跑全部 *.e2e.mjs（16 个，较慢，需 Electron 环境）
npm run quality:gate      # verify:ipc -> typecheck -> test -> test:e2e -> build:renderer -> npm audit
npm run build:renderer    # 只跑 vite build
npm run build             # build:renderer + electron-builder（macOS dmg，本机）
npm run build:win         # Windows 构建——本地 macOS 跑会卡住，只在 Windows runner / CI 跑
./release.sh v1.x.x "msg" # commit + push + tag + 推 tag → CI 自动出 Windows EXE + GitHub Release
```

- **没有 lint 脚本**。类型检查用 `npm run typecheck`（不是 CLAUDE.md 说的 build:renderer）。
- **跑单个 e2e**：`electron test/<name>.e2e.mjs`（例如 `electron test/civil-full-chain.e2e.mjs`）。
- **跑单个单测**：`node --test test/<name>.test.mjs`。

## 必懂的坑

- **better-sqlite3 是 native 模块**。装依赖后需 `npx electron-rebuild -f -w better-sqlite3`；ABI 不匹配就 `npm rebuild better-sqlite3`。CI（`.github/workflows/build-windows.yml`）已内置这步。
- **vite dev 跑通 ≠ asar 打包跑通**。改完主进程代码必须 `npm run build`（或 `electron-builder --dir`）装机实测，不要只靠 dev 模式验。
- **ESM 主进程没有 `__dirname`**：每个 `electron/**/*.mjs` 顶部都要 `const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename)`。
- **vite.config.ts 禁用 manualChunks**（注释里有详细原因：antd 5 + react 19 手动分块会触发循环依赖 / createContext 丢失 / TDZ）。不要重新开启。
- **`tsconfig.json` 只 `include: ["src"]`**——`electron/` 不进类型检查。主进程是 `.mjs`（纯 JS），靠 `verify:ipc` + e2e 兜底。

## 新增 IPC 必须三处同步

`verify:ipc` 会拦，缺一处就 fail：

1. `electron/ipc/<biz>.mjs` 里 `ipcMain.handle('channel', ...)`
2. `electron/ipc/register.mjs` 集中挂载（所有 handler 在此注册）
3. `electron/preload.cjs` 暴露 + `src/vite-env.d.ts` 加类型声明

## 改 AI 文案必动

铁律：**禁止 AI 编造**具体时间 / 场景 / 人员 / 法规条款。`aiService.ts` 是**唯一 AI 入口**，`buildDocPrompt` 按 docType 分 case。

改 AI 文案时三处都要补（详见 `docs/文档生成流程.md` 7 层防线总表）：
1. **Prompt 层**：`aiService.ts` `ANTI_FABRICATION_RULES` + `buildDocPrompt` 各 case typeRules + `wrapUserInput`（防 prompt 注入）
2. **Parse 层**：`ProjectView.tsx` `sanitizeFullPipeline` 统一管道（流式/续写/非流式三路径共用）
3. **渲染前兜底**：`electron/templateService.mjs` `sanitize*` 系列 + `electron/placeholderScan.mjs`（白名单）

## 关键约定

- **数据实事求是**：禁止 AI 在周报/月报里估算百分比；数据不足先问，禁止凑数。
- **用户输入是信息源不是逐字稿**：AI 必须归纳，禁止照抄。`extractSubject` (aiService.ts) 清理头尾命令词。
- **文件名统一走** `electron/ipc/filename.mjs`：`{YYYYMMDD}_{typeCode}_{projectCode}_{summary}_{version}.docx`，禁止各模块自己拼。
- **外部操作（写文件 / 推 git / 发消息）变更前先问**；内部操作（读文件 / 整理）可自主。
- **字段真相源**在 `src/shared/`：`field-aliases.json` / `project-type-router.json` / `doc-type-min-words.json` / `sop/**`。不要在别处重复定义。
- **项目类型 SOP 路由**：`PROJECT_TYPE_ROUTER` 按 7 类项目加载不同 SOP，**禁止跨类型混用术语**（信息化项目禁用塔吊/扬尘/木工等土建术语），`sanitizeForbiddenTerms` 做兜底。
- **占位符白名单**：`placeholderScan.mjs` 管三套（合法残留 / 12 项必填 / FieldRegistry alias），不在白名单的 `{{xxx}}` → 阻止保存。
- **模板策略（v1.3.3 减法后）**：只内置 `templates/通用/` 20 个通用模板；专业模板靠用户上传到企业模板库（`templateRegistry.mjs`）。`templates/专业/` 已废弃，首次启动由 `migrateBuiltinProfessionalTemplates` 自动迁移到企业库后删除。`buildTemplateCatalog` 只扫描通用目录。
- **发布默认不做**（除非老板特别说明）：修 bug / 完成新功能后只做 `npm run build` 本地构建 + `git commit` 代码提交，**不 push、不打 tag、不 `./release.sh`、不建 Release**。推 GitHub / 出 Windows EXE 一律等老板明确指示。

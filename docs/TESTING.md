# 测试总文档

> 本文件是项目测试的唯一基线：测试策略、分层、如何加测试、覆盖面。agent 速查命令见 `AGENTS.md`。
> 最近一次梳理：2026-08-27。以 `package.json` 的 test 脚本 + `test/` 目录为真相源。

---

## 一、测试分层

| 层 | 跑什么 | 命令 | 启 Electron？ | 速度 |
|----|--------|------|--------------|------|
| **单测** | 纯逻辑（无 IPC / 无 Electron / 无文件系统副作用） | `npm test` | 否 | 快（秒级） |
| **e2e 冒烟** | 最小可用链路（应用能起 + 核心窗口） | `npm run test:e2e:smoke` | 是 | 中 |
| **e2e 全量** | 16 个端到端场景（真实 Electron + 真实文件系统） | `npm run test:e2e` | 是 | 慢（分钟级） |
| **质量门** | 上述全链 + 类型 + IPC 契约 + 安全审计 | `npm run quality:gate` | 是 | 最慢 |

**何时跑哪层**：
- 改渲染层逻辑 / 工具函数 → `npm test` + `npm run typecheck`
- 改 IPC / 主进程 → 至少 `npm run test:e2e:smoke`；改 saveDoc / 模板渲染 → 跑相关 e2e
- 发版前 / 大改后 → `npm run quality:gate`
- 改完主进程代码**必须** `npm run build` 装机实测（dev 跑通 ≠ asar 打包跑通）

---

## 二、单测（`test/*.test.mjs`，5 个）

用 Node.js 原生 `node --test` runner，不依赖任何测试框架。

| 文件 | 覆盖 |
|------|------|
| `ai-quality-evaluation.test.mjs` | AI 文案质量评估逻辑 |
| `core-regression.test.mjs` | 核心回归（反编造 / 字段清洗 / 时间字段） |
| `document-format-engine.test.mjs` | DOCX 格式引擎（GB/T 9704 字体 / 行距 / 页边距） |
| `material-parser.test.mjs` | 材料解析器 |
| `structured-generation.test.mjs` | 结构化系统文档生成（`renderStructuredSystemDocument`） |

**跑单个**：`node --test test/<name>.test.mjs`

**加单测**：
1. 在 `test/` 新建 `<feature>.test.mjs`
2. 顶部 `import { test, describe } from 'node:test'` + `import assert from 'node:assert/strict'`
3. 测纯函数，**不要** import electron / better-sqlite3 / fs（那些进 e2e）
4. `npm test` 会自动扫到（glob `test/*.test.mjs`）

---

## 三、e2e（`test/*.e2e.mjs`，16 个）

用 Electron 真实跑，测端到端链路（IPC → 主进程 → 文件系统 → 渲染层回显）。

| 文件 | 覆盖场景 |
|------|---------|
| `e2e.mjs` | 冒烟：应用能起 + 主窗口 + 基础 IPC |
| `completeness-engine.e2e.mjs` | 完整性引擎 |
| `evidence-chain.e2e.mjs` | 证据链 |
| `import-delivery.e2e.mjs` | 交付物导入 |
| `dashboard-release.e2e.mjs` | 仪表盘发布 |
| `project-security.e2e.mjs` | 项目安全（路径校验 / 越权） |
| `project-template.e2e.mjs` | 项目模板 |
| `template-priority.e2e.mjs` | 模板优先级（三级回退） |
| `multi-project-template-generation.e2e.mjs` | 多项目模板生成 |
| `project-profile-delivery.e2e.mjs` | 项目档案交付 |
| `document-rules.e2e.mjs` | 文档规则（反编造门禁） |
| `reporting-integrity.e2e.mjs` | 报告完整性（数据实事求是） |
| `system-template-generation.e2e.mjs` | 系统模板生成 |
| `template-ai-full-flow.e2e.mjs` | 模板 AI 全流程 |
| `civil-full-chain.e2e.mjs` | 土建全链路（最重） |
| `operation-center.e2e.mjs` | 运营中心 |

**另有一个真实 AI 调用测试**（需 API key，不进默认链）：
- `civil-ai-expansion.real.e2e.mjs` → `npm run test:e2e:real-ai`

**跑单个**：`electron test/<name>.e2e.mjs`

**加 e2e**：
1. 在 `test/` 新建 `<feature>.e2e.mjs`
2. 参考 `test/e2e.mjs` 的启动样板（`app.electronApp` / `app.firstWindow()`）
3. 测真实 IPC + 文件系统，可在临时目录建项目
4. 加进 `package.json` 的 `test:e2e` 脚本链（末尾追加 `&& electron test/<name>.e2e.mjs`）

---

## 四、质量门（`npm run quality:gate`）

全链顺序，任一步失败即停：

```
verify:ipc        → IPC 契约校验（handler 唯一 + preload 调用都有注册 + 类型声明齐）
  ↓
typecheck         → tsc --noEmit（仅 src/）
  ↓
test              → 5 个单测
  ↓
test:e2e          → 冒烟 + 15 个 e2e
  ↓
build:renderer    → vite build
  ↓
npm audit         → 依赖安全审计（--omit=dev）
```

**何时必跑**：发版前 / 大重构后 / 改了 IPC 契约。

---

## 五、IPC 契约校验（`verify:ipc`）

不是测试，是**契约校验**，但归入质量门。检查三处同步：

1. `electron/ipc/<biz>.mjs` 的 `ipcMain.handle('channel', ...)` — handler 必须唯一
2. `electron/preload.cjs` 的 `contextBridge.exposeInMainWorld` 调用 — 每个 preload 暴露的调用都要有对应 handler
3. `src/vite-env.d.ts` — 每个暴露的调用都要有 TypeScript 类型声明

**新增 IPC 漏任一处 → `verify:ipc` fail**。详见 `AGENTS.md` "新增 IPC 必须三处同步"。

---

## 六、覆盖面与已知缺口

**已覆盖**：
- 反编造防线（单测 `core-regression` + e2e `document-rules` / `reporting-integrity`）
- 模板三级回退（e2e `template-priority`）
- 结构化文档生成（单测 `structured-generation`）
- DOCX 格式（单测 `document-format-engine`）
- 路径安全 / 越权（e2e `project-security`）
- 多项目并发（e2e `multi-project-template-generation`）

**已知缺口**（低优先级，不阻塞发布）：
- PDF 导出链路无专门 e2e（走 `fs:exportPDF`，复用反编造防线但无独立断言）
- SSE 流式断流重连无自动化测试（手动验证）
- Windows 真机安装验收靠人工（清单见 `RELEASE.md`）

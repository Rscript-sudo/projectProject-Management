# 更新日志

> 所有重要变更按版本倒序记录。版本号见 `package.json`，tag 见 `git tag -l`。
> v1.2.x / v1.3.x 未打 tag，从 commit log 推断，标注 ⚠️。

---

## 未发布

### 模板 AI 扩写编辑闭环
- feat: AI 扩写界面的模板资源树新增「私人模板库」，展示用户保存的私人模板并支持直接选用
- feat: 模板 AI 扩写编辑中心支持新增、删除占位符，修改结果写回模板文件并同步模板注册表
- feat: 新增「另存为私人模板」，系统/通用/专业模板可复制为独立私人副本后继续编辑
- fix: 模板来源切换使用明确模板 ID，修复界面已切换但仍加载旧模板的问题
- feat: AI 模板识别失败后同时提供「自定义占位符」与「重试 AI 模板识别」，不再卡死在 AI 路径
- test: 新增模板占位符增删写回与私人模板解析优先级回归测试
- fix: 建立全局窗口缩放/页面收缩基线，模板编辑器在窄窗口下由三栏自动重排为两栏/单栏，长文种标题使用响应式字号与省略显示
- feat: 自定义占位符改为在「原始模板映射」中点击目标位置后就地输入，保存时按锚点写回 DOCX
- feat: AI 文档助手的模板资源树常驻显示「私人模板库」，并明确区分通用模板与当前项目模板库

## v1.3.3 · 2026-08-27 · ⚠️ 未打 tag

> 模板做减法：移除 `templates/专业/` 9 类预置专业模板，专业模板改为用户上传 + 分析 + 扩写规则。

### 模板做减法
- feat: 新增 `migrateBuiltinProfessionalTemplates`（`templateRegistry.mjs`），首次启动检测 `templates/专业/` 存在时，递归遍历 81 个 docx（电力 8 + 通信 46 + 信息化 27），按文件名推断 docType（匹配内置 26 类则用内置，否则建自定义文种），批量导入企业模板库（scope=professional），删源目录，写 `.professional-migrated` 标记防重复
- feat: `main.mjs` 启动入口 `app.whenReady` 挂载迁移调用（在 `bootstrapCustomTypes` 之前），失败仅 warn 不阻塞启动
- refactor: `buildTemplateCatalog`（`templateService.mjs`）精简为只扫描 `templates/通用/`，移除专业扫描分支 + 旧扁平布局回退（约 50 行）
- 设计: 前端 TemplateCenter 保留「专业模板」树节点作为用户上传入口，不再展示系统预置专业模板

### 文档
- docs: PROJECT_OVERVIEW.md 模板系统完成度更新（101 docx → 20 通用 + 企业库用户上传）+ 二次开发建议移除已完成的「模板做减法」项
- docs: AGENTS.md 加模板策略说明（只内置通用，专业靠用户上传）

---

## v1.3.2 · 2026-08-27 · ⚠️ 未打 tag

> 结构化模板白名单「设计陷阱」修复 + 7 类项目 SOP 内容深度对齐。

### 体验修复
- fix: 模板中心对白名单 7 类文种（监理日志/周报/月报/整改通知/安全通知/工程联系单/进度分析）显示「系统版式」徽标 + Tooltip 说明，Card 顶部加 Alert 提示"要用自己的模板请导入企业模板库"，消除"有模板却没用"的困惑

### SOP 内容深度对齐
- feat: 以信息化 SOP 为样板，将土建/房建/市政/园林/钢结构/装饰 6 类 `safety-notice.json` 全部补齐到同等深度
  - 每类 8 个 section，每个含「标题/适用工艺/必含要点（6 条具体到数字）/禁用术语」
  - 顶层 `_适用项目类型` 扩展（每类 7-9 种）、`_禁用条款` 补全（每类 7-8 条跨类型禁用项）、`_字数下限` 统一 5 类文种（加安全通知书 800）
  - 跨类型生成质量一致，禁用术语兜底防混用（如信息化禁用塔吊/扬尘，土建禁用机柜/UPS）

### 文档
- docs: PROJECT_OVERVIEW.md 更新 SOP 完成度（⚠️→✅）+ 白名单项（⚠️→✅）+ 二次开发建议重排
- docs: 文档生成流程.md 行号修正 + 「以函数名为准」免责声明
- docs: TESTING.md 新建测试总文档
- docs: AGENTS.md 精简为 agent 速查（删与 PROJECT_OVERVIEW 重复内容）
- docs: RELEASE.md 补「默认不发布」前置说明
- chore: 删除过时的 RELEASE_NOTES_v1.0.0.md + 空文件 .codefree/memory/team/MEMORY.md

---

## v1.3.1 · 2026-08-26 · ⚠️ 未打 tag

> 安全加固 + 反编造铁律强化 + 代码清理审计。

### 安全
- sec: IPC 路径校验 — `file` / `shell` / `material` / `photo` / `project` / `template` 所有接收外部路径的 handler 加 `isPathSafe()` 前置校验，防越权访问
- sec: 撤销导入 `entity_table` 加白名单 — `material:commitUnifiedImport` 原 `DELETE FROM ${row.entity_table}` 直接拼表名，加 `ALLOWED_TABLES` 白名单防 SQL 注入
- sec: 写台账/上传模板加 `assertIndexedProjectPath` — 防越权写未索引项目
- sec: 防 prompt 注入 — `aiService.ts` 新增第十条反编造铁律 + `wrapUserInput()` 用 `<USER_INPUT>` 标签隔离用户输入，所有 buildDocPrompt case 接入

### 反编造强化
- fix: `postProcessFabricationGuard` 放宽 3 处正则距离限制（修绕过）+ 新增「编造具体人名」检测 + 模糊时间词补「日前/前几日/这些天」+ 法规条文引用去掉日期依赖
- refactor: `ProjectView.tsx` 抽出 `sanitizeFullPipeline()` 统一流式主/续写/非流式降级三路径，修续写中间态漏 sanitize 的 bug

### 代码清理
- chore: 删死代码 — `secret.mjs` 的 `setForcePlainMode`/`isForcePlainMode`、`settings.mjs` 的 `settings:getFull` handler、`template.mjs` 的 `template:listSupportedDocTypes` handler
- chore: 4 个无调用方函数标 `@deprecated`（`docTypePrompts` / `fieldRegistry` / `structuredGeneration` / `aiService`）
- chore: `console.log` → `console.debug` 降级（`doc` / `shell` / `sop` / `shared`）
- chore: 6 处静默 `catch {}` → `catch (e) { console.warn/error }`

### SOP 路由修正
- fix: 默认兜底「土建」→「未分类」；新增「通信」类型；`doc.mjs` 漏掉的 `information` 类型补回；7 类项目 enabledSections 名称统一

---

## v1.3.0 · 2026-08 · ⚠️ 未打 tag

> v1.1.29 之后的修复与硬化工作，package.json 已升至 1.3.0。

### 修复
- fix: harden project operations and repair regressions — 项目操作硬化 + 回归修复
- fix: restore AI writing selector import — 恢复 AI 写作选择器导入
- fix: remove duplicate project settings from AI writing — 移除 AI 写作中重复的项目设置
- fix: harden deliverable workflow and reporting data — 可交付工作流 + 报表数据硬化

---

## v1.1.29 · 2026-08

### 新增
- feat: 支持资料解析和进度台账导入 — 材料解析（`materialParser.mjs`）+ 进度台账统一导入（`unified_import_batch/row` 表）+ 撤销导入

---

## v1.1.22 · 2026-08

### 新增
- feat: 完善项目画像与可交付文书生成 — 项目画像（`project_participant/member/structure` 表）+ 交付包生成（`delivery:batchGenerate/createPackage`）+ 主数据变更追溯（`master_data_change` 表）

---

## v1.1.2 · 2026-07

### 新增
- feat: 项目级模板与数据驱动文档生成 — 项目级 `templateOverrides` + 企业模板库（`templateRegistry.mjs`）+ 三条渲染分支（xlsx / 结构化系统版式 / docxtemplater）+ 字段别名（`field-aliases.json`）

---

## v1.1.1 · 2026-07

### 修复
- fix: 预览走正式目录 + 文件名提取命令前缀 — 预览文件落正式目录，`extractSubject` 清理命令词

---

## v1.1.0 · 2026-07

### 新增
- feat: 反编造铁律 v1.1.0 — 7 层反编造防线（prompt / 流式 / 主进程 / 字数 / 占位符 / 渲染后 / 落盘前）+ `sanitizeFieldValue` / `sanitizeLetterStyle` / `postProcessFabricationGuard` + 占位符白名单（`placeholderScan.mjs`）

---

## v1.0.9 · 2026-07

### 新增
- feat: 虚竹 v2.0 文件命名规范 — `{YYYYMMDD}_{typeCode}_{projectCode}_{summary}_{version}.docx` 统一走 `filename.mjs`，`DOC_CODE_MAP` + `nextVersion` 版本号扫描

---

## v1.0.8 · 2026-06

### 修复
- fix: project.config.json 缺失导致保存 ENOENT + 预览按钮 + AI 助手上方项目选择

---

## v1.0.7 · 2026-06

### 修复
- fix: AI 助手发消息报"未配置 API"的真根因 + 诊断按钮

---

## v1.0.6 · 2026-06

### 修复
- fix: API Key 解密失败时透传错误 + Settings 页告警 — apiKey 迁至主进程安全存储，前端脱敏

---

## v1.0.5 · 2026-06

### 修复
- fix: 项目列表把根目录所有子目录当项目

---

## v1.0.4 · 2026-06

### 修复
- fix: AI 设置保存失败 + 根目录不能切换

---

## v1.0.3 · 2026-06

### 修复
- fix: 修复打包后 .app 启动白屏 + 乱码

---

## v1.0.2 · 2026-06

### 修复
- fix: P0 稳定性 + 安全 + 备份修复

---

## v1.0.1 · 2026-06

### 文档
- docs: v1.0.0 更新说明 + 自动发 GitHub Release

---

## v1.0.0 · 2026-06-22 · 首发版本

### 新增
- 🎉 首版发布
- 📄 AI 流式生成监理文档
- 🔍 Docx / Xlsx 全文检索（FlexSearch）
- 📁 往来函件台账（6 类）+ 自动归档
- ⚠️ 隐患联动闭环（巡检 → 台账 → 整改 → 关闭）
- 📊 进度控制（手写 SVG 横道图 + 偏差分析）
- 💰 投资控制（5 级审批 + 累计金额）
- 📜 合同管理（合同 / 变更 / 索赔 + 到期预警）
- 📷 照片归档（拖拽 + 按月归档 + EXIF）
- 🗄️ SQLite 持久化（better-sqlite3，WAL 模式）
- 🪟 Windows 桌面端（NSIS 安装包 + Portable 绿色版）
- 🔧 一键发布脚本 `release.sh` + GitHub Actions CI

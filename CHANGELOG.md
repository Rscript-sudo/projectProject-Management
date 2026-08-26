# 更新日志

> 所有重要变更按版本倒序记录。版本号见 `package.json`，tag 见 `git tag -l`。
> v1.2.x / v1.3.x 未打 tag，从 commit log 推断，标注 ⚠️。

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

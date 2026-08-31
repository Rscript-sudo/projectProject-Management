# 发布流程

> 老板改完代码后，只需一行命令就完成发布。

> ⚠️ **默认不发布**。修 bug / 完成新功能后只做 `npm run build` 本地构建 + `git commit`，**不 push、不打 tag、不 `./release.sh`、不建 Release**。只有老板明确说"发布 / 出包 / 推 GitHub"时才执行本文件里的流程。

---

## 🚀 一键发布

```bash
./release.sh v1.0.2
# 或带提交信息
./release.sh v1.0.2 "feat: 加了照片水印"
```

脚本会自动：

1. 校验版本号格式
2. 检查是否有未提交改动（让你确认）
3. 自动把 `package.json` / `package-lock.json` 版本同步为发布版本
4. `git add .` + `commit` + `push origin main`
5. 打 tag + `push origin v1.0.2`
6. **触发 CI 自动构建 + 自动上传 Gitee Release**

---

## ⏱️ 跑完后去哪儿看

| 用途 | 链接 |
|------|------|
| 看 CI 实时进度 | https://github.com/Rscript-sudo/projectProject-Management/actions |
| 下载发行版 | https://gitee.com/micfree/project-management/releases |

5-10 分钟内 Release 自动出现在第二个链接。发布前必须在 GitHub 源码仓库的 Actions Secrets 中配置 `GITEE_TOKEN`。

### Gitee 首次配置（只做一次）

1. 在 Gitee 个人设置创建私人令牌，仅授予发行仓库所需的权限。
2. 打开 GitHub 源码仓库的 `Settings → Secrets and variables → Actions`。
3. 新建 Repository secret，名称必须为 `GITEE_TOKEN`，值为上一步的令牌。
4. 令牌不得写入 `.env`、源码、客户端设置或 Release 说明。

Gitee 发行仓库固定为 `https://gitee.com/micfree/project-management`，只保存发行说明和安装包，不保存业务源码。

### 手动上传 macOS 发行包

macOS 包由 Mac 本机构建。确保 `package.json` 版本与标签一致后执行：

```bash
npm run package:mac
GITEE_TOKEN="仅当前终端使用的令牌" npm run publish:gitee -- v1.4.3 "release/项目文档管理系统-1.4.3-arm64.dmg" "release/项目文档管理系统-1.4.3-arm64.dmg.blockmap"
```

脚本支持重试：同名同大小附件会跳过；同名但大小不同时会拒绝覆盖，避免已发布版本被静默替换。

---

## 📋 版本号规则

格式：`v主.次.修`

| 改动 | 版本号变化 | 例子 |
|------|-----------|------|
| 修 bug / 小优化 | `v1.0.1` → `v1.0.2` | `v1.0.2` |
| 加新功能（兼容） | `v1.0.x` → `v1.1.0` | `v1.1.0` |
| 大改（破坏性） | `v1.x.x` → `v2.0.0` | `v2.0.0` |

---

## 🛠️ 其他触发方式

### 仅验证打包（不发版）

GitHub → Actions → Build Windows EXE → Run workflow

产物在 Artifacts 区下载，**不创建 Release**。

### 完全手动

```bash
git add .
git commit -m "描述改动"
git push origin main
git tag v1.0.2
git push origin v1.0.2
```

跟脚本效果一样，只是分 5 步。

---

## 📦 产物说明

下载产物（Gitee Release 或 Actions Artifacts）解压得到：

```
项目文档管理系统 Setup X.Y.Z.exe   # NSIS 安装包（推荐用户用这个）
项目文档管理系统 X.Y.Z.exe          # Portable 绿色版（双击即用）
latest.yml                         # Windows 构建元数据，随 Release 保留
```

### Windows 安装验收清单

把 EXE 拷到 Windows 机器检查：

| 检查项 | 通过标准 |
|--------|---------|
| 双击安装包 | 弹出 NSIS 安装向导 |
| 安装到默认路径 | `C:\Users\<用户>\AppData\Local\Programs\项目文档管理系统\` |
| 启动应用 | 主窗口正常打开 |
| better-sqlite3 加载 | 创建/打开项目文件夹，数据库读写无报错 |
| 卸载 | 控制面板能找到并正常卸载 |

### 常见问题

- **CI 跑 `electron-rebuild` 失败**：Windows runner 默认装好 Python + VS Build Tools 2022，通常无问题。失败看 Actions 日志。
- **安装时提示"Windows 已保护你的电脑"**：未签名 EXE 被 SmartScreen 拦截，点"更多信息 → 仍要运行"。长期方案是申请代码签名证书（EV 证书最佳）。
- **想出 macOS / Linux 包**：在 `.github/workflows/build-windows.yml` 基础上加 `macos-latest` / `ubuntu-latest` runner。
- **客户端在线更新**：设置页会查询 Gitee 最新 Release，按 Windows/macOS 和 CPU 架构选择附件，由用户确认后打开安装包下载页。

---

## ⚠️ 推错了怎么办

| 场景 | 救法 |
|------|------|
| 想撤回未推送的改动 | `git checkout . && git clean -fd` |
| commit 信息写错 | `git commit --amend -m "新信息"`（未 push 前） |
| tag 推错了 | `git tag -d v1.0.2 && git push origin :refs/tags/v1.0.2` |
| 推错了 commit | `git revert <hash>` 再 push |
| Release 出错了 | 去 https://gitee.com/micfree/project-management/releases 手动编辑或删除 |

---

## 完整流程图

```
改代码 → ./release.sh v1.0.2
              ↓
        校验+确认
              ↓
        push 代码 + tag
              ↓
        GitHub Actions 触发
              ↓
        Windows runner 跑构建（约 5-10 分钟）
              ↓
        自动创建 Gitee Release + 上传 EXE
              ↓
        客户端从 Gitee 检查更新
```

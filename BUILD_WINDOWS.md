# Windows EXE 出包指南

> 本项目通过 GitHub Actions 云端打包 Windows 安装包，**本地无需 Windows 环境**。

---

## 前置条件（一次性）

- [x] 项目已推到 GitHub
- [x] `resources/icon.ico` 已存在（多尺寸 ICO，含 256/128/64/48/32/16）
- [x] `package.json` 的 `build.win.icon` 指向 `resources/icon.ico`

---

## 出包步骤

### 方式一：打 tag 自动出包（推荐）

```bash
# 1. 确保所有改动已提交
git add -A
git commit -m "release: v1.0.0"

# 2. 打 tag（版本号必须 v 开头，例如 v1.0.0 / v0.5.2）
git tag v1.0.0

# 3. 推 tag 触发 CI
git push origin v1.0.0
```

约 5 分钟后，去 GitHub → Actions 页面下载产物。

### 方式二：手动触发

GitHub → Actions → "Build Windows EXE" → Run workflow → 选择分支 → Run。

---

## 下载产物

1. 进入 **Actions** 页面，点击对应运行记录
2. 滚到底部 **Artifacts** 区域
3. 下载 `windows-exe-v1.0.0.zip`，解压得到：

```
项目文档管理系统 Setup 1.0.0.exe        # NSIS 安装包（推荐用户用这个）
项目文档管理系统 1.0.0.exe               # Portable 绿色版（双击即用）
latest.yml                              # 自动升级用，先不管
```

---

## 验收清单

把 EXE 拷到一台 Windows 机器（或 Windows 虚拟机）检查：

| 检查项 | 通过标准 |
|--------|---------|
| 双击安装包 | 弹出 NSIS 安装向导 |
| 安装到默认路径 | `C:\Users\<用户>\AppData\Local\Programs\项目文档管理系统\` |
| 启动应用 | 主窗口正常打开 |
| better-sqlite3 加载 | 创建/打开一个项目文件夹，数据库读写无报错 |
| 卸载 | 控制面板能找到并正常卸载 |

---

## 常见问题

### Q: CI 跑 `electron-rebuild` 失败？
A: Windows runner 默认装好 Python + VS Build Tools 2022，通常无问题。如果失败，看 Actions 日志具体报错。

### Q: 安装时提示"Windows 已保护你的电脑"？
A: 未签名 EXE 会被 SmartScreen 拦截。点"更多信息" → "仍要运行"即可长期方案是申请代码签名证书（EV 证书最佳）。

### Q: 想同时出 macOS / Linux 包？
A: 在 `.github/workflows/build-windows.yml` 基础上加 `macos-latest` / `ubuntu-latest` runner。

### Q: 怎么让用户自动升级？
A: 把 `--publish never` 改成 `--publish always`，并配 `gh-release` / `generic` provider，产物会上传到 GitHub Release。客户端启动时自动检测 `latest.yml`。

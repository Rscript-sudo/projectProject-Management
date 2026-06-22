# 发布流程

> 老板改完代码后，只需一行命令就完成发布。

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
3. `git add .` + `commit` + `push origin main`
4. 打 tag + `push origin v1.0.2`
5. **触发 CI 自动构建 + 自动创建 GitHub Release**

---

## ⏱️ 跑完后去哪儿看

| 用途 | 链接 |
|------|------|
| 看 CI 实时进度 | https://github.com/Rscript-sudo/projectProject-Management/actions |
| 下载 EXE 产物 | https://github.com/Rscript-sudo/projectProject-Management/releases |

5-10 分钟内 Release 自动出现在第二个链接。

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

## ⚠️ 推错了怎么办

| 场景 | 救法 |
|------|------|
| 想撤回未推送的改动 | `git checkout . && git clean -fd` |
| commit 信息写错 | `git commit --amend -m "新信息"`（未 push 前） |
| tag 推错了 | `git tag -d v1.0.2 && git push origin :refs/tags/v1.0.2` |
| 推错了 commit | `git revert <hash>` 再 push |
| Release 出错了 | 去 https://github.com/Rscript-sudo/projectProject-Management/releases 手动 Edit / Delete |

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
        自动创建 Release + 上传 EXE
              ↓
        老板去 Releases 页面下载
```

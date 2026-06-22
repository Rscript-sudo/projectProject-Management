#!/usr/bin/env bash
# release.sh — 一键发布 Windows EXE
# 用法：./release.sh v1.0.2
#       ./release.sh v1.0.2 "feat: 加了XXX功能"

set -euo pipefail

# ========== 参数解析 ==========

VERSION="${1:-}"
COMMIT_MSG="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "❌ 用法：./release.sh <版本号> [提交信息]"
  echo "   例子：./release.sh v1.0.2"
  echo "   例子：./release.sh v1.0.2 \"fix: 修付款金额计算\""
  echo ""
  echo "   版本号格式必须为 v主.次.修，例如 v1.0.2 / v2.1.0"
  exit 1
fi

# 校验 tag 格式
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ 版本号格式错：$VERSION"
  echo "   必须是 vX.Y.Z 形式，例如 v1.0.2"
  exit 1
fi

# 默认提交信息
if [[ -z "$COMMIT_MSG" ]]; then
  COMMIT_MSG="release: $VERSION"
fi

# ========== 检查环境 ==========

echo "🔍 检查 git 状态..."

# 确保在 git 仓库里
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 当前目录不是 git 仓库"
  exit 1
fi

# 检查是否有未提交的改动
if ! git diff --quiet HEAD 2>/dev/null; then
  UNCOMMITTED=$(git status --short)
  echo "⚠️  检测到未提交的改动："
  echo "$UNCOMMITTED" | head -20
  echo ""
  read -p "❓ 是否继续？(y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 已取消"
    exit 1
  fi
fi

# 检查 tag 是否已存在
if git tag -l "$VERSION" | grep -q "^$VERSION$"; then
  echo "❌ tag $VERSION 已存在，请用别的版本号"
  exit 1
fi

# ========== 确认发布信息 ==========

echo ""
echo "📦 发布信息："
echo "   版本号：     $VERSION"
echo "   提交信息：   $COMMIT_MSG"
echo "   当前分支：   $(git branch --show-current)"
echo "   最近 commit: $(git log -1 --pretty=%h -s HEAD)"
echo ""
read -p "❓ 确认发布？(y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 已取消"
  exit 1
fi

# ========== 执行发布 ==========

echo ""
echo "📝 步骤 1/4：暂存改动..."
git add .

# 看看这次提交有没有东西
if git diff --cached --quiet; then
  echo "   无新增改动，跳过 commit"
else
  echo "📝 步骤 2/4：提交改动..."
  git commit -m "$COMMIT_MSG"
fi

echo "🚀 步骤 3/4：推送代码到 main..."
git push origin "$(git branch --show-current)"

echo "🏷️  步骤 4/4：打 tag 并推送..."
git tag "$VERSION"
git push origin "$VERSION"

# ========== 后续指引 ==========

echo ""
echo "✅ 完成！CI 已开始构建"
echo ""
echo "📍 查看进度："
echo "   https://github.com/Rscript-sudo/projectProject-Management/actions"
echo ""
echo "📍 预计 5-10 分钟后，Release 自动出现在："
echo "   https://github.com/Rscript-sudo/projectProject-Management/releases/tag/$VERSION"
echo ""
echo "💡 老板去 GitHub 页面等就行，不用守在终端"

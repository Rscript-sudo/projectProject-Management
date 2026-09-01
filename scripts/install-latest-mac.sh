#!/usr/bin/env bash
# 本机单版本安装：永远只保留 /Applications 中的最新应用，不产生 .backup-* 历史副本。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLED_APP="/Applications/项目文档管理系统.app"
BUILT_APP="$PROJECT_DIR/release/mac-arm64/项目文档管理系统.app"
TEMP_OLD="/private/tmp/项目文档管理系统-installing-old.app"

cleanup_tree() {
  local target="$1"
  if [[ -d "$target" ]]; then
    find "$target" -depth -delete
  fi
}

restore_on_error() {
  if [[ ! -d "$INSTALLED_APP" && -d "$TEMP_OLD" ]]; then
    mv "$TEMP_OLD" "$INSTALLED_APP"
  fi
}
trap restore_on_error ERR

# 先清理旧构建，保证本次从当前源码全新生成。
cleanup_tree "$PROJECT_DIR/dist"
cleanup_tree "$PROJECT_DIR/release"
cd "$PROJECT_DIR"
npm run build

[[ -d "$BUILT_APP" ]] || { echo "未找到新构建应用：$BUILT_APP"; exit 1; }

# 清除以前遗留的所有历史应用副本。
find /Applications -maxdepth 1 -type d -name '项目文档管理系统.app.backup-*' -print0 |
  while IFS= read -r -d '' old_backup; do cleanup_tree "$old_backup"; done

cleanup_tree "$TEMP_OLD"
if [[ -d "$INSTALLED_APP" ]]; then
  mv "$INSTALLED_APP" "$TEMP_OLD"
fi
ditto "$BUILT_APP" "$INSTALLED_APP"

BUILT_HASH="$(shasum -a 256 "$BUILT_APP/Contents/Resources/app.asar" | awk '{print $1}')"
INSTALLED_HASH="$(shasum -a 256 "$INSTALLED_APP/Contents/Resources/app.asar" | awk '{print $1}')"
[[ "$BUILT_HASH" == "$INSTALLED_HASH" ]] || { echo "安装校验失败"; exit 1; }

# 替换目录不会自动刷新已运行的 Electron 进程。若旧进程仍存活，用户看到的
# 会是旧 renderer，形成“安装成功但修复未生效”的假象。安装后统一重启并校验。
osascript -e 'tell application id "com.supervision.project-management" to quit' >/dev/null 2>&1 || true
for _ in {1..10}; do
  pgrep -f '/Applications/项目文档管理系统.app/Contents/MacOS/项目文档管理系统' >/dev/null || break
  sleep 1
done
if pgrep -f '/Applications/项目文档管理系统.app/Contents/MacOS/项目文档管理系统' >/dev/null; then
  pkill -TERM -f '/Applications/项目文档管理系统.app/Contents/MacOS/项目文档管理系统' || true
  sleep 2
fi
open -a "$INSTALLED_APP"
for _ in {1..10}; do
  pgrep -f '/Applications/项目文档管理系统.app/Contents/MacOS/项目文档管理系统' >/dev/null && break
  sleep 1
done
pgrep -f '/Applications/项目文档管理系统.app/Contents/MacOS/项目文档管理系统' >/dev/null || { echo "新版应用启动校验失败"; exit 1; }

# 安装成功后不留旧应用、DMG、dist 或 release 副本。
cleanup_tree "$TEMP_OLD"
cleanup_tree "$PROJECT_DIR/dist"
cleanup_tree "$PROJECT_DIR/release"
trap - ERR

echo "已安装并启动最新版，本机仅保留：$INSTALLED_APP"

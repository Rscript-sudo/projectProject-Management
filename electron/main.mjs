import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { registerAll } from './ipc/register.mjs'
import { getDb, closeDb } from './db/database.mjs'
import { runMigrations } from './db/migrations.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ===== 全局崩溃防护 =====
const crashLogPath = path.join(app.getPath('userData'), 'crash.log')
const MAX_CRASH_LOG_SIZE = 5 * 1024 * 1024  // 5MB 上限
function logCrash(scope, err) {
  const line = `[${new Date().toISOString()}] [${scope}] ${err?.stack || err}\n`
  try {
    // v1.2.1 P2 修复：日志超过 5MB 滚动到 .old
    if (fs.existsSync(crashLogPath) && fs.statSync(crashLogPath).size > MAX_CRASH_LOG_SIZE) {
      const oldPath = crashLogPath + '.old'
      try { fs.unlinkSync(oldPath) } catch (_) {}
      fs.renameSync(crashLogPath, oldPath)
    }
    fs.appendFileSync(crashLogPath, line)
  } catch (_) {
    // 兜底：日志都写不进去就不写了
  }
  console.error(line.trimEnd())
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err)
  // 给主进程 1 秒时间刷日志再退出，避免丢日志
  setTimeout(() => process.exit(1), 1000)
})

process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason)
  // 不退出主进程，只记录；让业务层决定如何响应
})

let mainWindow = null

/**
 * v1.2.1 P0 修复：DB 初始化失败时显示明确错误页
 * 不注册业务 IPC，避免用户在半残 DB 上操作崩溃
 */
function createErrorWindow(dbError) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>数据库初始化失败</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 40px; background: #fff5f5; color: #333; }
  h1 { color: #c00; }
  pre { background: #fff; padding: 12px; border-left: 3px solid #c00; white-space: pre-wrap; }
  .log-path { color: #666; font-size: 13px; margin-top: 20px; }
</style></head><body>
<h1>⚠️ 数据库初始化失败</h1>
<p>应用无法启动。请按以下步骤排查：</p>
<ol>
  <li>关闭应用</li>
  <li>查看崩溃日志：<code>${crashLogPath}</code></li>
  <li>如日志提示权限问题，删除 userData 目录后重试</li>
  <li>如仍无法解决，附日志联系开发</li>
</ol>
<h3>错误信息：</h3>
<pre>${dbError}</pre>
<div class="log-path">崩溃日志路径：${crashLogPath}</div>
</body></html>`

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: '数据库初始化失败',
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  return win
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '项目文档管理系统',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.on('preload-error', (_, preloadPath, error) => {
    console.error('[Main] Preload error:', preloadPath, error)
  })

  win.webContents.on('did-fail-load', (_, errorCode, errorDesc) => {
    console.error('[Main] Page failed to load:', errorCode, errorDesc)
  })

  win.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded successfully')
  })

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // 1. 初始化数据库 + 迁移老 JSON（仅首次）
  let dbOk = false
  let dbError = ''
  try {
    getDb()
    const migResult = runMigrations()
    console.log('[Main] Migrations:', migResult)
    dbOk = true
  } catch (e) {
    dbError = e.message
    console.error('[Main] DB init failed:', e.message)
    logCrash('dbInit', e)  // 落 crash.log 方便老板排查
  }

  // 2. 注册 IPC（即便 DB 失败也注册，加固 health check）
  //    v1.2.1 P0 修复：DB 失败时不注册业务 IPC，仅注册 healthCheck；窗口加载错误页
  if (!dbOk) {
    mainWindow = createErrorWindow(dbError)
    return
  }

  // 3. 正常路径：注册所有 IPC + 创建主窗口
  mainWindow = createWindow()
  registerAll(ipcMain, mainWindow)

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', (event) => {
  // 防止 before-quit 同步路径上 db 已关闭导致二次调用崩溃
  if (!closeDb()) {
    // 如果 closeDb 返回 false（已经在关闭中），直接放行
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

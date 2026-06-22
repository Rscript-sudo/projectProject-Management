import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerAll } from './ipc/register.mjs'
import { getDb, closeDb } from './db/database.mjs'
import { runMigrations } from './db/migrations.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null

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
  try {
    getDb()
    const migResult = runMigrations()
    console.log('[Main] Migrations:', migResult)
  } catch (e) {
    console.error('[Main] DB init failed:', e.message)
  }

  // 2. 注册 IPC
  mainWindow = createWindow()
  registerAll(ipcMain, mainWindow)

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
    }
  })
})

app.on('before-quit', () => {
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

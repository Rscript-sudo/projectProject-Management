import { create } from 'zustand'
import type { ElectronAPI } from '../vite-env'
import { waitForElectronAPI } from '../hooks/useElectronAPI'

const DEFAULT_PROJECT_ROOT = ''

interface ProjectInfo {
  name: string
  path: string
}

interface Settings {
  projectRoot: string
  aiProvider: 'deepseek' | 'minimax' | 'glm' | 'kimi' | 'qwen' | 'custom'
  apiKey?: string        // 不再存明文，主进程加密持有
  hasApiKey?: boolean    // 前端用此判断是否已配置
  apiKeyDecryptError?: string | null  // 主进程解密失败时的提示文案
  baseUrl: string
  model: string
  autoOpenFile: boolean
}

interface AppState {
  // 项目列表
  projects: ProjectInfo[]
  currentProject: ProjectInfo | null
  projectRoot: string

  // 设置
  settings: Settings

  // 操作
  setProjectRoot: (root: string) => void
  loadProjects: () => Promise<void>
  setCurrentProject: (project: ProjectInfo | null) => void
  createProject: (name: string, projectType?: string) => Promise<{ success: boolean; error?: string }>
  deleteProject: (path: string) => Promise<void>
  renameProject: (oldPath: string, newName: string) => Promise<{ success: boolean; error?: string }>
  loadSettings: () => Promise<void>
  saveSettings: (settings: Partial<Settings>) => Promise<{ success: boolean; error?: string }>
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  currentProject: null,
  projectRoot: DEFAULT_PROJECT_ROOT,
  settings: {
    projectRoot: DEFAULT_PROJECT_ROOT,
    aiProvider: 'deepseek',
    apiKey: '',
    baseUrl: '',
    model: 'deepseek-chat',
    autoOpenFile: true,
  },

  setProjectRoot: (root) => {
    set({ projectRoot: root })
    get().loadProjects()
  },

  loadProjects: async () => {
    const { projectRoot } = get()
    if (!projectRoot) return
    try {
      const api = await waitForElectronAPI()
      const projects = await api.getProjects(projectRoot)
      set({ projects })
    } catch (e) {
      console.error('Failed to load projects:', e)
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  createProject: async (name, projectType = '通用') => {
    const { projectRoot } = get()
    console.log('[Store] createProject:', projectRoot, name, projectType)
    try {
      const api = await waitForElectronAPI(10000)
      const result = await api.createProject(projectRoot, name, projectType)
      console.log('[Store] createProject result:', result)
      if (result.success) {
        await get().loadProjects()
      }
      return result
    } catch (e: any) {
      console.error('[Store] createProject error:', e)
      return { success: false, error: e.message || 'API error' }
    }
  },

  deleteProject: async (path) => {
    try {
      const api = await waitForElectronAPI()
      const result = await api.deleteProject(path)
      if (!result || !result.success) {
        console.error('deleteProject failed:', result?.error)
        return
      }
      const { currentProject } = get()
      if (currentProject?.path === path) {
        set({ currentProject: null })
      }
      await get().loadProjects()
    } catch (e) {
      console.error('deleteProject error:', e)
    }
  },

  renameProject: async (oldPath, newName) => {
    try {
      const api = await waitForElectronAPI()
      const result = await api.renameProject(oldPath, newName)
      if (result.success && result.path) {
        const { currentProject } = get()
        if (currentProject?.path === oldPath) {
          set({ currentProject: { name: newName, path: result.path } })
        }
        await get().loadProjects()
      }
      return result
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  loadSettings: async () => {
    let retries = 0
    const maxRetries = 50

    const tryLoad = async () => {
      try {
        const api = await waitForElectronAPI()
        const saved = await api.getSettings()
        // 合并默认值，确保新增字段不为 undefined
        const defaults = {
          projectRoot: DEFAULT_PROJECT_ROOT,
          aiProvider: 'deepseek' as const,
          apiKey: '',
          baseUrl: '',
          model: 'deepseek-chat',
          autoOpenFile: true,
        }
        const settings = { ...defaults, ...saved }
        const newRoot = settings.projectRoot || ''
        // 检查根目录是否真的变了 → 决定要不要刷项目列表
        const oldRoot = get().projectRoot
        set({
          settings,
          projectRoot: newRoot,
        })
        // 根目录变了或首次加载 → 重新拉项目列表
        if (newRoot && newRoot !== oldRoot) {
          await get().loadProjects()
        }
        return true
      } catch (e) {
        console.error('Failed to load settings:', e)
        if (retries < maxRetries) {
          retries++
          await new Promise(r => setTimeout(r, 200))
          return tryLoad()
        }
        return false
      }
    }

    await tryLoad()
  },

  saveSettings: async (settings) => {
    try {
      const api = await waitForElectronAPI()
      const result = await api.setSettings(settings)
      if (!result || result.success === false) {
        console.error('[saveSettings] 后端失败:', result?.error)
        return { success: false, error: result?.error || '保存失败' }
      }
      // 同步顶层 projectRoot：settings 变 → store 顶层跟着变 → Home 页立刻刷新
      const newRoot = settings.projectRoot || get().projectRoot
      set({
        settings: { ...get().settings, ...settings },
        projectRoot: newRoot,
      })
      // 根目录变了 → 立刻刷项目列表（不依赖再 loadSettings 触发）
      if (newRoot !== get().projectRoot || settings.projectRoot) {
        await get().loadProjects()
      }
      return { success: true }
    } catch (e: any) {
      console.error('Failed to save settings:', e)
      return { success: false, error: e?.message || '未知错误' }
    }
  },
}))
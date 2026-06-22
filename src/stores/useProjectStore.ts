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
  apiKey: string
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
  saveSettings: (settings: Settings) => Promise<void>
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
        set({
          settings,
          projectRoot: settings.projectRoot || ''
        })
        if (settings.projectRoot) {
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
      await api.setSettings(settings)
      set({ settings })
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  },
}))
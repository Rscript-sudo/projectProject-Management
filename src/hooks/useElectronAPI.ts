import { useState, useEffect, useRef } from 'react'
import type { ElectronAPI } from '../vite-env'

// 共享的等待函数，可被其他模块复用
// 注意：不能用 MutationObserver 监听 window 对象 —— MutationObserver 只接受
// DOM Node/Document/Text,observe(window) 在打包后会立刻抛 TypeError。
// 改用 50ms 轮询，简单可靠。
export const waitForElectronAPI = async (timeout = 15000): Promise<ElectronAPI> => {
  if (window.electronAPI) return window.electronAPI

  return new Promise((resolve, reject) => {
    let resolved = false
    const start = Date.now()

    const tick = () => {
      if (resolved) return
      if (window.electronAPI) {
        resolved = true
        resolve(window.electronAPI)
        return
      }
      if (Date.now() - start >= timeout) {
        resolved = true
        reject(new Error('electronAPI timeout'))
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

// React hook 版本
export function useElectronAPI() {
  const [ready, setReady] = useState(!!window.electronAPI)
  const resolvedRef = useRef(false)

  useEffect(() => {
    if (resolvedRef.current) return

    if (window.electronAPI) {
      resolvedRef.current = true
      return
    }

    let timeoutId: ReturnType<typeof setTimeout>
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      if (window.electronAPI) {
        resolvedRef.current = true
        setReady(true)
        return
      }
      timeoutId = setTimeout(tick, 50)
    }
    tick()

    // 最长 10s 超时（超过就视为失败，但不再抛错——保持当前 ready=false,UI 显示等待态）
    const hardTimeout = setTimeout(() => {
      if (!cancelled && !resolvedRef.current) {
        // eslint-disable-next-line no-console
        console.warn('[useElectronAPI] electronAPI 未在 10s 内注入，请检查 preload 是否加载')
      }
    }, 10000)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      clearTimeout(hardTimeout)
    }
  }, [])

  return ready
}

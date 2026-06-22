import { useState, useEffect, useRef } from 'react'
import type { ElectronAPI } from '../vite-env'

// 共享的等待函数，可被其他模块复用
export const waitForElectronAPI = async (timeout = 15000): Promise<ElectronAPI> => {
  if (window.electronAPI) return window.electronAPI

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>
    let resolved = false

    const observer = new MutationObserver(() => {
      if (resolved) return
      if (window.electronAPI) {
        resolved = true
        clearTimeout(timeoutId)
        observer.disconnect()
        resolve(window.electronAPI)
      }
    })

    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      observer.disconnect()
      if (window.electronAPI) {
        resolve(window.electronAPI)
      } else {
        reject(new Error('electronAPI timeout'))
      }
    }, timeout)

    observer.observe(window as any, { attributes: true, attributeFilter: ['electronAPI'] })
  })
}

// React hook 版本
export function useElectronAPI() {
  const [ready, setReady] = useState(false)
  const resolvedRef = useRef(false)

  useEffect(() => {
    if (resolvedRef.current) return

    if (window.electronAPI) {
      resolvedRef.current = true
      setReady(true)
      return
    }

    let timeoutId: ReturnType<typeof setTimeout>
    let resolved = false

    const observer = new MutationObserver(() => {
      if (resolved) return
      if (window.electronAPI) {
        resolved = true
        clearTimeout(timeoutId)
        observer.disconnect()
        resolvedRef.current = true
        setReady(true)
      }
    })

    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      observer.disconnect()
      if (window.electronAPI) {
        resolvedRef.current = true
        setReady(true)
      }
    }, 10000)

    observer.observe(window as any, { attributes: true, attributeFilter: ['electronAPI'] })

    return () => {
      resolved = true
      clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [])

  return ready
}

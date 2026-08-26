import fs from 'node:fs'

let runtimePromise

// SheetJS 0.20+ 的 ESM 构建不再隐式绑定 Node 文件系统。
export function loadXlsx() {
  if (!runtimePromise) {
    runtimePromise = import('xlsx').then(module => {
      const XLSX = module.default || module
      if (typeof XLSX.set_fs === 'function') XLSX.set_fs(fs)
      return XLSX
    })
  }
  return runtimePromise
}

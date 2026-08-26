import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'remove-crossorigin',
      enforce: 'post' as const,
      transformIndexHtml: {
        order: 'post' as const,
        handler(html: string) {
          return html.replace(/\s*crossorigin(=["\']?[^"\'>\s]*["\']?)?/g, '')
        },
      },
    },
  ],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // v1.x：禁用 manualChunks — vite 25.x + antd 5.x + react 19 手动分块会出现
    //   1. 循环依赖警告（antd-data-entry -> antd -> antd-data-entry）
    //   2. createContext 找不到（react chunk 与 react-router hash 冲突）
    //   3. TDZ 报错 Cannot access 'pt' before initialization（手动分块打破模块初始化顺序）
    // 让 Rollup 默认分块：每个 chunk 是一个干净的入口，无循环依赖问题
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})

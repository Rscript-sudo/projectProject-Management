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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/@ant-design/icons/')) return 'icons'
          if (/\/antd\/es\/(date-picker|time-picker|calendar|table|form|select|tree|transfer|cascader|mentions)\//.test(id)) return 'antd-data-entry'
          if (id.includes('/antd/')) return 'antd'
          if (id.includes('/@ant-design/')) return 'antd-runtime'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'react'
          if (id.includes('/docx/') || id.includes('/mammoth/') || id.includes('/pizzip/') || id.includes('/docxtemplater/')) return 'documents'
          return 'vendor'
        },
      },
    },
  },
})

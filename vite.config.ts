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
        manualChunks: {
          icons: ['@ant-design/icons'],
        },
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // thsapi 是本机独立的 Python 适配器，其 .venv 含上万个文件，
    // 若纳入监听会触发文件事件风暴并拖垮 dev server，故整体排除。
    watch: {
      ignored: ['**/thsapi/**', '**/.venv/**', '**/data/**', '**/logs/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  // @cline: DO NOT CHANGE BASE PATH
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // P1-7：拆分第三方依赖，使业务代码迭代不失效 vendor 缓存，
    // 并让首屏主 chunk 与图表/图标库解耦（recharts 单 chunk 达 414KB）。
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})




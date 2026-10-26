import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  envDir: '..', // 루트 .env 를 같이 사용
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest', // 직접 작성한 src/sw.ts 사용 (푸시 처리)
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: '막차 자기장',
        short_name: '막차자기장',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        theme_color: '#0052A4',
        background_color: '#F4F6F9',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: { port: 5173 },
})

import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  envDir: '..', // 루트 .env 를 같이 사용
  server: {
    port: 5173,
    open: true, // npm run dev 시 기본 웹브라우저를 자동으로 연다
  },
  build: {
    // 페이지마다 HTML 이 따로 있으므로 모두 진입점으로 등록
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'html/login.html'),
        signup: resolve(__dirname, 'html/signup.html'),
        onboarding: resolve(__dirname, 'html/onboarding.html'),
        profile: resolve(__dirname, 'html/profile.html'),
        join: resolve(__dirname, 'html/join.html'),
        room: resolve(__dirname, 'html/room.html'),
      },
    },
  },
})

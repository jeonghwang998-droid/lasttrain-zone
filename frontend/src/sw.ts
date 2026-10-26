/// <reference lib="webworker" />
// 서비스 워커: 오프라인 캐시 + 웹 푸시 수신
// (tsconfig 에서 제외됨. vite-plugin-pwa 가 따로 번들링)
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  // 백엔드(worker.py)가 보내는 JSON: { title, body, url, tag }
  const data = event.data?.json() ?? { title: '막차 자기장', body: '' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,          // 같은 tag 알림은 덮어씀 (30분 전 → 10분 전)
      data: { url: data.url ?? '/' },
      // TODO: 진동 패턴, 아이콘, 액션 버튼("출발했어요")
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) ?? '/'
  event.waitUntil(self.clients.openWindow(url))
})

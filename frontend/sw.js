// 서비스 워커: 앱 껍데기를 캐시해 오프라인에서도 열리게 하고, 웹 푸시를 받는다.
// 개발 중에 옛날 파일이 보이지 않도록 네트워크를 먼저 시도하고, 실패하면 캐시를 쓴다.

const CACHE = 'lasttrain-zone-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      })
      .catch(() => caches.match(req)),
  )
})

// 웹 푸시 (서버가 { title, body } 를 보낸다)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || '막차 자기장', {
      body: data.body || '',
      icon: 'public/icons/icon-192.png',
      vibrate: [200, 100, 200],
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(self.registration.scope))
})

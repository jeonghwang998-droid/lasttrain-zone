// 웹 푸시 구독 등록
// 흐름: 알림 권한 요청 → 서비스 워커에서 구독 생성 → 백엔드 /api/push/subscribe 로 전송

export async function subscribePush(): Promise<void> {
  // TODO
  // 1. Notification.requestPermission()
  // 2. const reg = await navigator.serviceWorker.ready
  // 3. reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID 공개키) })
  // 4. api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) })
  // ※ iOS 는 홈 화면에 추가한 상태에서만 푸시 가능
  throw new Error('not implemented')
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

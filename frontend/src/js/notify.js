// 알람 울리기: 소리, 진동, 시스템 알림 (내 정보의 알림 설정을 따른다)
//
// 할 수 있는 것과 없는 것 (브라우저 규칙)
// - 소리: 페이지에서 한 번이라도 누르거나 입력한 뒤에만 낼 수 있다 (자동 재생 막힘). 그래서 첫 터치 때 소리 장치를 깨워 둔다
// - 진동: 안드로이드 크롬만 된다. 아이폰 사파리와 노트북은 진동 기능이 없다
// - 시스템 알림: 알림 권한이 있어야 한다. 안드로이드는 서비스 워커로만 띄울 수 있고, 아이폰은 홈 화면에 추가한 앱에서만 된다
// - 이 앱이 열려 있을 때(다른 탭이나 화면 꺼짐 포함 일부)만 울린다. 앱을 완전히 닫으면 울리지 않는다 (서버 푸시가 아직 없음)

import { getPrefs } from './account.js'
import { url } from './app.js'

const VIBRATE_PATTERN = [400, 150, 400, 150, 400]
const BEEP_HZ = 880
const BEEP_SEC = 0.18 // 삑 한 번 길이
const BEEP_GAP_SEC = 0.12
const BEEP_COUNT = 3 // 한 묶음에 삑 수
const BEEP_ROUNDS = 2 // 묶음 반복

let audio = null

// 첫 터치/키 입력 때 소리 장치를 깨운다 (브라우저 자동 재생 규칙 때문)
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!audio) audio = new AC()
    if (audio.state === 'suspended') audio.resume()
  } catch (e) {
    /* 소리를 못 쓰는 환경 */
  }
}
;['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true }))

export const canVibrate = () => typeof navigator.vibrate === 'function'
export const canNotify = () => 'Notification' in window

// 알람 소리 (삑삑삑 두 번). 소리를 낼 수 없으면 false
async function beep() {
  unlockAudio()
  if (!audio) return false
  if (audio.state !== 'running') await audio.resume().catch(() => {})
  if (audio.state !== 'running') return false
  const t0 = audio.currentTime + 0.05
  for (let r = 0; r < BEEP_ROUNDS; r++) {
    for (let k = 0; k < BEEP_COUNT; k++) {
      const start = t0 + r * (BEEP_COUNT * (BEEP_SEC + BEEP_GAP_SEC) + 0.4) + k * (BEEP_SEC + BEEP_GAP_SEC)
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'square'
      osc.frequency.value = BEEP_HZ
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + BEEP_SEC)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + BEEP_SEC + 0.02)
    }
  }
  return true
}

// 시스템 알림. 서비스 워커가 있으면 그걸로(안드로이드는 이 방법만 된다), 없으면 페이지에서 바로
async function systemNotice(body, tag) {
  if (!canNotify() || Notification.permission !== 'granted') return false
  const opts = {
    body,
    tag,
    renotify: true,
    requireInteraction: true, // 사용자가 닫을 때까지 남겨 둔다
    icon: url('public/icons/icon-192.png'),
    badge: url('public/icons/icon-192.png'),
    vibrate: getPrefs().vibrate ? VIBRATE_PATTERN : undefined,
    silent: false,
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        await reg.showNotification('막차 자기장', opts)
        return true
      }
    }
    new Notification('막차 자기장', opts)
    return true
  } catch (e) {
    console.error('[notify]', e)
    return false
  }
}

// 알람을 울린다. 실제로 된 것들을 { sound, vibrate, notice } 로 돌려준다 (알림 시험 화면에서 쓴다)
export async function ring(body, tag = 'lz-alarm') {
  const prefs = getPrefs()
  const done = { sound: false, vibrate: false, notice: false }
  if (prefs.sound) done.sound = await beep()
  if (prefs.vibrate && canVibrate()) {
    try {
      done.vibrate = navigator.vibrate(VIBRATE_PATTERN)
    } catch (e) {
      /* 진동 미지원 */
    }
  }
  done.notice = await systemNotice(body, tag)
  return done
}

// 알림 권한 요청. 결과: 'granted' | 'denied' | 'default' | 'unsupported'
export async function askPermission() {
  if (!canNotify()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch (e) {
    return Notification.permission
  }
}

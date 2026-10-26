// 시간 표시와 시연용 시계

import { clock } from './state.js'

// 초 → "HH:MM" (24시간 넘어가면 다음날로 접는다)
export function hhmm(sec) {
  let m = Math.floor(sec / 60)
  m = ((m % 1440) + 1440) % 1440
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}

// 분 → "HH:MM"
export function fm(min) {
  return hhmm(min * 60)
}

// 남은 초 → "n시간 m분" / "MM분 SS초"
export function left(r) {
  if (r < 0) return '지남'
  r = Math.floor(r)
  const h = Math.floor(r / 3600)
  const m = Math.floor((r % 3600) / 60)
  const s = r % 60
  return h > 0 ? `${h}시간 ${m}분` : `${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`
}

// 지금 시각(초). 새벽 5시 전은 다음날로 본다
export function nowSec() {
  if (clock.real) {
    const d = new Date()
    const s = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
    return s < 18000 ? s + 86400 : s
  }
  return clock.base + ((performance.now() - clock.t0) / 1000) * clock.speed
}

// 지금 시각을 새 기준점으로 삼는다 (배속을 바꾸기 전에 호출)
export function rebase() {
  clock.base = nowSec()
  clock.t0 = performance.now()
}

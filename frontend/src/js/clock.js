// 시간 표시. 지금 시각은 기기의 실제 시계를 쓴다

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

// 서비스 날의 시작(자정)을 ms 로. 새벽 5시 전은 아직 전날 밤으로 본다
export function serviceDayStart(now = new Date()) {
  const d = new Date(now)
  if (d.getHours() < 5) d.setDate(d.getDate() - 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 지금 시각(초). 새벽 5시 전은 다음날로 본다 (00:30 → 86400+1800)
export function nowSec(now = new Date()) {
  return (now.getTime() - serviceDayStart(now)) / 1000
}

// 서비스 날 기준 초 → 실제 시각(Date)
export function secToDate(sec, now = new Date()) {
  return new Date(serviceDayStart(now) + sec * 1000)
}

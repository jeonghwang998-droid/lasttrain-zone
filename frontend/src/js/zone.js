// 막차 자기장: 지금 걸어서 갈 수 있고, 거기서 타면 집에 갈 수 있는 구역
//
// 서버(/api/zone)가 역마다 '늦어도 몇 시에 타면 집에 가는지'(마감 시각)를 준다.
// 내 주변 역마다 (마감 - 지금 - 일찍 일어나기) 동안 걸을 수 있는 거리를 반경으로 원을 그리면,
// 원들이 합쳐진 곳이 귀가 가능 구역이다. 시간이 지나면 반경이 줄어서 자기장이 좁아진다 (README 6-2)

import { api } from './api.js'
import * as Kakao from './kakao.js'
import * as Subway from './subway.js'
import { distanceM, WALK_DETOUR } from './geo.js'

const AROUND_RADIUS_M = 4000 // 내 위치에서 이 거리 안의 역으로 자기장을 그린다
// 여유가 이 분 이하로 남으면 색을 바꾼다 (출발 알림 30분, 10분 전과 같은 기준)
const WARN_SPARE_MIN = 30
const DANGER_SPARE_MIN = 10

// 도착 후보 역들까지 가는 막차 마감 시각: { day, now, stations: { 역 id: 마감(분) }, note }
export const loadDeadlines = (targets) => api('/api/zone', { method: 'POST', body: JSON.stringify({ to: targets }) })

// 내 주변 역에 마감 시각을 붙인다. 같은 역(같은 자리)의 여러 노선은 가장 늦은 마감 하나로
// 반환: [{ key, name, lat, lng, deadline }]
export async function zoneStations(center, deadlines) {
  const lines = await Subway.loadLines()
  const around = await Kakao.stationsAround(center.lat, center.lng, AROUND_RADIUS_M)
  const byPlace = new Map()
  for (const s of around) {
    const m = Subway.matchStation(lines, s)
    const deadline = m ? deadlines[m.id] : undefined
    if (deadline == null) continue
    const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`
    const cur = byPlace.get(key)
    if (!cur || cur.deadline < deadline) byPlace.set(key, { key, name: m.label, lat: s.lat, lng: s.lng, deadline })
  }
  return [...byPlace.values()]
}

// 지금(분) 기준 원: 여유(분)와 반경(m), 색 단계. 여유가 없는 역은 빠진다
// walkSpeed: 걷는 속도(m/분), bufferMin: 일찍 일어나기(분)
export function zoneCircles(stations, nowMin, walkSpeed, bufferMin) {
  return stations
    .map((s) => {
      const spare = s.deadline - nowMin - bufferMin
      const level = spare <= DANGER_SPARE_MIN ? 'danger' : spare <= WARN_SPARE_MIN ? 'warn' : 'calm'
      return { ...s, spare, radius: (Math.max(0, spare) * walkSpeed) / WALK_DETOUR, level }
    })
    .filter((c) => c.radius > 0)
}

// 지금 위치에서 걸어가서 마감 전에 탈 수 있는 역 중 가장 여유 있는 역. 없으면 null (자기장 밖)
// 반환: { circle, walkMin, slack }
export function bestEscape(pos, circles, walkSpeed) {
  let best = null
  for (const c of circles) {
    const walkMin = Math.ceil((distanceM(pos, c) * WALK_DETOUR) / walkSpeed)
    const slack = Math.floor(c.spare - walkMin)
    if (slack >= 0 && (!best || slack > best.slack)) best = { circle: c, walkMin, slack }
  }
  return best
}

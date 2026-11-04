// 경로와 막차 시각을 가져오는 곳.
//
// 서버(/api/routes)가 한국철도공사(KRIC) 역 시간표로 지하철 경로를 찾아 준다.
// 도착지는 집 근처 지하철역 여러 개를 후보로 보낸다 (예: 집이 고잔역과 중앙역 사이면 둘 다).
// 역 좌표와 근처 역은 카카오, 역 id 는 공공데이터(TAGO) 노선 목록으로 맞춘다.

import { api } from './api.js'
import { S } from './state.js'
import * as Kakao from './kakao.js'
import * as Subway from './subway.js'
import { distanceM, WALK_DETOUR } from './geo.js'

export const TRANSIT_CONNECTED = true

const DEST_STATION_RADIUS_M = 1500 // 도착지에서 이 거리 안의 역을 도착 후보로 본다
const DEST_STATION_LIMIT = 8

let note = '' // 경로가 없을 때 그 이유 (화면 안내용)
export const routesNote = () => note

const walkMinutes = (meters) => Math.max(0, Math.round((meters * WALK_DETOUR) / (S.walkSpeed || S.walkDefault || 1)))

// 도착 후보 역: [{ id: 공공데이터 역 id, walk: 그 역에서 도착지까지 걷는 분 }]
// walk 는 서버가 어느 역에서 내릴지 고르는 데만 쓴다 (화면에는 보이지 않는다)
export async function destinationStations(to) {
  const out = new Map()
  if (to.stationId) out.set(to.stationId, 0)
  if (to.lat != null && to.lng != null) {
    const lines = await Subway.loadLines()
    const near = await Kakao.nearbyStations(to.lat, to.lng, DEST_STATION_RADIUS_M, DEST_STATION_LIMIT)
    for (const n of near) {
      const m = Subway.matchStation(lines, n)
      if (!m) continue
      const walk = walkMinutes(n.distance ?? distanceM(to, n))
      if (!out.has(m.id) || out.get(m.id) > walk) out.set(m.id, walk)
    }
  }
  return [...out].map(([id, walk]) => ({ id, walk }))
}

// trip: { from: { name, stationId?, lat?, lng? }, to: { name, stationId?, lat?, lng?, isHome? } }
// myPos: 지금 위치 { lat, lng } (있으면 출발역까지 걷는 거리를 계산한다)
//
// 반환: 탈 수 있는 경로 목록. 화면(routeview.js)과 역산(planner.js)이 이 모양을 그대로 읽는다.
//   [{
//     name,          // 경로 이름 (예: "수도권 1호선 + 서해선")
//     board,         // 첫 탑승역 이름
//     walkM,         // 지금 위치에서 첫 탑승역까지 걷는 거리(m)
//     legs: [{       // 환승할 때마다 구간이 하나씩 늘어난다
//       name,        // 노선 이름
//       from, to,    // 탑승역, 하차역 이름
//       deps, arrs,  // 이 구간을 실제로 다니는 열차의 탑승역 출발 / 하차역 도착 시각(분, 출발 순)
//       ride,        // 보통 걸리는 시간(분)
//       xfer,        // 내린 뒤 다음 구간 타는 곳까지 걷는 시간(분). 마지막 구간은 0
//       line,        // 지연 예측 모델 키 (예: "1호선")
//     }]
//   }]
export async function fetchRoutes(trip, myPos) {
  note = ''
  if (!trip.from.stationId) {
    note = '출발지를 지하철역으로 골라야 경로를 계산할 수 있어요.'
    return []
  }
  const targets = await destinationStations(trip.to)
  if (!targets.length) {
    note = '도착지 근처에서 시간표를 확인할 수 있는 지하철역을 찾지 못했어요.'
    return []
  }
  const res = await api('/api/routes', { method: 'POST', body: JSON.stringify({ from: trip.from.stationId, to: targets }) })
  note = res.note || ''
  return applyWalk(res.routes, myPos, trip.from)
}

// 지금 위치에서 첫 탑승역까지 걷는 거리(m)를 경로마다 넣는다. 위치가 바뀌면 다시 불러 일어날 시각을 고친다
export function applyWalk(routes, myPos, from) {
  const walkM = myPos && from.lat != null ? Math.round(distanceM(myPos, from) * WALK_DETOUR) : 0
  routes.forEach((r) => {
    r.walkM = walkM
  })
  return routes
}

// 지하철 노선/역 목록과 역별 막차 (Flask 백엔드 → 공공데이터포털 TAGO 지하철정보)

import { api } from './api.js'

let linesPromise = null

// 노선 목록: [{ name, region, stations: [{ id, name }] }]. 한 번 받으면 이 페이지에서는 다시 받지 않는다
export function loadLines() {
  if (!linesPromise) {
    linesPromise = api('/api/subway/lines')
      .then((d) => d.lines)
      .catch((e) => {
        linesPromise = null // 실패하면 다시 시도할 수 있게
        throw e
      })
  }
  return linesPromise
}

// 역의 행(종착역)별 막차: { station_id, day: '평일', trains: [{ end, last: 'HH:MM', minutes, count, direction }] }
export const loadLastTrains = (stationId) => api(`/api/subway/stations/${encodeURIComponent(stationId)}/last-trains`)

// 화면에 쓰는 역 이름. 예: "고잔역 (수인분당)". 이미 '역'으로 끝나는 이름(서울역)에는 또 붙이지 않는다
export const stationLabel = (station, line) =>
  `${station.name.endsWith('역') ? station.name : station.name + '역'} (${line.name})`

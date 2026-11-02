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

/* ---------- 카카오 역 ↔ 공공데이터 역 맞추기 ---------- */
// 카카오는 "부평역 1호선"(분류: 수도권1호선), 공공데이터는 역 '부평' + 노선 '수도권 1호선' 으로 부른다.
// 같은 역인지 이름을 정리해서 맞춘다. 맞는 역이 없으면 null (시간표를 확인할 수 없는 역)

// 비교용 이름: 공백, 괄호 설명, 끝의 '역', '철도', '경전철', '선'(N호선의 선은 남김)을 뗀다
const normStation = (s) => s.replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/역$/, '')
const normLine = (s) =>
  s
    .replace(/\s+/g, '')
    .replace(/(철도|경전철)$/, '')
    .replace(/(?<!호)선$/, '')

// 공공데이터 노선 하나가 카카오 노선 이름과 같은지. 수도권 5호선처럼 지역이 안 붙은 노선도 맞춘다
function sameLine(line, kakaoLabel) {
  const want = normLine(kakaoLabel)
  const base = line.name.startsWith(line.region + ' ') ? line.name.slice(line.region.length + 1) : line.name
  return [line.name, base, line.region + base].some((n) => normLine(n) === want)
}

// place: { stationName: '부평역', lineLabel: '수도권1호선' }. 반환: { id, name, line, label } 또는 null
export function matchStation(lines, place) {
  const name = normStation(place.stationName)
  for (const line of lines) {
    if (!sameLine(line, place.lineLabel)) continue
    const st = line.stations.find((s) => normStation(s.name) === name)
    if (st) return { id: st.id, name: st.name, line: line.name, label: stationLabel(st, line) }
  }
  return null
}

// 카카오 장소 검색 결과가 지하철역이면 { stationName, lineLabel } 로 나눠 준다 (이름 "부평역 1호선", 분류 "...> 수도권1호선")
export function kakaoStation(place) {
  if (!/지하철/.test(place.category || '')) return null
  const m = place.name.match(/^(.+?)\s+(\S.*)$/)
  return { stationName: m ? m[1] : place.name, lineLabel: place.category.split('>').pop().trim() }
}

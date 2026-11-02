// 카카오 지도 SDK: 장소/주소 검색, 근처 지하철역, 좌표→주소, 지도 그리기
// 키(KAKAO_JS_KEY)는 config.js 에 있고, 등록한 도메인에서만 동작한다. 키가 없거나 SDK 를 못 받으면 빈 결과를 돌려준다

import { KAKAO_JS_KEY } from './config.js'

export const KAKAO_CONNECTED = Boolean(KAKAO_JS_KEY)

let loading = null

export function loadKakao() {
  if (!KAKAO_CONNECTED) return Promise.resolve(null)
  if (loading) return loading
  loading = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
    s.onerror = () => {
      console.error('[kakao] SDK 를 불러오지 못했어요 (키나 등록한 도메인을 확인하세요)')
      resolve(null)
    }
    document.head.append(s)
  })
  return loading
}

const toPlace = (d) => ({
  name: d.place_name,
  address: d.road_address_name || d.address_name,
  lat: Number(d.y),
  lng: Number(d.x),
  category: d.category_name || '',
  distance: d.distance ? Number(d.distance) : null, // m (근처 검색일 때만)
})

// 키워드로 장소 찾기. stationsOnly 면 지하철역만. 반환: [{ name, address, lat, lng, category, distance }]
export async function searchPlaces(query, size = 6, stationsOnly = false) {
  const kakao = await loadKakao()
  if (!kakao || !query.trim()) return []
  return new Promise((resolve) => {
    new kakao.maps.services.Places().keywordSearch(
      query,
      (data, status) => resolve(status === kakao.maps.services.Status.OK ? data.map(toPlace) : []),
      { size, ...(stationsOnly ? { category_group_code: 'SW8' } : {}) },
    )
  })
}

// 주소로 좌표 찾기 (예: "인천 부평구 부평대로 283"). 반환: [{ name, address, lat, lng }]
export async function searchAddress(query) {
  const kakao = await loadKakao()
  if (!kakao || !query.trim()) return []
  return new Promise((resolve) => {
    new kakao.maps.services.Geocoder().addressSearch(query, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) return resolve([])
      resolve(
        data.map((d) => ({
          name: d.address_name,
          address: (d.road_address && d.road_address.address_name) || d.address_name,
          lat: Number(d.y),
          lng: Number(d.x),
        })),
      )
    })
  })
}

// 좌표 → 주소 글자. 못 찾으면 ''
export async function reverseGeocode(lat, lng) {
  const kakao = await loadKakao()
  if (!kakao) return ''
  return new Promise((resolve) => {
    new kakao.maps.services.Geocoder().coord2Address(lng, lat, (data, status) => {
      if (status !== kakao.maps.services.Status.OK || !data[0]) return resolve('')
      const a = data[0]
      resolve((a.road_address && a.road_address.address_name) || (a.address && a.address.address_name) || '')
    })
  })
}

// 가까운 지하철역 (거리순). 카카오 이름은 "부평역 1호선" 모양이라 역 이름과 노선을 나눠 담는다
// 반환: [{ stationName: '부평역', lineLabel: '수도권1호선', lat, lng, distance, address }]
export async function nearbyStations(lat, lng, radius = 1500, size = 8) {
  const kakao = await loadKakao()
  if (!kakao) return []
  const sv = kakao.maps.services
  return new Promise((resolve) => {
    new sv.Places().categorySearch(
      'SW8',
      (data, status) => {
        if (status !== sv.Status.OK) return resolve([])
        resolve(
          data.map((d) => {
            const p = toPlace(d)
            const lineFromCategory = p.category.split('>').pop().trim()
            const m = p.name.match(/^(.+?)\s+(\S.*)$/)
            return {
              stationName: m ? m[1] : p.name,
              lineLabel: lineFromCategory || (m ? m[2] : ''),
              lat: p.lat,
              lng: p.lng,
              distance: p.distance,
              address: p.address,
            }
          }),
        )
      },
      { location: new kakao.maps.LatLng(lat, lng), radius, sort: sv.SortBy.DISTANCE, size },
    )
  })
}

/* ---------- 지도 ---------- */

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 지도를 그린다. points: [{ lat, lng, kind: 'me' | 'from' | 'home', label }]
// 점들이 모두 보이게 맞추고, 출발과 집 사이에 점선을 긋는다. 지도를 못 만들면 null
export async function drawMap(el, points) {
  const kakao = await loadKakao()
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (!kakao || !valid.length) return null
  const k = kakao.maps
  el.innerHTML = ''
  const map = new k.Map(el, { center: new k.LatLng(valid[0].lat, valid[0].lng), level: 5 })
  const bounds = new k.LatLngBounds()

  valid.forEach((p) => {
    const pos = new k.LatLng(p.lat, p.lng)
    bounds.extend(pos)
    new k.CustomOverlay({
      map,
      position: pos,
      yAnchor: 1.2,
      content: `<div class="map-pin ${escHtml(p.kind)}"><span>${escHtml(p.label || '')}</span></div>`,
    })
  })

  const from = valid.find((p) => p.kind === 'from')
  const home = valid.find((p) => p.kind === 'home')
  if (from && home) {
    new k.Polyline({
      map,
      path: [new k.LatLng(from.lat, from.lng), new k.LatLng(home.lat, home.lng)],
      strokeWeight: 4,
      strokeColor: '#0052a4',
      strokeOpacity: 0.55,
      strokeStyle: 'shortdash',
    })
  }

  if (valid.length > 1) map.setBounds(bounds, 60, 40, 40, 40)
  return { map, relayout: () => map.relayout() }
}

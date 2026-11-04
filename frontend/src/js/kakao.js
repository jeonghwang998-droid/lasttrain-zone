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

/* ---------- 내 주변 역 넓게 찾기 (자기장용) ---------- */

// 반경 안의 지하철역을 거리순으로 최대 maxPages × 15 곳. 카카오 검색은 한 번에 15곳씩 나눠 준다
export async function stationsAround(lat, lng, radius, maxPages = 3) {
  const kakao = await loadKakao()
  if (!kakao) return []
  const sv = kakao.maps.services
  const ps = new sv.Places()
  const out = []
  await new Promise((resolve) => {
    ps.categorySearch(
      'SW8',
      (data, status, pagination) => {
        if (status !== sv.Status.OK) return resolve()
        for (const d of data) {
          const p = toPlace(d)
          const m = p.name.match(/^(.+?)\s+(\S.*)$/)
          out.push({
            stationName: m ? m[1] : p.name,
            lineLabel: p.category.split('>').pop().trim() || (m ? m[2] : ''),
            lat: p.lat,
            lng: p.lng,
            distance: p.distance,
          })
        }
        if (pagination && pagination.hasNextPage && pagination.current < maxPages) pagination.nextPage()
        else resolve()
      },
      { location: new kakao.maps.LatLng(lat, lng), radius, sort: sv.SortBy.DISTANCE },
    )
  })
  return out
}

/* ---------- 지도 ---------- */

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 자기장 색: 여유가 많을수록 파랑, 줄어들면 주황, 거의 없으면 빨강 (css/global.css 의 --calm/--warn/--danger 와 같다)
const ZONE_COLORS = { calm: '#0052a4', warn: '#b86e00', danger: '#d92d3a' }
const ZONE_FILL_OPACITY = 0.05
// 처음 확대: 내 위치와 출발역이 아주 가까워도 이 단계보다 더 들어가지 않는다 (카카오 지도 단계, 작을수록 확대)
const MIN_START_LEVEL = 3

const pinHtml = (p) => `<div class="map-pin ${escHtml(p.kind)}"><span>${escHtml(p.label || '')}</span></div>`

// 지도를 그린다. points: [{ lat, lng, kind: 'me' | 'from' | 'home' | 'to', label }]
// 처음엔 내 위치에서 출발역까지만 보이게 확대한다 (빠르게 확인하도록). 내 위치가 없으면 모든 점이 보이게 맞춘다.
// 반환: { map, relayout, setMe(lat, lng), setZone(circles) }. 지도를 못 만들면 null
export async function drawMap(el, points) {
  const kakao = await loadKakao()
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (!kakao || !valid.length) return null
  const k = kakao.maps
  el.innerHTML = ''
  const map = new k.Map(el, { center: new k.LatLng(valid[0].lat, valid[0].lng), level: 5 })

  const pins = {}
  valid.forEach((p) => {
    pins[p.kind] = new k.CustomOverlay({ map, position: new k.LatLng(p.lat, p.lng), yAnchor: 1.2, zIndex: 3, content: pinHtml(p) })
  })

  const from = valid.find((p) => p.kind === 'from')
  const home = valid.find((p) => p.kind === 'home' || p.kind === 'to')
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

  const near = valid.filter((p) => p.kind === 'me' || p.kind === 'from')
  const fit = near.length && valid.some((p) => p.kind === 'me') ? near : valid
  if (fit.length > 1) {
    const bounds = new k.LatLngBounds()
    fit.forEach((p) => bounds.extend(new k.LatLng(p.lat, p.lng)))
    map.setBounds(bounds, 70, 50, 50, 50)
    if (map.getLevel() < MIN_START_LEVEL) map.setLevel(MIN_START_LEVEL)
  } else {
    map.setCenter(new k.LatLng(fit[0].lat, fit[0].lng))
    map.setLevel(MIN_START_LEVEL)
  }

  // 내 위치 핀을 옮긴다 (위치가 바뀔 때마다)
  function setMe(lat, lng) {
    const pos = new k.LatLng(lat, lng)
    if (pins.me) pins.me.setPosition(pos)
    else pins.me = new k.CustomOverlay({ map, position: pos, yAnchor: 1.2, zIndex: 3, content: pinHtml({ kind: 'me', label: '내 위치' }) })
  }

  // 자기장: circles = [{ key, lat, lng, radius(m), level }]. 같은 key 는 반경과 색만 바꿔서 부드럽게 줄어든다
  const circles = new Map()
  function setZone(list) {
    const keep = new Set()
    for (const c of list) {
      keep.add(c.key)
      const color = ZONE_COLORS[c.level] || ZONE_COLORS.calm
      // 원이 여러 개 겹치면 색이 진해지므로 아주 연하게 칠한다 (지도가 잘 보이도록)
      const style = { strokeWeight: 1, strokeColor: color, strokeOpacity: 0.25, fillColor: color, fillOpacity: ZONE_FILL_OPACITY }
      const old = circles.get(c.key)
      if (old) {
        old.setRadius(c.radius)
        old.setOptions(style)
      } else {
        circles.set(c.key, new k.Circle({ map, center: new k.LatLng(c.lat, c.lng), radius: c.radius, zIndex: 1, ...style }))
      }
    }
    for (const [key, circle] of circles) {
      if (!keep.has(key)) {
        circle.setMap(null)
        circles.delete(key)
      }
    }
  }

  return { map, relayout: () => map.relayout(), setMe, setZone }
}

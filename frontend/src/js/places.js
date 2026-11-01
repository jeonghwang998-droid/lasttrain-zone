// 장소 검색(자동완성): 카카오 지도 SDK 의 키워드 검색을 쓴다
// 키(KAKAO_JS_KEY)가 config.js 에 없으면 검색을 하지 않고, 입력창은 글자만 받는다

import { KAKAO_JS_KEY } from './config.js'

export const PLACES_CONNECTED = Boolean(KAKAO_JS_KEY)

let loading = null

function loadKakao() {
  if (!PLACES_CONNECTED) return Promise.resolve(null)
  if (loading) return loading
  loading = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
    s.onerror = () => {
      console.error('[places] 카카오 SDK 를 불러오지 못했어요')
      resolve(null)
    }
    document.head.append(s)
  })
  return loading
}

// 반환: [{ name, address, lat, lng }]
export async function searchPlaces(query) {
  const kakao = await loadKakao()
  if (!kakao || !query.trim()) return []
  return new Promise((resolve) => {
    new kakao.maps.services.Places().keywordSearch(
      query,
      (data, status) => {
        if (status !== kakao.maps.services.Status.OK) return resolve([])
        resolve(
          data.map((d) => ({
            name: d.place_name,
            address: d.road_address_name || d.address_name,
            lat: Number(d.y),
            lng: Number(d.x),
          })),
        )
      },
      { size: 6 },
    )
  })
}

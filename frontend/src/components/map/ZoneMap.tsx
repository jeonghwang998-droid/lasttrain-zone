import type { ZoneStation } from '../../types'

type Props = { stations: ZoneStation[]; center: { lat: number; lng: number } }

// TODO
  //  - 카카오맵 SDK 로드 (//dapi.kakao.com/v2/maps/sdk.js?appkey=...&autoload=false)
  //  - 역마다 kakao.maps.Circle 생성
  //  - 1초마다 zoneRadiusM() 으로 반경 갱신 → 자기장이 줄어듦
  //  - 현재 위치 마커
export default function ZoneMap(_props: Props) {
  return <div>ZoneMap (TODO)</div>
}

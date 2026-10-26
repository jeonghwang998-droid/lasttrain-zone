import { useEffect } from 'react'

/**
 * 안심 귀가: 집 반경 radiusM(기본 150m) 안에 들어오면 onArrive 호출
 * TODO: useGeolocation 위치와 집 좌표 거리 비교 → 한 번만 호출되도록 처리
 * ※ 웹은 앱이 열려 있을 때만 동작. "도착했어요" 버튼도 같이 제공할 것
 */
export function useArrivalCheck(
  home: { lat: number; lng: number } | null,
  onArrive: () => void,
  radiusM = 150,
) {
  useEffect(() => {
    if (!home) return
    // TODO
  }, [home, onArrive, radiusM])
}

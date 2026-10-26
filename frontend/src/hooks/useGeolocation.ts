import { useEffect, useState } from 'react'

export interface Position { lat: number; lng: number; accuracy: number }

/**
 * 현재 위치 감시
 * TODO: 마지막으로 보고한 위치에서 minMoveM(기본 50m) 이상 움직였을 때만 갱신해서 API 호출 줄이기
 */
export function useGeolocation(minMoveM = 50) {
  const [position, setPosition] = useState<Position | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('이 브라우저는 위치 정보를 지원하지 않아요.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setError(e.message),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [minMoveM])

  return { position, error }
}

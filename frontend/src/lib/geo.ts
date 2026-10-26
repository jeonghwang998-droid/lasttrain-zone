// 좌표 유틸

const R = 6_371_000

/** 두 좌표 사이 직선거리 (m) */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 자기장 반경 (m): (마지노선 - 지금 - 여유) × 걸음 속도 */
export function zoneRadiusM(deadline: Date, now: Date, bufferMin: number, speedMPerMin: number): number {
  const minutesLeft = (deadline.getTime() - now.getTime()) / 60000 - bufferMin
  return Math.max(0, minutesLeft * speedMPerMin)
}

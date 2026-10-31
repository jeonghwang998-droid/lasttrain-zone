// 경로와 막차 시각을 가져오는 곳.
//
// 교통 데이터는 외부 API 가 필요하다 (README 참고):
//   - 경로, 막차 시각: ODsay 대중교통 API (ODSAY_API_KEY)
//   - 역 좌표, 시간표: 공공데이터포털 도시철도 데이터 (stations 테이블)
//   - 현재 강수량: 기상청 단기예보 (KMA_API_KEY)
// 아직 연결 전이므로 가짜 경로를 만들지 않고 빈 목록을 돌려준다.

export const TRANSIT_CONNECTED = false

// 반환: [{ name, board, walkM, legs: [{ name, deps: [분], ride, xfer, line, c }] }]
export async function fetchRoutes() {
  return []
}

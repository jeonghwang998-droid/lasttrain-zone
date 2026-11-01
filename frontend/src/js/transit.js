// 경로와 막차 시각을 가져오는 곳.
//
// 교통 데이터는 외부 API 가 필요하다 (README 참고):
//   - 경로, 막차 시각: ODsay 대중교통 API (ODSAY_API_KEY)
//   - 역 좌표, 시간표: 공공데이터포털 도시철도 데이터 (stations 테이블)
//   - 현재 강수량: 기상청 단기예보 (KMA_API_KEY)
// 아직 연결 전이므로 가짜 경로를 만들지 않고 빈 목록을 돌려준다.

export const TRANSIT_CONNECTED = false

// trip: { from: { name, lat?, lng? }, to: { name, lat?, lng? } }  (사용자가 입력한 출발지와 도착지)
//
// 반환: 탈 수 있는 경로 목록. 화면(routeview.js)과 역산(planner.js)이 이 모양을 그대로 읽는다.
//   [{
//     name,        // 경로 이름
//     board,       // 첫 탑승역/정류장 이름
//     walkM,       // 출발지에서 첫 탑승역까지 걷는 거리(m)
//     legs: [{     // 환승할 때마다 구간이 하나씩 늘어난다 (예: 1호선 → 수인분당선)
//       name,      // 노선 이름 (예: "1호선")
//       from, to,  // 탑승역, 하차역 이름
//       deps,      // 탑승역 출발 시각(분, 오름차순). 마지막 값이 그 노선 막차
//       ride,      // 탑승 시간(분)
//       xfer,      // 내린 뒤 다음 구간 타는 곳까지 걷는 시간(분). 마지막 구간은 0
//       line,      // 지연 예측 모델 키 (예: "1호선"), 모르면 생략
//       c,         // 노선 색 (#rrggbb)
//     }]
//   }]
export async function fetchRoutes(trip) {
  return []
}

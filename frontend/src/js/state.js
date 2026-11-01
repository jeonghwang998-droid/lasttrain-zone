// 대시보드 화면이 공유하는 상태. 값은 모두 서버(Supabase)와 현재 시각에서 채운다

export const S = {
  ai: true, // AI 지연 보정 사용 여부
  wd: (new Date().getDay() + 6) % 7, // 오늘 요일 (0=월)
  rain: 0, // 시간당 강수량(mm). 날씨 데이터가 연결되기 전까지는 직접 입력
  buffer: 0, // 여유 시간(분): profiles.buffer_min
  walkSpeed: 0, // 내 보행 속도(m/분): profiles.walk_speed
  walkDefault: 0, // 전체 평균 보행 속도: app_config walk_speed.default
  trip: null, // 어디에서 어디까지: { from: {name, lat?, lng?}, to: {...} }
  routes: [], // 탈 수 있는 경로 (transit.js)
  fired: {}, // 이미 울린 알림
}

// 화면 전체가 공유하는 상태

import { toMin, HOMES } from './data.js'
import { getUser, getPrefs } from './account.js'

const user = getUser()

export const S = {
  from: 'sinbu',
  home: user && HOMES[user.home] ? user.home : 'ansan', // 내 정보에서 정한 집
  buffer: getPrefs().buffer, // 여유 시간(분)
  ai: true, // AI 지연 보정 사용 여부
  wd: 4, // 요일 (0=월)
  rain: 8, // 시간당 강수량(mm)
  friends: [
    { id: 1, name: '민수', home: 'suwon' },
    { id: 2, name: '지은', home: 'sillim' },
  ],
  nextId: 3,
  trips: [], // 보행 기록 [{ d: 거리m, m: 분 }]
  fired: {}, // 이미 울린 알림
}

// 시연용 시계: base(초) 에서 시작해 speed 배속으로 흐른다. real 이면 실제 시각
export const clock = {
  base: toMin('22:00') * 60,
  t0: performance.now(),
  speed: 1,
  real: false,
  wasReal: false,
}

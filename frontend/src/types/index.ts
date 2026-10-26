// 백엔드 API 응답 타입 (README 8. API 명세와 맞출 것)

export interface Leg {
  name: string
  depart: string               // "22:40"
  expected_delay_min?: number
  transfer_walk_min?: number
  is_last?: boolean
}

export interface Plan {
  leave_at: string             // ISO 시각
  probability: number          // 0 ~ 1
  walk_min: number
  legs: Leg[]
}

export interface PlanResponse {
  best: Plan | null
  routes: Plan[]
  taxi_fare: { if_missed: number; currency: 'KRW' }
}

export interface ZoneStation {
  id: string
  name: string
  lat: number
  lng: number
  deadline: string             // 이 역에서 타야 하는 마지노선 (ISO)
}

export interface ZoneResponse {
  stations: ZoneStation[]
}

export type MemberStatus = 'staying' | 'leaving' | 'arrived'

export interface Member {
  user_id: string
  nickname: string
  leave_at: string | null
  status: MemberStatus
}

export interface Room {
  id: string
  code: string
  place_label: string
  place_lat: number
  place_lng: number
  status: 'active' | 'closed'
}

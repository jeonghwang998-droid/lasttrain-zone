import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_BASE_URL

// 백엔드 호출 공통 함수: Supabase 로그인 토큰(JWT)을 자동으로 붙인다
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

// TODO: 엔드포인트별 함수
// export const getPlan = (lat: number, lng: number) =>
//   api<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify({ lat, lng }) })
// export const getZone = () => api<ZoneResponse>('/api/zone')
// export const createRoom = ...
// export const joinRoom = ...

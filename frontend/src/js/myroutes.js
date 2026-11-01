// 내가 등록한 막차 경로 (Supabase user_routes): 등록, 목록, 수정, 삭제
// 경로 한 줄 = 사용자가 정한 이름(선택) + 출발지 + 도착지. 좌표는 자동완성으로 고른 경우에만 있다

import { supabase } from './supabase.js'

const COLS =
  'id, label, from_name, from_lat, from_lng, from_station_id, from_line, to_name, to_lat, to_lng, to_station_id, to_line'

// 서버 오류는 화면에 그대로 보이지 않게 한국어 문구로 바꾼다
export function routeError(error) {
  console.error('[myroutes]', error)
  const code = error && error.code
  const msg = (error && error.message) || ''
  if (code === 'PGRST205' || code === '42P01' || code === '42703' || code === 'PGRST204' || /schema cache|does not exist/i.test(msg)) {
    return '경로 등록 기능이 아직 준비되지 않았어요. 관리자에게 알려 주세요.'
  }
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

// 좌표(장소 검색)나 역 정보(노선에서 고르기)가 있으면 같이 담는다
const placeOf = (name, lat, lng, stationId, line) => ({
  name,
  ...(lat == null || lng == null ? {} : { lat, lng }),
  ...(stationId ? { stationId, line } : {}),
})

// 화면과 transit.js 가 쓰는 { from, to } 모양으로
export function toTrip(r) {
  return {
    from: placeOf(r.from_name, r.from_lat, r.from_lng, r.from_station_id, r.from_line),
    to: placeOf(r.to_name, r.to_lat, r.to_lng, r.to_station_id, r.to_line),
  }
}

const toRow = ({ label, from, to }) => ({
  label,
  from_name: from.name,
  from_lat: from.lat ?? null,
  from_lng: from.lng ?? null,
  from_station_id: from.stationId ?? null,
  from_line: from.line ?? null,
  to_name: to.name,
  to_lat: to.lat ?? null,
  to_lng: to.lng ?? null,
  to_station_id: to.stationId ?? null,
  to_line: to.line ?? null,
})

// 등록한 순서대로
export async function listRoutes() {
  const { data, error } = await supabase.from('user_routes').select(COLS).order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// route: { label, from: {name, lat?, lng?}, to: {...} }
export async function addRoute(uid, route) {
  const { data, error } = await supabase
    .from('user_routes')
    .insert({ user_id: uid, ...toRow(route) })
    .select(COLS)
    .single()
  if (error) throw error
  return data
}

export async function editRoute(id, route) {
  const { data, error } = await supabase.from('user_routes').update(toRow(route)).eq('id', id).select(COLS).single()
  if (error) throw error
  return data
}

export async function removeRoute(id) {
  const { error } = await supabase.from('user_routes').delete().eq('id', id)
  if (error) throw error
}

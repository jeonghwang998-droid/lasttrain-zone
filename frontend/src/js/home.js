// 내 집(도착지) 저장과 불러오기 (Supabase my_home). 집은 나만 볼 수 있다

import { supabase } from './supabase.js'

// 서버 오류는 한국어 문구로
export function homeError(error) {
  console.error('[home]', error)
  const code = error && error.code
  const msg = (error && error.message) || ''
  if (code === 'PGRST205' || code === '42P01' || code === '42703' || /schema cache|does not exist/i.test(msg)) {
    return '집 설정 기능이 아직 준비되지 않았어요. 관리자에게 알려 주세요.'
  }
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

// 화면에서 쓰는 모양: { name, address, lat, lng, station: { id, label, line } | null }
const fromRow = (r) => ({
  name: r.place_name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  station: r.station_id ? { id: r.station_id, label: r.station_label, line: r.station_line } : null,
})

// 집이 아직 없으면 null
export async function loadHome(uid) {
  const { data, error } = await supabase.from('my_home').select('*').eq('user_id', uid).maybeSingle()
  if (error) throw error
  return data ? fromRow(data) : null
}

export async function saveHome(uid, home) {
  const { error } = await supabase.from('my_home').upsert(
    {
      user_id: uid,
      place_name: home.name || '',
      address: home.address || '',
      lat: home.lat ?? null,
      lng: home.lng ?? null,
      station_id: home.station ? home.station.id : null,
      station_label: home.station ? home.station.label : null,
      station_line: home.station ? home.station.line : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

// 집 설정을 지운다 (등록한 경로는 그대로 남는다)
export async function clearHome(uid) {
  const { error } = await supabase.from('my_home').delete().eq('user_id', uid)
  if (error) throw error
}

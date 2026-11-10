// 내 프로필, 설정값, 보행 기록 (Supabase). 숫자는 코드에 박지 않고 app_config 에서 읽는다

import { supabase } from './supabase.js'

// 로그인된 사용자 id. 로그인이 안 되어 있으면 null
// 이 기기에 남은 로그인 기록만 믿지 않고 서버에 실제로 있는 계정인지 확인한다
// (계정이 지워졌거나 기록이 만료된 경우 로그인 상태로 착각하지 않도록)
export async function sessionUserId() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return null
  const { data: res, error } = await supabase.auth.getUser()
  if (error || !res.user) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    return null
  }
  return res.user.id
}

// app_config 에서 필요한 키만 읽어 { key: value } 로
export async function loadConfig(keys) {
  const { data, error } = await supabase.from('app_config').select('key, value').in('key', keys)
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.key, r.value]))
}

export async function loadProfile(uid) {
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname, buffer_min, walk_speed')
    .eq('id', uid)
    .single()
  if (error) throw error
  return data
}

export async function saveNickname(uid, nickname) {
  const { error } = await supabase.from('profiles').update({ nickname }).eq('id', uid)
  if (error) throw error
}

export async function saveBuffer(uid, minutes) {
  const { error } = await supabase.from('profiles').update({ buffer_min: minutes }).eq('id', uid)
  if (error) throw error
}

/* ---------- 보행 기록 ---------- */
export async function loadTrips(limit) {
  const { data, error } = await supabase
    .from('walk_trips')
    .select('id, distance_m, minutes, speed, is_valid')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function addTrip(uid, distanceM, minutes) {
  const { error } = await supabase.from('walk_trips').insert({ user_id: uid, distance_m: distanceM, minutes })
  if (error) throw error
}

export async function deleteTrip(id) {
  const { error } = await supabase.from('walk_trips').delete().eq('id', id)
  if (error) throw error
}

// 모임방: 만들기, 초대 코드로 입장, 멤버 목록, 상태 변경 (Supabase)
// 방 만들기/입장/나가기는 Supabase 에 만들어 둔 함수(create_room, join_room, leave_room)를 부른다

import { supabase } from './supabase.js'
import { url } from './app.js'

// 서버가 한국어로 보낸 안내(RAISE EXCEPTION)는 그대로 보여 주고, 그 밖의 오류는 일반 문구로
export function roomError(error) {
  console.error('[rooms]', error)
  const msg = (error && error.message) || ''
  if (/[가-힣]/.test(msg)) return msg
  if (error && (error.code === 'PGRST202' || /function .* does not exist|schema cache/i.test(msg))) {
    return '모임 기능이 아직 준비되지 않았어요. 관리자에게 알려 주세요.'
  }
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

// 내가 들어가 있는 진행 중인 방들 (최근에 만든 순)
export async function myRooms() {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, place_label, host_id, expires_at, created_at')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// 방 멤버 (닉네임과 아바타 색은 같은 방 사람끼리만 보인다. 집 위치는 여기에 없다)
export async function roomMembers(roomId) {
  const { data, error } = await supabase
    .from('room_members')
    .select('user_id, status, leave_at, joined_at, profiles(nickname, avatar_colors(hex))')
    .eq('room_id', roomId)
  if (error) throw error
  return data.map((m) => ({
    userId: m.user_id,
    status: m.status,
    leaveAt: m.leave_at ? new Date(m.leave_at) : null,
    joinedAt: new Date(m.joined_at),
    nickname: (m.profiles && m.profiles.nickname) || '이름 없음',
    color: m.profiles && m.profiles.avatar_colors ? m.profiles.avatar_colors.hex : null,
  }))
}

export async function createRoom(placeLabel) {
  const { data, error } = await supabase.rpc('create_room', { p_place_label: placeLabel || '' })
  if (error) throw error
  return data // { room_id, code }
}

export async function joinRoom(code) {
  const { data, error } = await supabase.rpc('join_room', { p_code: code })
  if (error) throw error
  return data // room id
}

export async function leaveRoom(roomId) {
  const { error } = await supabase.rpc('leave_room', { p_room: roomId })
  if (error) throw error
}

export async function setMyStatus(roomId, uid, status) {
  const { error } = await supabase.from('room_members').update({ status }).eq('room_id', roomId).eq('user_id', uid)
  if (error) throw error
}

export async function setMyLeaveAt(roomId, uid, date) {
  const { error } = await supabase
    .from('room_members')
    .update({ leave_at: date ? date.toISOString() : null })
    .eq('room_id', roomId)
    .eq('user_id', uid)
  if (error) throw error
}

// 멤버가 바뀌면 callback 을 부른다. 반환값을 호출하면 구독을 끊는다
export function watchRoom(roomId, callback) {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, callback)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// 친구에게 보낼 초대 링크. 열면 로그인 후 자동으로 입장한다
export function inviteLink(code) {
  return url('html/join.html') + '?code=' + encodeURIComponent(code)
}

// 공유 시트가 있으면(휴대폰) 그걸 열고, 없으면 링크를 복사한다. 반환: 'shared' | 'copied' | 'failed'
export async function shareInvite(room) {
  const link = inviteLink(room.code)
  const title = '막차 자기장 모임 초대'
  const text = `${room.place_label ? room.place_label + ' ' : ''}모임에 초대해요. 초대 코드: ${room.code}`
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: link })
      return 'shared'
    } catch (e) {
      if (e && e.name === 'AbortError') return 'failed' // 사용자가 닫음
    }
  }
  try {
    await navigator.clipboard.writeText(link)
    return 'copied'
  } catch (e) {
    return 'failed'
  }
}

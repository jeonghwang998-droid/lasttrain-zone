import { useEffect, useState } from 'react'
import type { Member } from '../types'

/**
 * 모임방 멤버 상태 실시간 구독 (Supabase Realtime)
 * TODO
 * 1. 처음 진입 시 room_members + profiles(nickname) 조회
 * 2. supabase.channel(`room:${roomId}`)
 *      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, ...)
 *      .subscribe()
 * 3. leave_at 오름차순 정렬 (가장 먼저 일어나야 하는 사람이 위)
 * 4. 언마운트 시 removeChannel
 */
export function useRoomRealtime(roomId: string | undefined) {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (!roomId) return
    // TODO
  }, [roomId])

  return { members, setMembers }
}

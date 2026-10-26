// html/room.html 담당: 멤버 순위, 교집합 자기장, 다 같이 일어나기

import { initApp, url } from './app.js'

initApp()

const roomId = new URLSearchParams(location.search).get('id')

const titleEl = document.getElementById('room-title')
const codeEl = document.getElementById('room-code')
const bannerEl = document.getElementById('call-banner')
const memberListEl = document.getElementById('member-list')
const arrivedBtn = document.getElementById('btn-arrived')
const callBtn = document.getElementById('btn-call')

// members: [{ nickname, leave_at, status }] — 집 좌표는 다루지 않는다
function renderMembers(members) {
  const sorted = [...members].sort((a, b) => new Date(a.leave_at) - new Date(b.leave_at))
  memberListEl.replaceChildren(
    ...sorted.map((m) => {
      const li = document.createElement('li')
      const time = new Date(m.leave_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      li.textContent = `${m.nickname} · ${time} · ${m.status}`
      return li
    }),
  )
}

function showBanner(text) {
  bannerEl.textContent = text
  bannerEl.hidden = false
}

callBtn.addEventListener('click', () => {
  // TODO: POST /api/rooms/{id}/call
  showBanner('다 같이 일어날 시간이에요!')
})

arrivedBtn.addEventListener('click', () => {
  // TODO: PATCH /api/rooms/{id}/me {status: 'arrived'}
  arrivedBtn.disabled = true
  arrivedBtn.textContent = '귀가 완료 ✓'
})

if (!roomId) {
  location.href = url('html/join.html')
} else {
  titleEl.textContent = '모임방'
  codeEl.textContent = ''
  // TODO: 방 정보 조회 + Supabase Realtime 구독 후 renderMembers 호출
  renderMembers([])
}

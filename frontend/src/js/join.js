// html/join.html 담당: 초대 코드로 입장, 모임방 만들기

import { initApp } from './app.js'
import { getUser } from './account.js'

initApp()

const $ = (id) => document.getElementById(id)

const loggedIn = !!getUser()
$('guest').hidden = loggedIn
$('member-only').hidden = !loggedIn

const form = $('join-form')
const codeInput = form.elements.code

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase()
})

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const code = codeInput.value.trim()
  if (code.length !== 6) {
    alert('초대 코드는 6자리예요.')
    return
  }
  // TODO: POST /api/rooms/join {code} → room_id 받아 room.html?id=... 로 이동
  console.log('join', code)
  alert('모임방 입장은 서버 연결 후에 쓸 수 있어요.')
})

$('btn-create-room').addEventListener('click', () => {
  // TODO: POST /api/rooms 후 room.html?id=... 로 이동
  alert('모임방 만들기는 서버 연결 후에 쓸 수 있어요.')
})

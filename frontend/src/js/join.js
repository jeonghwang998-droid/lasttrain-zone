// html/join.html 담당: 초대 링크/코드로 입장, 모임방 만들기
// 로그인 전에 초대 링크로 들어오면 코드를 기억해 두었다가 로그인 후 자동으로 입장한다

import { initApp, url } from './app.js'
import { sessionUserId } from './db.js'
import { joinRoom, createRoom, roomError } from './rooms.js'

initApp()

const $ = (id) => document.getElementById(id)
const PENDING_KEY = 'lz_pending_invite'

const dashboardOf = (roomId) => url('html/dashboard.html') + '?view=group&room=' + encodeURIComponent(roomId)

const form = $('join-form')
const codeInput = form.elements.code
const errEl = $('join-error')

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase()
  errEl.textContent = ''
})

async function enter(code) {
  errEl.textContent = '입장하는 중…'
  try {
    const id = await joinRoom(code)
    sessionStorage.removeItem(PENDING_KEY)
    location.href = dashboardOf(id)
  } catch (e) {
    errEl.textContent = roomError(e)
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const code = codeInput.value.trim()
  if (code.length !== 6) {
    errEl.textContent = '초대 코드는 6자리예요.'
    return
  }
  enter(code)
})

$('btn-create-room').addEventListener('click', async () => {
  const btn = $('btn-create-room')
  btn.disabled = true
  try {
    const res = await createRoom($('place-input').value.trim())
    location.href = dashboardOf(res.room_id)
  } catch (e) {
    $('create-error').textContent = roomError(e)
    btn.disabled = false
  }
})

const uid = await sessionUserId()
$('guest').hidden = !!uid
$('member-only').hidden = !uid

const invited = new URLSearchParams(location.search).get('code')
if (invited) {
  const code = invited.trim().toUpperCase()
  if (uid) {
    codeInput.value = code
    enter(code)
  } else {
    // 로그인 후 돌아와 자동 입장할 수 있게 기억해 둔다
    sessionStorage.setItem(PENDING_KEY, code)
    $('guest-hint').textContent = `초대 코드 ${code} 로 초대받았어요. 로그인하거나 가입하면 바로 입장해요.`
  }
} else if (uid && sessionStorage.getItem(PENDING_KEY)) {
  enter(sessionStorage.getItem(PENDING_KEY))
}

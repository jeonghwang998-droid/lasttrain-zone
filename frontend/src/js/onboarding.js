// html/onboarding.html 담당: 집 위치 등록, 알림 권한

import { initApp, url } from './app.js'
import { HOMES } from './data.js'
import { getUser, updateUser } from './account.js'

initApp()

const form = document.getElementById('onboarding-form')
const homeEl = document.getElementById('home')
const pushBtn = document.getElementById('btn-push-permission')

// 로그인 없이 들어왔으면 로그인부터
const user = getUser()
if (!user) location.replace(url('html/login.html'))

homeEl.innerHTML = Object.keys(HOMES)
  .map((k) => `<option value="${k}"${user && k === user.home ? ' selected' : ''}>${HOMES[k]}</option>`)
  .join('')

function renderPermission() {
  if (!('Notification' in window)) {
    pushBtn.hidden = true
    return
  }
  const granted = Notification.permission === 'granted'
  pushBtn.textContent = granted ? '알림 허용됨 ✓' : '알림 권한 허용'
  pushBtn.disabled = granted
}

pushBtn.addEventListener('click', async () => {
  await Notification.requestPermission()
  renderPermission()
})

form.addEventListener('submit', (e) => {
  e.preventDefault()
  // TODO: 집 위치를 서버(Supabase user_homes)에 저장
  updateUser({ home: homeEl.value })
  location.href = url('html/dashboard.html')
})

renderPermission()

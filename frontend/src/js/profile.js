// html/profile.html 담당: 내 정보, 출발 설정, 알림, 앱 설치, 로그아웃, 회원 탈퇴

import { initApp, url } from './app.js'
import { HOMES } from './data.js'
import { getUser, updateUser, logout, withdraw, getPrefs, setPrefs } from './account.js'

initApp()

const $ = (id) => document.getElementById(id)

/* ---------- 프로필 ---------- */
function renderAccount() {
  const user = getUser()
  $('guest').hidden = !!user
  $('profile').hidden = !user
  $('account').hidden = !user
  if (!user) return

  $('avatar').textContent = user.nickname.slice(0, 1)
  $('nameView').textContent = user.nickname
  $('emailView').textContent = user.email
  $('nickname').value = user.nickname
  $('home').innerHTML = Object.keys(HOMES)
    .map((k) => `<option value="${k}"${k === user.home ? ' selected' : ''}>${HOMES[k]}</option>`)
    .join('')
}

$('profile-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const nickname = $('nickname').value.trim()
  if (!nickname) {
    $('profile-error').textContent = '닉네임을 입력해 주세요.'
    return
  }
  // TODO: 서버(profiles, user_homes)에도 저장
  updateUser({ nickname, home: $('home').value })
  $('profile-error').textContent = ''
  renderAccount()
  toast('저장했어요.')
})

$('profile-form').addEventListener('input', () => {
  $('profile-error').textContent = ''
})

/* ---------- 출발 설정 ---------- */
$('buffer').value = getPrefs().buffer
renderBuffer()
$('buffer').addEventListener('input', (e) => {
  setPrefs({ buffer: Number(e.target.value) })
  renderBuffer()
})

function renderBuffer() {
  $('bufferVal').textContent = `${$('buffer').value}분 일찍 일어나기`
}

/* ---------- 알림 ---------- */
document.querySelectorAll('[data-notify]').forEach((btn) => {
  const key = btn.dataset.notify
  btn.setAttribute('aria-pressed', getPrefs().notify[key])
  btn.addEventListener('click', () => {
    const on = !getPrefs().notify[key]
    setPrefs({ notify: { [key]: on } })
    btn.setAttribute('aria-pressed', on)
  })
})

function renderPermission() {
  const stateEl = $('permState')
  const btn = $('permBtn')
  if (!('Notification' in window)) {
    stateEl.textContent = '이 브라우저는 알림을 지원하지 않아요'
    btn.hidden = true
    return
  }
  const p = Notification.permission
  stateEl.textContent = p === 'granted' ? '허용됨' : p === 'denied' ? '차단됨 · 브라우저 설정에서 풀어야 해요' : '아직 허용하지 않았어요'
  btn.hidden = p !== 'default'
}

$('permBtn').addEventListener('click', async () => {
  await Notification.requestPermission()
  renderPermission()
})

/* ---------- 앱 설치 ---------- */
let installEvent = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e
  $('installRow').hidden = false
})

$('installBtn').addEventListener('click', async () => {
  if (!installEvent) return
  installEvent.prompt()
  await installEvent.userChoice
  installEvent = null
  $('installRow').hidden = true
})

window.addEventListener('appinstalled', () => {
  $('installRow').hidden = true
})

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
$('iosHint').hidden = !(isIos && !isStandalone)

/* ---------- 로그아웃 / 탈퇴 ---------- */
$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('로그아웃할까요?')) return
  await logout()
  location.href = url('index.html')
})

$('withdrawBtn').addEventListener('click', async () => {
  const ok = confirm('정말 탈퇴할까요?\n내 계정과 정보가 모두 삭제되고 되돌릴 수 없어요.')
  if (!ok) return
  const btn = $('withdrawBtn')
  btn.disabled = true
  const res = await withdraw()
  if (res.error) {
    btn.disabled = false
    toast(res.error)
    return
  }
  location.href = url('index.html')
})

/* ---------- 작은 안내 메시지 ---------- */
let toastTimer
function toast(msg) {
  let el = document.querySelector('.snack')
  if (!el) {
    el = document.createElement('div')
    el.className = 'snack'
    el.setAttribute('role', 'status')
    document.body.append(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000)
}

renderAccount()
renderPermission()

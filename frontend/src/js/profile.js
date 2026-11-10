// html/profile.html 담당: 내 프로필(닉네임), 우리집, 알림 설정, 로그아웃, 회원 탈퇴
// 화면에 보이는 값은 전부 서버(Supabase)와 이 기기의 실제 상태에서 가져온다. 가짜 데이터는 없다

import { initApp, url } from './app.js'
import { logout, withdraw, getPrefs, setPrefs, updateUser } from './account.js'
import { sessionUserId, loadProfile, saveNickname } from './db.js'
import { supabase } from './supabase.js'
import * as Home from './home.js'
import { ring, askPermission, canNotify, canVibrate } from './notify.js'

initApp()

const $ = (id) => document.getElementById(id)

let uid = null

/* ---------- 프로필 ---------- */
function showProfile(nickname, email) {
  $('avatar').textContent = (nickname || '?').slice(0, 1)
  $('nameView').textContent = nickname || ''
  $('emailView').textContent = email || ''
  $('nickname').value = nickname || ''
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const nickname = $('nickname').value.trim()
  if (!nickname) {
    $('profile-error').textContent = '닉네임을 입력해 주세요.'
    return
  }
  $('nickSave').disabled = true
  try {
    await saveNickname(uid, nickname)
    updateUser({ nickname }) // 이 기기에 복사해 둔 로그인 정보도 맞춘다
    showProfile(nickname, $('emailView').textContent)
    $('profile-error').textContent = ''
    toast('저장했어요.')
  } catch (err) {
    console.error(err)
    $('profile-error').textContent = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  } finally {
    $('nickSave').disabled = false
  }
})

$('profile-form').addEventListener('input', () => {
  $('profile-error').textContent = ''
})

/* ---------- 우리집 ---------- */
function showHome(home) {
  $('home-panel').hidden = false
  if (!home) {
    $('homeName').textContent = '아직 집을 정하지 않았어요'
    $('homeStation').textContent = '집을 정하면 어디서든 집으로 가는 막차를 알려 드려요'
    $('homeEdit').textContent = '집 정하기'
    return
  }
  $('homeName').textContent = home.address || home.name
  $('homeStation').textContent = home.station ? `가까운 역 · ${home.station.label}` : '가까운 역을 아직 고르지 않았어요'
  $('homeEdit').textContent = '바꾸기'
}

/* ---------- 알림 ---------- */
function renderToggles() {
  const prefs = getPrefs()
  document.querySelectorAll('[data-notify]').forEach((btn) => btn.setAttribute('aria-pressed', prefs.notify[btn.dataset.notify]))
  document.querySelectorAll('[data-pref]').forEach((btn) => btn.setAttribute('aria-pressed', prefs[btn.dataset.pref]))
}

document.querySelectorAll('[data-notify]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.notify
    setPrefs({ notify: { [key]: !getPrefs().notify[key] } })
    renderToggles()
  })
})
document.querySelectorAll('[data-pref]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.pref
    setPrefs({ [key]: !getPrefs()[key] })
    renderToggles()
  })
})

if (!canVibrate()) {
  $('vibrateNote').textContent = '이 기기는 진동을 지원하지 않아요 (아이폰, 노트북)'
  document.querySelector('[data-pref="vibrate"]').disabled = true
}

function renderPermission() {
  const stateEl = $('permState')
  const btn = $('permBtn')
  if (!canNotify()) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    stateEl.textContent = ios ? '아이폰은 공유 버튼 → "홈 화면에 추가"로 설치한 앱에서만 알림이 와요' : '이 브라우저는 알림을 지원하지 않아요'
    btn.hidden = true
    return
  }
  const p = Notification.permission
  stateEl.textContent =
    p === 'granted' ? '허용됨 · 화면 위에 알림이 떠요' : p === 'denied' ? '차단됨 · 주소창 왼쪽 자물쇠에서 알림을 허용으로 바꿔 주세요' : '아직 허용하지 않았어요'
  btn.hidden = p !== 'default'
}

$('permBtn').addEventListener('click', async () => {
  await askPermission()
  renderPermission()
})

// 실제 알람과 똑같이 울려 보고, 이 기기에서 무엇이 됐는지 알려 준다
$('testBtn').addEventListener('click', async () => {
  if (canNotify() && Notification.permission === 'default') await askPermission()
  renderPermission()
  const done = await ring('알림 시험이에요. 막차 시각이 되면 이렇게 울려요.', 'lz-test')
  const prefs = getPrefs()
  const parts = [
    prefs.sound ? (done.sound ? '소리 남' : '소리 안 남') : '소리 꺼 둠',
    !canVibrate() ? '진동 없는 기기' : prefs.vibrate ? (done.vibrate ? '진동함' : '진동 안 함') : '진동 꺼 둠',
    done.notice ? '화면 알림 뜸' : '화면 알림 안 뜸 (권한 필요)',
  ]
  $('testResult').textContent = parts.join(' · ')
})

/* ---------- 로그아웃 / 탈퇴 ---------- */
$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('로그아웃할까요?')) return
  await logout()
  location.href = url('index.html')
})

$('withdrawBtn').addEventListener('click', async () => {
  const ok = confirm('정말 탈퇴할까요?\n내 계정과 집, 등록한 경로, 모임 기록이 모두 삭제되고 되돌릴 수 없어요.')
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

/* ---------- 시작 ---------- */
async function init() {
  uid = await sessionUserId()
  $('loading').hidden = true
  $('guest').hidden = Boolean(uid)
  if (!uid) return
  ;['profile', 'notify-panel', 'account'].forEach((id) => ($(id).hidden = false))
  renderToggles()
  renderPermission()

  const { data } = await supabase.auth.getUser()
  try {
    const p = await loadProfile(uid)
    showProfile(p.nickname, data.user && data.user.email)
  } catch (e) {
    console.error(e)
    showProfile('', data.user && data.user.email)
    $('profile-error').textContent = '내 정보를 불러오지 못했어요. 새로고침해 주세요.'
  }
  try {
    showHome(await Home.loadHome(uid))
  } catch (e) {
    $('home-panel').hidden = false
    $('homeName').textContent = Home.homeError(e)
    $('homeStation').textContent = ''
  }
}

init()

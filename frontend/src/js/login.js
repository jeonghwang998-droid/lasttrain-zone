// html/login.html 담당: 로그인

import { initApp, url } from './app.js'
import { login } from './account.js'

initApp()

const form = document.getElementById('login-form')
const errEl = document.getElementById('login-error')

// 가입 직후에 넘어왔으면 안내를 보여 주고 이메일을 채워 둔다
const params = new URLSearchParams(location.search)
if (params.get('registered')) document.getElementById('login-notice').hidden = false
if (params.get('email')) form.elements.email.value = params.get('email')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const { email, password } = Object.fromEntries(new FormData(form))
  if (!EMAIL_RE.test(email.trim())) {
    errEl.textContent = '아이디나 비밀번호를 확인해 주세요.'
    return
  }
  if (password.length < 6) {
    errEl.textContent = '아이디나 비밀번호를 확인해 주세요.'
    return
  }
  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true
  btn.textContent = '로그인 중…'
  let res
  try {
    res = await login({ email: email.trim().toLowerCase(), password })
  } catch (err) {
    console.error(err)
    res = { error: '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' }
  } finally {
    btn.disabled = false
    btn.textContent = '로그인'
  }
  if (res.error) {
    errEl.textContent = res.error
    return
  }
  // 초대 링크로 들어왔다가 로그인한 경우 입장 페이지로 보내 자동 입장시킨다
  const pending = sessionStorage.getItem('lz_pending_invite')
  location.href = pending ? url('html/join.html') : url('html/dashboard.html')
})

form.addEventListener('input', () => {
  errEl.textContent = ''
})

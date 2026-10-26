// html/login.html 담당: 로그인

import { initApp, url } from './app.js'
import { login } from './account.js'

initApp()

const form = document.getElementById('login-form')
const errEl = document.getElementById('login-error')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const { email, password } = Object.fromEntries(new FormData(form))
  if (!EMAIL_RE.test(email.trim())) {
    errEl.textContent = '이메일 형식을 확인해 주세요.'
    return
  }
  if (password.length < 6) {
    errEl.textContent = '비밀번호는 6자 이상이에요.'
    return
  }
  // TODO: Supabase Auth 로 로그인
  login(email.trim().toLowerCase())
  location.href = url('index.html')
})

form.addEventListener('input', () => {
  errEl.textContent = ''
})

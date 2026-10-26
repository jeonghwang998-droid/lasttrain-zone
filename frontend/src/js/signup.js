// html/signup.html 담당: 회원가입

import { initApp, url } from './app.js'
import { signup } from './account.js'

initApp()

const form = document.getElementById('signup-form')
const errEl = document.getElementById('signup-error')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(form))
  const nickname = data.nickname.trim()
  const email = data.email.trim().toLowerCase()

  if (!nickname) return fail('닉네임을 입력해 주세요.')
  if (!EMAIL_RE.test(email)) return fail('이메일 형식을 확인해 주세요.')
  if (data.password.length < 6) return fail('비밀번호는 6자 이상이에요.')
  if (data.password !== data.password2) return fail('비밀번호가 서로 달라요.')
  if (!data.agree) return fail('약관에 동의해야 가입할 수 있어요.')

  // TODO: Supabase Auth 로 가입
  signup({ email, nickname })
  location.href = url('html/onboarding.html')
})

form.addEventListener('input', () => {
  errEl.textContent = ''
})

function fail(msg) {
  errEl.textContent = msg
}

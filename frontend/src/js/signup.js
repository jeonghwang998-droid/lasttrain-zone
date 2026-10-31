// html/signup.html 담당: 회원가입

import { initApp, url } from './app.js'
import { signup } from './account.js'

initApp()

const form = document.getElementById('signup-form')
const errEl = document.getElementById('signup-error')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(form))
  const nickname = data.nickname.trim()
  const email = data.email.trim().toLowerCase()

  if (!nickname) return fail('닉네임을 입력해 주세요.')
  if (!EMAIL_RE.test(email)) return fail('이메일 형식을 확인해 주세요.')
  if (data.password.length < 6) return fail('비밀번호는 6자 이상이에요.')
  if (data.password !== data.password2) return fail('비밀번호가 서로 달라요.')
  if (!data.agree) return fail('약관에 동의해야 가입할 수 있어요.')

  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true
  btn.textContent = '가입 중…'
  let res
  try {
    res = await signup({ email, password: data.password, nickname })
  } catch (err) {
    console.error(err)
    res = { error: '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' }
  } finally {
    btn.disabled = false
    btn.textContent = '가입하기'
  }
  if (res.error) return fail(res.error)
  showDone(email, res.needsConfirm)
})

// 가입 완료 화면: 폼을 숨기고 성공 안내와 로그인 버튼을 보여 준다
function showDone(email, needsConfirm) {
  form.hidden = true
  document.getElementById('signup-head').hidden = true
  document.getElementById('signup-switch').hidden = true
  document.getElementById('done-email').textContent = email
  document.getElementById('done-confirm').hidden = !needsConfirm
  document.getElementById('signup-done').hidden = false
  document.getElementById('done-login').href = url('html/login.html') + '?registered=1&email=' + encodeURIComponent(email)
  window.scrollTo(0, 0)
}

form.addEventListener('input', () => {
  errEl.textContent = ''
})

function fail(msg) {
  errEl.textContent = msg
}

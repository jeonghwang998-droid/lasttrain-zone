// 계정과 사용자 설정 저장소
//
// 가입과 로그인은 Supabase Auth 로 하고, 화면이 동기로 읽을 수 있게 이 브라우저의 localStorage 에도 복사해 둔다.
// 집 위치와 닉네임 수정은 아직 localStorage 에만 저장한다.

import { supabase } from './supabase.js'

const SESSION_KEY = 'lz_session' // 로그인한 이메일
const PROFILES_KEY = 'lz_profiles' // { [email]: { email, nickname, home, createdAt } }
const PREFS_KEY = 'lz_prefs' // 이 기기의 설정 (로그인과 무관)

export const DEFAULT_PREFS = {
  sound: true, // 알람 소리
  vibrate: true, // 진동 (안드로이드만)
  notify: { t30: true, t10: true, t0: true, arrived: true }, // 30분 전, 10분 전, 일어날 때, 모임 멤버 귀가 완료
}

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    /* 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 이번 방문에서만 유지 */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key)
  } catch (e) {
    /* 무시 */
  }
}

/* ---------- 계정 ---------- */
export function getUser() {
  const email = read(SESSION_KEY, null)
  if (!email) return null
  return read(PROFILES_KEY, {})[email] || null
}

function saveProfile(profile) {
  const all = read(PROFILES_KEY, {})
  all[profile.email] = profile
  write(PROFILES_KEY, all)
}

// Supabase Auth 로 가입한다. 성공하면 { ok: true, needsConfirm } (이메일 확인이 필요하면 needsConfirm: true), 실패하면 { error }
// 가입만 하고 로그인은 하지 않는다. 로그인은 login() 으로 따로 한다
export async function signup({ email, password, nickname }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nickname } }, // handle_new_user 트리거가 profiles.nickname 에 넣는다
  })
  if (error) return { error: authMessage(error) }
  // 이미 가입된 이메일은 에러 대신 identities 가 빈 사용자로 돌아온다
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: MSG_EXISTS }
  }
  if (!data.session) return { ok: true, needsConfirm: true } // 이메일 확인을 켜 둔 프로젝트

  // 트리거가 닉네임을 못 넣은 경우를 대비해 한 번 더 저장한 뒤, 로그인 화면에서 직접 로그인하게 로그아웃해 둔다
  await supabase.from('profiles').update({ nickname }).eq('id', data.user.id)
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  return { ok: true, needsConfirm: false }
}

export async function login({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: authMessage(error) }

  const { data: row } = await supabase.from('profiles').select('nickname').eq('id', data.user.id).maybeSingle()
  const nickname = (row && row.nickname) || data.user.user_metadata?.nickname || email.split('@')[0]
  const profile = { email, nickname, createdAt: Date.now() }
  saveProfile(profile)
  write(SESSION_KEY, email)
  return { profile }
}

export async function logout() {
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  remove(SESSION_KEY)
}

// Supabase 오류를 한국어 문구로 바꾼다. 모르는 오류도 영어 원문은 화면에 보여 주지 않고 콘솔에만 남긴다
const MSG_WRONG = '아이디나 비밀번호를 확인해 주세요.'
const MSG_EXISTS = '이미 존재하는 계정입니다.'
const MSG_BUSY = '요청이 많아 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
const MSG_FAIL = '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'

const AUTH_MESSAGES = {
  invalid_credentials: MSG_WRONG,
  user_not_found: MSG_WRONG,
  email_not_confirmed: MSG_WRONG,
  user_already_exists: MSG_EXISTS,
  email_exists: MSG_EXISTS,
  weak_password: '비밀번호가 너무 쉬워요. 더 길고 복잡하게 만들어 주세요.',
  email_address_invalid: '사용할 수 없는 이메일이에요. 다른 이메일로 가입해 주세요.',
  validation_failed: '입력한 내용을 확인해 주세요.',
  over_email_send_rate_limit: MSG_BUSY,
  over_request_rate_limit: MSG_BUSY,
  user_banned: '이용이 제한된 계정이에요.',
}

function authMessage(error) {
  console.error('[auth]', error) // 서버가 준 원문은 콘솔에만 남긴다
  if (AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]
  const m = (error.message || '').toLowerCase()
  if (m.includes('invalid login') || m.includes('not confirmed')) return MSG_WRONG
  if (m.includes('already registered') || m.includes('already been registered')) return MSG_EXISTS
  if (m.includes('rate limit') || m.includes('too many')) return MSG_BUSY
  if (m.includes('password')) return '비밀번호를 확인해 주세요. (6자 이상)'
  if (m.includes('fetch') || m.includes('network')) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
  return MSG_FAIL
}

export function updateUser(patch) {
  const user = getUser()
  if (!user) return null
  const next = { ...user, ...patch }
  saveProfile(next)
  return next
}

// 회원 탈퇴: 서버의 계정과 데이터를 진짜로 지운 뒤, 이 기기의 로그인 기록과 설정도 지운다.
// 서버에서 지우지 못하면 { error } 를 돌려주고 아무것도 지우지 않는다
export async function withdraw() {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) {
    console.error('[withdraw]', error)
    const msg = error.message || ''
    return { error: /[가-힣]/.test(msg) ? msg : '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
  const user = getUser()
  if (user) {
    const all = read(PROFILES_KEY, {})
    delete all[user.email]
    write(PROFILES_KEY, all)
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  remove(SESSION_KEY)
  remove(PREFS_KEY)
  return { ok: true }
}

/* ---------- 설정 ---------- */
export function getPrefs() {
  const saved = read(PREFS_KEY, {})
  return { ...DEFAULT_PREFS, ...saved, notify: { ...DEFAULT_PREFS.notify, ...(saved.notify || {}) } }
}

export function setPrefs(patch) {
  const cur = getPrefs()
  const next = { ...cur, ...patch, notify: { ...cur.notify, ...(patch.notify || {}) } }
  write(PREFS_KEY, next)
  return next
}

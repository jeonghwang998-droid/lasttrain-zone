// 계정과 사용자 설정 저장소
//
// TODO: 서버(Supabase Auth)가 붙기 전까지는 이 브라우저의 localStorage 에만 저장하는 임시 구현이다.
//       비밀번호는 저장하지 않고 형식만 검사한다. 실제 인증이 붙으면 이 파일만 교체하면 된다.

const SESSION_KEY = 'lz_session' // 로그인한 이메일
const PROFILES_KEY = 'lz_profiles' // { [email]: { email, nickname, home, createdAt } }
const PREFS_KEY = 'lz_prefs' // 이 기기의 설정 (로그인과 무관)

export const DEFAULT_PREFS = {
  buffer: 5, // 여유 시간(분)
  notify: { t30: true, t10: true, t0: true, room: true, arrived: true },
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

export function signup({ email, nickname }) {
  const profile = { email, nickname, home: 'ansan', createdAt: Date.now() }
  saveProfile(profile)
  write(SESSION_KEY, email)
  return profile
}

export function login(email) {
  const all = read(PROFILES_KEY, {})
  const profile = all[email] || { email, nickname: email.split('@')[0], home: 'ansan', createdAt: Date.now() }
  saveProfile(profile)
  write(SESSION_KEY, email)
  return profile
}

export function logout() {
  remove(SESSION_KEY)
}

export function updateUser(patch) {
  const user = getUser()
  if (!user) return null
  const next = { ...user, ...patch }
  saveProfile(next)
  return next
}

// 회원 탈퇴: 프로필, 세션, 이 기기의 설정을 모두 지운다
export function withdraw() {
  const user = getUser()
  if (user) {
    const all = read(PROFILES_KEY, {})
    delete all[user.email]
    write(PROFILES_KEY, all)
  }
  remove(SESSION_KEY)
  remove(PREFS_KEY)
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

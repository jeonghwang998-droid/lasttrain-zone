// html/dashboard.html 담당: 나 / 우리 테이블 / 내 걸음 화면
// 화면에 보이는 값은 전부 서버(Supabase)와 현재 시각에서 가져온다. 가짜 데이터는 없다

import { WD, RAIN_BINS } from './data.js'
import { S } from './state.js'
import { hhmm, fm, left, nowSec, secToDate } from './clock.js'
import { plansFor } from './planner.js'
import { fetchRoutes, TRANSIT_CONNECTED } from './transit.js'
import { initApp, url } from './app.js'
import { getPrefs, logout } from './account.js'
import { sessionUserId, loadConfig, loadProfile, saveBuffer, loadTrips, addTrip, deleteTrip } from './db.js'
import * as Rooms from './rooms.js'

initApp()

const $ = (id) => document.getElementById(id)

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/* ---------- 로그인 확인 ---------- */
const uid = await sessionUserId()
if (!uid) {
  await logout() // 이 기기에 남은 옛 로그인 흔적 정리
  location.replace(url('index.html'))
  await new Promise(() => {}) // 이동하는 동안 아래 코드가 돌지 않게 멈춘다
}

/* ---------- 상태 ---------- */
let cfg = {}
let profile = null
let trips = []
let plans = []
let rawPlans = []

let rooms = []
let roomId = null
let members = []
let unwatch = null

/* ---------- 알림 토스트 ---------- */
let toastTimer
function showToast(msg, ms = 7000) {
  $('toastText').textContent = msg
  $('toast').classList.add('show')
  try {
    navigator.vibrate && navigator.vibrate([200, 100, 200])
  } catch (e) {
    /* 진동 미지원 */
  }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), ms)
}

const MSG = {
  30: '30분 남았어요. 슬슬 정리할 타이밍이에요.',
  10: '10분 남았어요. 계산부터 하세요.',
  0: '지금 일어나야 막차 타요!',
}

/* ---------- 나 ---------- */
function renderMe() {
  plans = plansFor(S.routes, S.ai)
  rawPlans = plansFor(S.routes, false)

  $('bufferVal').textContent = `${S.buffer}분 일찍 일어나기`
  $('rainVal').textContent = S.rain === 0 ? '안 와요' : `시간당 ${S.rain}mm`

  $('routes').innerHTML =
    plans
      .map((p, i) => {
        const r = p.route
        let steps = ''
        let why = ''
        p.legs.forEach((x, k) => {
          const isLast = k === p.legs.length - 1
          const arrive = x.dep + x.leg.ride
          let sub = ''
          if (!isLast) {
            sub += `<span class="sub">${fm(arrive)} 도착 예정${x.late ? `, <span class="late">AI 예상 지연 최대 ${x.late}분</span>` : ''}, 환승 걸어서 ${x.leg.xfer}분</span>`
            if (x.raw !== null && x.raw !== x.dep) {
              why = `시간표상 ${fm(x.raw)} 열차도 있지만, 늦게 도착하면 다음 막차를 놓칠 수 있어 ${fm(x.dep)} 열차로 잡았어요.`
            }
          } else if (p.legs.length > 1) {
            sub = '<span class="sub">막차</span>'
          }
          steps += `<li style="--dot:${x.leg.c}">${fm(x.dep)} ${esc(x.leg.name)}${sub}</li>`
        })
        return (
          `<li id="r${i}"><div class="head"><span class="via">${esc(r.name)}${i === 0 ? '<span class="pick">가장 늦게 출발 가능</span>' : ''}</span><span class="st" id="rs${i}"></span></div>` +
          `<div class="meta">${esc(r.board)}까지 ${r.walkM}m, 걸어서 ${p.walk}분</div>` +
          `<ol class="legs">${steps}</ol>${why && S.ai ? `<p class="why">${why}</p>` : ''}</li>`
        )
      })
      .join('') ||
    `<li class="meta">${
      TRANSIT_CONNECTED
        ? '오늘 밤 탈 수 있는 경로가 없어요.'
        : '아직 막차 정보를 불러올 수 없어요. 교통 정보 연결이 끝나면 여기에 탈 수 있는 막차가 나와요.'
    }</li>`

  const d = $('diff')
  if (S.ai && plans[0] && rawPlans[0]) {
    const gap = Math.round((rawPlans[0].leave - plans[0].leave) / 60)
    d.hidden = false
    d.innerHTML =
      gap > 0
        ? `시간표만 보면 ${hhmm(rawPlans[0].leave)}에 일어나도 되지만, 오늘 밤 지연 위험을 반영해 <b>${gap}분 앞당겼어요.</b>`
        : 'AI 보정을 반영해도 시간표 기준과 같아요. 오늘 밤은 지연 위험이 낮아요.'
  } else {
    d.hidden = true
  }
  tick()
}

// 내 출발 시각을 내가 들어간 모임방에 알린다 (다른 멤버가 순서를 볼 수 있게)
let syncTimer
function syncLeave() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    const at = plans[0] ? secToDate(plans[0].leave) : null
    await Promise.all(rooms.map((r) => Rooms.setMyLeaveAt(r.id, uid, at).catch((e) => console.error(e))))
  }, 800)
}

/* ---------- 우리 테이블 ---------- */
const STATUS_TEXT = { staying: '모임 중', leaving: '출발했어요', arrived: '도착 완료' }

async function loadRooms(selectId) {
  try {
    rooms = await Rooms.myRooms()
  } catch (e) {
    $('groupErr').textContent = Rooms.roomError(e)
    rooms = []
  }
  const saved = sessionStorage.getItem('lz_room')
  const pick = [selectId, roomId, saved].find((id) => id && rooms.some((r) => r.id === id))
  roomId = pick || (rooms[0] ? rooms[0].id : null)
  if (roomId) sessionStorage.setItem('lz_room', roomId)

  if (unwatch) {
    unwatch()
    unwatch = null
  }
  if (roomId) unwatch = Rooms.watchRoom(roomId, refreshMembers)
  await refreshMembers()
  syncLeave()
}

async function refreshMembers() {
  const room = rooms.find((r) => r.id === roomId)
  if (room) {
    try {
      members = await Rooms.roomMembers(roomId)
    } catch (e) {
      $('roomErr').textContent = Rooms.roomError(e)
      members = []
    }
  } else {
    members = []
  }
  renderGroup()
}

function renderGroup() {
  const room = rooms.find((r) => r.id === roomId)
  $('group-empty').hidden = !!room
  $('group-room').hidden = !room
  if (!room) return

  const sel = $('roomSelect')
  sel.hidden = rooms.length < 2
  sel.innerHTML = rooms
    .map((r) => `<option value="${r.id}"${r.id === roomId ? ' selected' : ''}>${esc(r.place_label || '모임')} · ${r.code}</option>`)
    .join('')

  $('roomName').textContent = room.place_label || '모임'
  $('roomCode').textContent = `초대 코드 ${room.code}`

  // 출발 시각이 빠른 사람부터. 아직 계산 전인 사람은 뒤로
  const sorted = [...members].sort((a, b) => {
    if (a.leaveAt && b.leaveAt) return a.leaveAt - b.leaveAt
    if (a.leaveAt) return -1
    if (b.leaveAt) return 1
    return a.joinedAt - b.joinedAt
  })
  $('people').innerHTML = sorted
    .map((m, i) => {
      const mine = m.userId === uid
      const tags = `${mine ? ' (나)' : ''}${m.userId === room.host_id ? ' · 방장' : ''}`
      return (
        `<li><span class="rank">${i + 1}</span>` +
        `<div><div class="who">${esc(m.nickname)}${tags}</div><div class="home">${STATUS_TEXT[m.status] || ''}${m.leaveAt ? `, ${m.leaveAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}까지 출발` : ''}</div></div>` +
        `<span class="left" data-leave="${m.leaveAt ? m.leaveAt.getTime() : ''}"></span><span></span></li>`
      )
    })
    .join('')

  const me = members.find((m) => m.userId === uid)
  $('btnLeaving').disabled = !me || me.status === 'leaving' || me.status === 'arrived'
  $('btnArrived').disabled = !me || me.status === 'arrived'
  tick()
}

async function runRoomAction(fn, errEl) {
  errEl.textContent = ''
  try {
    await fn()
  } catch (e) {
    errEl.textContent = Rooms.roomError(e)
  }
}

$('roomSelect').addEventListener('change', (e) => loadRooms(e.target.value))

$('inviteBtn').addEventListener('click', async () => {
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return
  const r = await Rooms.shareInvite(room)
  if (r === 'copied') showToast('초대 링크를 복사했어요. 친구에게 붙여넣어 보내 주세요.', 4000)
  else if (r === 'failed') showToast(`링크를 복사하지 못했어요. 초대 코드 ${room.code}를 알려 주세요.`, 6000)
})

$('roomCode').addEventListener('click', async () => {
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return
  try {
    await navigator.clipboard.writeText(room.code)
    showToast('초대 코드를 복사했어요.', 3000)
  } catch (e) {
    showToast(`초대 코드: ${room.code}`, 6000)
  }
})

$('btnLeaving').addEventListener('click', () =>
  runRoomAction(async () => {
    await Rooms.setMyStatus(roomId, uid, 'leaving')
    await refreshMembers()
  }, $('roomErr')),
)
$('btnArrived').addEventListener('click', () =>
  runRoomAction(async () => {
    await Rooms.setMyStatus(roomId, uid, 'arrived')
    await refreshMembers()
  }, $('roomErr')),
)
$('btnLeave').addEventListener('click', () => {
  if (!confirm('이 모임에서 나갈까요?')) return
  runRoomAction(async () => {
    await Rooms.leaveRoom(roomId)
    roomId = null
    sessionStorage.removeItem('lz_room')
    await loadRooms()
  }, $('roomErr'))
})

$('create-form').addEventListener('submit', (e) => {
  e.preventDefault()
  runRoomAction(async () => {
    const res = await Rooms.createRoom($('placeInput').value.trim())
    $('placeInput').value = ''
    await loadRooms(res.room_id)
    showToast('모임을 만들었어요. 멤버를 초대해 보세요.', 4000)
  }, $('groupErr'))
})

$('codeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase()
  $('groupErr').textContent = ''
})
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const code = $('codeInput').value.trim()
  if (code.length !== 6) {
    $('groupErr').textContent = '초대 코드는 6자리예요.'
    return
  }
  runRoomAction(async () => {
    const id = await Rooms.joinRoom(code)
    $('codeInput').value = ''
    await loadRooms(id)
  }, $('groupErr'))
})

/* ---------- 내 걸음 ---------- */
function median(a) {
  const s = a.slice().sort((x, y) => x - y)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

function renderWalk() {
  const ok = trips.filter((t) => t.is_valid)
  const w = cfg['walk_speed.prior_weight']
  $('speed').innerHTML = `${Math.round(S.walkSpeed)}<small>m/분</small>`
  $('formula').textContent = ok.length
    ? `(평균 ${S.walkDefault} × ${w} + 내 기록 중앙값 ${median(ok.map((t) => t.speed)).toFixed(1)} × ${ok.length}) ÷ (${w} + ${ok.length})`
    : `기록이 없어서 전체 평균 ${S.walkDefault}m/분을 써요.`
  $('trips').innerHTML = trips
    .map(
      (t) =>
        `<li class="${t.is_valid ? '' : 'bad'}"><span>${t.distance_m}m, ${t.minutes}분 → ${t.speed.toFixed(1)}m/분${t.is_valid ? '' : '<span class="tag">제외</span>'}</span><button class="x" data-id="${t.id}" aria-label="기록 지우기">지우기</button></li>`,
    )
    .join('')
}

async function reloadWalk() {
  const [p, t] = await Promise.all([loadProfile(uid), loadTrips(cfg['walk_speed.recent_trips'])])
  profile = p
  trips = t
  S.walkSpeed = p.walk_speed
  renderWalk()
  rerender()
}

;[$('tdist'), $('tmin')].forEach((el) => el.addEventListener('input', () => { $('terr').textContent = '' }))
$('tadd').addEventListener('click', async () => {
  const d = Number($('tdist').value)
  const m = Number($('tmin').value)
  if (!(d > 0) || !(m > 0)) {
    $('terr').textContent = '거리(m)와 걸린 시간(분)을 둘 다 0보다 크게 입력하세요.'
    return
  }
  try {
    await addTrip(uid, Math.round(d), Math.round(m * 10) / 10)
    $('tdist').value = ''
    $('tmin').value = ''
    await reloadWalk()
  } catch (e) {
    console.error(e)
    $('terr').textContent = '기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
})
$('trips').addEventListener('click', async (e) => {
  const id = e.target.dataset && e.target.dataset.id
  if (!id) return
  try {
    await deleteTrip(id)
    await reloadWalk()
  } catch (err) {
    console.error(err)
    $('terr').textContent = '기록을 지우지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
})

/* ---------- 매 0.25초 갱신 ---------- */
function tick() {
  const now = nowSec()
  $('clock').textContent = hhmm(now)
  const b = plans[0]
  if (b) {
    const r = b.leave - now
    const level = r < 0 ? 'missed' : r <= 600 ? 'danger' : r <= 1800 ? 'warn' : 'calm'
    document.body.dataset.level = level
    if (r < 0) {
      $('heroLead').textContent = '막차 시간을 넘겼어요'
      $('heroTime').textContent = '택시나 심야버스를 찾아보세요'
      $('heroCount').textContent = `${hhmm(b.leave)}에 출발했어야 했어요`
    } else {
      $('heroLead').textContent = '이때 일어나면 막차 탑니다'
      $('heroTime').textContent = hhmm(b.leave)
      $('heroCount').textContent = `앞으로 ${left(r)}`
    }
    const pct = Math.max(0, Math.min(1, 1 - r / 3600)) * 100
    $('train').style.left = pct + '%'
    $('done').style.width = pct + '%'

    const key = [S.buffer, S.ai, S.wd, S.rain, b.leave].join('|')
    let hit
    ;[30, 10, 0].forEach((t) => {
      if (r <= t * 60 && r > -120 && !S.fired[key + t]) {
        S.fired[key + t] = 1
        hit = t
      }
    })
    if (hit !== undefined && getPrefs().notify['t' + hit]) showToast(MSG[hit])

    plans.forEach((p, i) => {
      const el = $('rs' + i)
      if (!el) return
      const rr = p.leave - now
      el.textContent = rr < 0 ? '놓침' : `${hhmm(p.leave)} 출발`
      $('r' + i).classList.toggle('gone', rr < 0)
    })
  } else {
    document.body.dataset.level = 'calm'
    $('heroLead').textContent = TRANSIT_CONNECTED ? '탈 수 있는 막차가 없어요' : '막차 정보를 불러올 수 없어요'
    $('heroTime').textContent = '--:--'
    $('heroCount').textContent = TRANSIT_CONNECTED ? '' : '교통 정보 연결 후 출발 시각이 계산돼요'
  }

  document.querySelectorAll('.people .left').forEach((el) => {
    const t = el.dataset.leave
    el.textContent = t ? left((Number(t) - Date.now()) / 1000) : '계산 전'
  })
}

function rerender() {
  renderMe()
  syncLeave()
}

function setView(v) {
  ;['me', 'group', 'walk'].forEach((n) => {
    $('view-' + n).hidden = n !== v
    $('tab-' + n).setAttribute('aria-pressed', n === v)
  })
  if (v === 'group') refreshMembers()
}

/* ---------- 초기화와 이벤트 ---------- */
async function init() {
  try {
    cfg = await loadConfig([
      'buffer_min.range',
      'walk_speed.default',
      'walk_speed.prior_weight',
      'walk_speed.recent_trips',
    ])
    profile = await loadProfile(uid)
    trips = await loadTrips(cfg['walk_speed.recent_trips'])
  } catch (e) {
    console.error(e)
    // 프로필이 없다 = 서버에서 계정이 지워진 것. 로그인 기록을 정리하고 처음 화면으로
    if (e && e.code === 'PGRST116') {
      await logout()
      location.replace(url('index.html'))
      return
    }
    showToast('내 정보를 불러오지 못했어요. 새로고침해 주세요.', 8000)
    return
  }

  S.buffer = profile.buffer_min
  S.walkSpeed = profile.walk_speed
  S.walkDefault = cfg['walk_speed.default']

  $('authArea').innerHTML = `<a href="${url('html/profile.html')}" class="avatar" aria-label="내 정보">${esc((profile.nickname || '?').slice(0, 1))}</a>`
  $('todayWd').textContent = WD[S.wd]
  $('rain').max = RAIN_BINS[RAIN_BINS.length - 1]
  $('rain').value = S.rain
  $('buffer').min = cfg['buffer_min.range'].min
  $('buffer').max = cfg['buffer_min.range'].max
  $('buffer').value = S.buffer

  try {
    S.routes = await fetchRoutes()
  } catch (e) {
    console.error(e)
    S.routes = []
  }

  renderWalk()
  renderMe()
  await loadRooms(new URLSearchParams(location.search).get('room'))
  if (new URLSearchParams(location.search).get('view') === 'group') setView('group')
}

$('rain').addEventListener('input', (e) => { S.rain = Number(e.target.value); rerender() })
let bufferTimer
$('buffer').addEventListener('input', (e) => {
  S.buffer = Number(e.target.value)
  rerender()
  clearTimeout(bufferTimer)
  bufferTimer = setTimeout(() => saveBuffer(uid, S.buffer).catch((err) => console.error(err)), 600)
})
$('ai').addEventListener('click', (e) => {
  S.ai = !S.ai
  e.currentTarget.setAttribute('aria-pressed', S.ai)
  rerender()
})

$('tab-me').addEventListener('click', () => setView('me'))
$('tab-group').addEventListener('click', () => setView('group'))
$('tab-walk').addEventListener('click', () => setView('walk'))
$('toastClose').addEventListener('click', () => $('toast').classList.remove('show'))

await init()
setInterval(tick, 250)
// 실시간 연결이 끊겨도 멤버 목록이 늦지 않게 가끔 다시 불러온다
setInterval(() => {
  if (!$('view-group').hidden && roomId) refreshMembers()
}, 20000)

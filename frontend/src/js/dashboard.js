// html/dashboard.html 담당: 나 / 우리 테이블 / 내 걸음 화면
// 화면에 보이는 값은 전부 서버(Supabase)와 현재 시각에서 가져온다. 가짜 데이터는 없다

import { WD, RAIN_BINS } from './data.js'
import { S } from './state.js'
import { hhmm, left, nowSec } from './clock.js'
import { plansFor } from './planner.js'
import { fetchRoutes, TRANSIT_CONNECTED } from './transit.js'
import { routeCardsHtml, routesEmptyHtml, lastBoxHtml, restText } from './routeview.js'
import { searchPlaces, PLACES_CONNECTED } from './places.js'
import { initApp, url } from './app.js'
import { getPrefs, logout } from './account.js'
import { sessionUserId, loadConfig, loadProfile, saveBuffer, loadTrips, addTrip, deleteTrip } from './db.js'
import * as Rooms from './rooms.js'
import * as MyRoutes from './myroutes.js'
import * as Subway from './subway.js'

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

  $('routes').innerHTML = plans.length ? routeCardsHtml(plans, S.trip, S.ai) : routesEmptyHtml(S.trip, TRANSIT_CONNECTED)

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

/* ---------- 경로 등록: 어디에서 어디까지 ---------- */
// 등록한 경로는 계정(Supabase user_routes)에 저장된다. 고른 경로의 막차가 아래에 나온다
const ROUTE_PICK_KEY = `lz_route:${uid}` // 마지막으로 고른 경로 (이 기기의 편의용)
const picked = { from: null, to: null } // 자동완성에서 고른 장소(좌표 포함)
let savedRoutes = []
let routeId = null
let formOpen = false // 등록/수정 입력창을 열어 둔 상태
let editingId = null

const selectedRoute = () => savedRoutes.find((r) => r.id === routeId)

function rememberPick() {
  try {
    if (routeId) localStorage.setItem(ROUTE_PICK_KEY, routeId)
    else localStorage.removeItem(ROUTE_PICK_KEY)
  } catch (e) {
    /* 저장소를 못 쓰면 이번 방문에서만 유지 */
  }
}

function recallPick() {
  try {
    return localStorage.getItem(ROUTE_PICK_KEY)
  } catch (e) {
    return null
  }
}

// 입력창에 적힌 글자와 같은 이름의 선택 장소가 있으면 좌표까지, 아니면 글자만
const placeOf = (name, p) => (p && p.name === name ? p : { name })

async function loadMyRoutes() {
  try {
    savedRoutes = await MyRoutes.listRoutes()
  } catch (e) {
    savedRoutes = []
    $('tripErr').textContent = MyRoutes.routeError(e)
  }
  if (!selectedRoute()) routeId = (savedRoutes.find((r) => r.id === recallPick()) || savedRoutes[0] || {}).id || null
  S.trip = selectedRoute() ? MyRoutes.toTrip(selectedRoute()) : null
  rememberPick()
}

function renderTrip() {
  const has = savedRoutes.length > 0
  const asking = !has || formOpen
  $('route-list-panel').hidden = !has
  $('trip-ask').hidden = !asking
  $('trip-result').hidden = !S.trip
  $('tripTitle').textContent = editingId ? '경로를 수정해요' : has ? '새 경로를 등록해요' : '어디에서 어디까지 갈까요?'
  $('tripSubmit').textContent = editingId ? '수정하기' : '등록하기'
  $('tripCancel').hidden = !has
  if (asking) prepareStationPicker()

  $('myRoutes').innerHTML = savedRoutes
    .map(
      (r) =>
        `<li class="my-route${r.id === routeId ? ' on' : ''}">` +
        `<button type="button" class="route-pick" data-id="${r.id}" aria-pressed="${r.id === routeId}">` +
        `${r.label ? `<span class="rl">${esc(r.label)}</span>` : ''}` +
        `<span class="rp"><span>${esc(r.from_name)}</span><i>→</i><span>${esc(r.to_name)}</span></span></button>` +
        `<button type="button" class="x route-edit" data-id="${r.id}">수정</button>` +
        `<button type="button" class="x route-del" data-id="${r.id}">삭제</button></li>`,
    )
    .join('')
}

async function loadRoutes() {
  if (!S.trip) {
    S.routes = []
    return
  }
  try {
    S.routes = await fetchRoutes(S.trip)
  } catch (e) {
    console.error(e)
    S.routes = []
    showToast('경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 6000)
  }
}

// 입력창을 열고 값을 채운다 (route 가 없으면 빈 입력창 = 새로 등록)
function openForm(route) {
  formOpen = true
  editingId = route ? route.id : null
  $('fromInput').value = route ? route.from_name : ''
  $('toInput').value = route ? route.to_name : ''
  $('labelInput').value = route ? route.label : ''
  const trip = route ? MyRoutes.toTrip(route) : null
  picked.from = trip && trip.from.lat != null ? trip.from : null
  picked.to = trip && trip.to.lat != null ? trip.to : null
  $('tripErr').textContent = ''
  resetStationPicker()
  renderTrip()
  $('fromInput').focus()
}

function closeForm() {
  formOpen = false
  editingId = null
  renderTrip()
}

// 고른 경로가 바뀌었을 때: 막차를 다시 가져와 그린다
async function showSelected() {
  S.trip = selectedRoute() ? MyRoutes.toTrip(selectedRoute()) : null
  rememberPick()
  renderTrip()
  renderLast()
  await loadRoutes()
  rerender()
}

// 장소 자동완성 (카카오 키가 있을 때만). 고른 장소는 picked 에 좌표까지 담긴다
function wireSuggest(which) {
  const input = $(which + 'Input')
  const list = $(which + 'Suggest')
  let timer
  let seq = 0
  let found = []
  const hide = () => {
    list.hidden = true
    list.innerHTML = ''
  }
  input.addEventListener('input', () => {
    picked[which] = null
    $('tripErr').textContent = ''
    clearTimeout(timer)
    const q = input.value.trim()
    if (!PLACES_CONNECTED || !q) return hide()
    const mine = ++seq
    timer = setTimeout(async () => {
      const res = await searchPlaces(q)
      if (mine !== seq) return // 더 새로운 검색이 있다
      found = res
      if (!found.length) return hide()
      list.innerHTML = found
        .map((p, i) => `<li><button type="button" data-i="${i}"><span class="nm">${esc(p.name)}</span><span class="ad">${esc(p.address)}</span></button></li>`)
        .join('')
      list.hidden = false
    }, 250)
  })
  list.addEventListener('mousedown', (e) => e.preventDefault()) // 입력창이 포커스를 잃지 않게
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) return
    const p = found[Number(btn.dataset.i)]
    input.value = p.name
    picked[which] = p
    hide()
  })
  input.addEventListener('blur', () => setTimeout(hide, 150))
}
wireSuggest('from')
wireSuggest('to')

/* ---------- 지하철역으로 고르기: 공공데이터 노선과 역 ---------- */
// 노선 → 역을 고르면 출발/도착 입력칸이 채워지고, 그 역의 행(종착역)별 막차가 바로 나온다
let subwayLines = null
let pickerLoading = false
let spTarget = 'from'
let spSeq = 0
let lastSeq = 0

function setSpTarget(t) {
  spTarget = t
  $('spFrom').setAttribute('aria-pressed', t === 'from')
  $('spTo').setAttribute('aria-pressed', t === 'to')
}

async function prepareStationPicker() {
  if (subwayLines || pickerLoading) return
  pickerLoading = true
  $('spMsg').textContent = '노선 정보를 불러오는 중이에요…'
  $('spRetry').hidden = true
  try {
    subwayLines = await Subway.loadLines()
    $('spMsg').textContent = ''
    $('spLine').innerHTML =
      '<option value="">노선 선택</option>' + subwayLines.map((l, i) => `<option value="${i}">${esc(l.name)}</option>`).join('')
  } catch (e) {
    $('spMsg').textContent = e.message
    $('spRetry').hidden = false
  } finally {
    pickerLoading = false
  }
}

function resetStationPicker() {
  setSpTarget('from')
  $('spLine').value = ''
  $('spStation').innerHTML = '<option value="">역 선택</option>'
  $('spStation').disabled = true
  $('spInfo').hidden = true
  spSeq++
}

// 막차 정보를 box 안에 그린다 (label: 역 이름 표시, seqGet: 더 새로운 요청이 있으면 버리기 위한 확인)
async function fillLastTrains(box, label, stationId, isCurrent) {
  box.hidden = false
  box.innerHTML = '<p class="sp-load">막차를 확인하는 중이에요…</p>'
  try {
    const data = await Subway.loadLastTrains(stationId)
    if (!isCurrent()) return
    box.innerHTML = lastBoxHtml(label, data)
    tick()
  } catch (e) {
    if (!isCurrent()) return
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`
  }
}

$('spFrom').addEventListener('click', () => setSpTarget('from'))
$('spTo').addEventListener('click', () => setSpTarget('to'))
$('spRetry').addEventListener('click', () => {
  subwayLines = null
  prepareStationPicker()
})

$('spLine').addEventListener('change', () => {
  const line = subwayLines && subwayLines[Number($('spLine').value)]
  $('spInfo').hidden = true
  $('spStation').innerHTML =
    '<option value="">역 선택</option>' + (line ? line.stations.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('') : '')
  $('spStation').disabled = !line
})

$('spStation').addEventListener('change', () => {
  const line = subwayLines && subwayLines[Number($('spLine').value)]
  const station = line && line.stations[Number($('spStation').value)]
  if (!station) return
  const label = Subway.stationLabel(station, line)
  const place = { name: label, stationId: station.id, line: line.name }
  const target = spTarget
  $(target + 'Input').value = label
  picked[target] = place
  $('tripErr').textContent = ''
  const mine = ++spSeq
  fillLastTrains($('spInfo'), label, station.id, () => mine === spSeq)
  // 출발을 골랐고 도착이 비어 있으면 이어서 도착을 고르게 한다
  if (target === 'from' && !$('toInput').value.trim()) setSpTarget('to')
})

// 고른 경로의 출발역 막차 (역으로 등록한 경로만)
async function renderLast() {
  const from = S.trip && S.trip.from
  const mine = ++lastSeq
  if (!from || !from.stationId) {
    $('lastPanel').hidden = true
    return
  }
  $('lastPanel').hidden = false
  fillLastTrains($('lastBody'), from.name, from.stationId, () => mine === lastSeq)
}

$('swapBtn').addEventListener('click', () => {
  const [f, t] = [$('fromInput').value, $('toInput').value]
  $('fromInput').value = t
  $('toInput').value = f
  ;[picked.from, picked.to] = [picked.to, picked.from]
})

// 등록하기 (수정 중이면 수정하기)
$('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fromName = $('fromInput').value.trim()
  const toName = $('toInput').value.trim()
  if (!fromName || !toName) {
    $('tripErr').textContent = '출발지와 도착지를 모두 입력해 주세요.'
    return
  }
  if (fromName === toName) {
    $('tripErr').textContent = '출발지와 도착지가 같아요.'
    return
  }
  const route = {
    label: $('labelInput').value.trim(),
    from: placeOf(fromName, picked.from),
    to: placeOf(toName, picked.to),
  }
  const wasEditing = Boolean(editingId)
  const btn = $('tripSubmit')
  btn.disabled = true
  try {
    const row = wasEditing ? await MyRoutes.editRoute(editingId, route) : await MyRoutes.addRoute(uid, route)
    await loadMyRoutes()
    routeId = row.id
    formOpen = false
    editingId = null
    $('tripErr').textContent = ''
    await showSelected()
    showToast(wasEditing ? '경로를 수정했어요.' : '경로를 등록했어요.', 3000)
  } catch (err) {
    $('tripErr').textContent = MyRoutes.routeError(err)
  } finally {
    btn.disabled = false
  }
})

$('routeAdd').addEventListener('click', () => openForm(null))
$('tripCancel').addEventListener('click', closeForm)

// 목록: 고르기 / 수정 / 삭제
$('myRoutes').addEventListener('click', async (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  const id = btn.dataset.id
  if (btn.classList.contains('route-pick')) {
    if (id === routeId && !formOpen) return
    routeId = id
    formOpen = false
    editingId = null
    await showSelected()
  } else if (btn.classList.contains('route-edit')) {
    openForm(savedRoutes.find((r) => r.id === id))
  } else if (btn.classList.contains('route-del')) {
    if (!confirm('이 경로를 지울까요?')) return
    try {
      await MyRoutes.removeRoute(id)
    } catch (err) {
      showToast(MyRoutes.routeError(err), 5000)
      return
    }
    if (editingId === id) {
      formOpen = false
      editingId = null
    }
    if (routeId === id) routeId = null
    await loadMyRoutes()
    await showSelected()
  }
})

/* ---------- 우리 테이블 ---------- */
// 화면은 두 가지: 모임 목록(코드 생성/공유, 새 모임, 코드 입장)과 모임 안(막차 입력, 멤버들의 막차)
const MODE_ICON = { subway: '🚇', bus: '🚌' }
const MODE_TEXT = { subway: '지하철', bus: '버스' }
// 새벽 4시 전 시각은 전날 밤 다음에 오는 시각으로 보고 정렬한다
const NIGHT_WRAPS_BEFORE_HOUR = 4

let inRoom = false
let lastTrains = []
let ltMode = 'subway'
let generated = null // 방금 코드를 만든 모임 { code, place_label }

const currentRoom = () => rooms.find((r) => r.id === roomId)

function minutesForSort(hhmmText) {
  const [h, m] = hhmmText.split(':').map(Number)
  return (h < NIGHT_WRAPS_BEFORE_HOUR ? h + 24 : h) * 60 + m
}

async function loadRooms() {
  try {
    rooms = await Rooms.myRooms()
  } catch (e) {
    $('groupErr').textContent = Rooms.roomError(e)
    rooms = []
  }
  if (inRoom && !currentRoom()) closeRoom() // 나갔거나 만료된 모임
  renderChannels()
}

function renderChannels() {
  $('channel-panel').hidden = rooms.length === 0
  $('channels').innerHTML = rooms
    .map(
      (r) =>
        `<li><button type="button" class="channel" data-id="${r.id}"><span class="name">${esc(r.place_label || '이름 없는 모임')}</span><span class="code">${esc(r.code)}</span></button></li>`,
    )
    .join('')
}

function showRoomView() {
  $('group-list').hidden = inRoom
  $('group-room').hidden = !inRoom
}

async function enterRoom(id) {
  if (unwatch) unwatch()
  roomId = id
  inRoom = true
  showRoomView()
  unwatch = Rooms.watchRoom(id, () => refreshRoom())
  $('roomErr').textContent = ''
  await refreshRoom(true)
}

function closeRoom() {
  if (unwatch) unwatch()
  unwatch = null
  roomId = null
  inRoom = false
  members = []
  lastTrains = []
  showRoomView()
}

// fillForm: 모임에 막 들어왔을 때만 내가 저장해 둔 값을 입력칸에 채운다 (입력 중인 글을 덮지 않으려고)
async function refreshRoom(fillForm = false) {
  if (!inRoom) return
  const id = roomId
  let m = []
  let t = []
  let err = ''
  try {
    m = await Rooms.roomMembers(id)
  } catch (e) {
    err = Rooms.roomError(e)
  }
  try {
    t = await Rooms.roomLastTrains(id)
  } catch (e) {
    err = err || Rooms.roomError(e)
  }
  if (!inRoom || roomId !== id) return // 기다리는 사이 다른 화면으로 옮겼다
  members = m
  lastTrains = t
  if (err) $('roomErr').textContent = err
  renderRoom(fillForm)
}

function setMode(mode) {
  ltMode = mode
  Object.keys(MODE_TEXT).forEach((k) => $('mode-' + k).setAttribute('aria-pressed', k === mode))
}

function renderRoom(fillForm) {
  const room = currentRoom()
  if (!room) return
  $('roomName').textContent = room.place_label || '이름 없는 모임'

  const mine = lastTrains.find((t) => t.userId === uid)
  if (fillForm) {
    setMode(mine ? mine.mode : 'subway')
    $('ltLabel').value = mine ? mine.label : ''
    $('ltTime').value = mine ? mine.time : ''
  }
  $('ltClear').hidden = !mine

  const byUser = new Map(lastTrains.map((t) => [t.userId, t]))
  const sorted = [...members].sort((a, b) => {
    const ta = byUser.get(a.userId)
    const tb = byUser.get(b.userId)
    if (ta && tb) return minutesForSort(ta.time) - minutesForSort(tb.time)
    if (ta) return -1
    if (tb) return 1
    return a.joinedAt - b.joinedAt
  })
  $('people').innerHTML = sorted
    .map((m) => {
      const t = byUser.get(m.userId)
      const tags = `${m.userId === uid ? ' (나)' : ''}${m.userId === room.host_id ? ' · 방장' : ''}`
      const detail = t ? `${MODE_TEXT[t.mode] || ''}${t.label ? ' · ' + esc(t.label) : ''}` : '아직 입력하지 않았어요'
      return (
        `<li><span class="mode">${t ? MODE_ICON[t.mode] || '' : '·'}</span>` +
        `<div><div class="who">${esc(m.nickname)}${tags}</div><div class="home">${detail}</div></div>` +
        `<span class="when">${t ? esc(t.time) : ''}</span><span></span></li>`
      )
    })
    .join('')
}

function renderGenerated() {
  $('genResult').hidden = !generated
  $('genCode').textContent = generated ? generated.code : ''
  $('shareBtn').disabled = !generated
}

async function runRoomAction(fn, errEl) {
  errEl.textContent = ''
  try {
    await fn()
  } catch (e) {
    errEl.textContent = Rooms.roomError(e)
  }
}

async function shareRoom(room) {
  const r = await Rooms.shareInvite(room)
  if (r === 'copied') showToast('초대 링크를 복사했어요. 친구에게 붙여넣어 보내 주세요.', 4000)
  else if (r === 'failed') showToast(`링크를 복사하지 못했어요. 초대 코드 ${room.code}를 알려 주세요.`, 6000)
}

// 모임 목록에서 하나를 고르면 그 모임 안으로
$('channels').addEventListener('click', (e) => {
  const btn = e.target.closest('.channel')
  if (btn) enterRoom(btn.dataset.id)
})
$('btnBack').addEventListener('click', () => {
  closeRoom()
  loadRooms()
})

// 새 모임 만들기: 이름을 받아 모임을 만들고 초대 코드를 바로 보여 준다
$('create-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('placeInput').value.trim()
  if (!name) {
    $('genErr').textContent = '모임 이름을 입력해 주세요.'
    return
  }
  runRoomAction(async () => {
    const res = await Rooms.createRoom(name)
    generated = { code: res.code, place_label: name }
    $('placeInput').value = ''
    renderGenerated()
    await loadRooms()
  }, $('genErr'))
})
$('placeInput').addEventListener('input', () => { $('genErr').textContent = '' })

// 코드 공유하기: 방금 만든 코드의 초대 링크를 공유하거나 복사한다
$('shareBtn').addEventListener('click', () => {
  if (generated) shareRoom(generated)
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
    await loadRooms()
    await enterRoom(id)
  }, $('groupErr'))
})

/* 모임 안 */
$('mode-subway').addEventListener('click', () => setMode('subway'))
$('mode-bus').addEventListener('click', () => setMode('bus'))
$('lt-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const time = $('ltTime').value
  if (!time) {
    $('roomErr').textContent = '막차 시각을 입력해 주세요.'
    return
  }
  runRoomAction(async () => {
    await Rooms.saveLastTrain(roomId, uid, { mode: ltMode, label: $('ltLabel').value.trim(), time })
    await refreshRoom()
    showToast('막차를 저장했어요.', 3000)
  }, $('roomErr'))
})
$('ltClear').addEventListener('click', () =>
  runRoomAction(async () => {
    await Rooms.clearLastTrain(roomId, uid)
    $('ltTime').value = ''
    $('ltLabel').value = ''
    await refreshRoom()
  }, $('roomErr')),
)
$('btnLeave').addEventListener('click', () => {
  if (!confirm('이 모임에서 나갈까요?')) return
  runRoomAction(async () => {
    await Rooms.leaveRoom(roomId)
    closeRoom()
    await loadRooms()
  }, $('roomErr'))
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
  updateLastRest(now)
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

}

function updateLastRest(now) {
  document.querySelectorAll('.lt-rest').forEach((el) => {
    el.textContent = restText(Number(el.dataset.min), now / 60)
  })
}

function rerender() {
  renderMe()
}

function setView(v) {
  ;['me', 'group', 'walk'].forEach((n) => {
    $('view-' + n).hidden = n !== v
    $('tab-' + n).setAttribute('aria-pressed', n === v)
  })
  try {
    sessionStorage.setItem('lz_tab', v)
  } catch (e) {
    /* 무시 */
  }
  if (v === 'group' && inRoom) refreshRoom()
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

  await loadMyRoutes()
  renderTrip()
  renderLast()
  await loadRoutes()

  renderWalk()
  renderMe()
  await loadRooms()
  const params = new URLSearchParams(location.search)
  const wanted = params.get('room')
  if (wanted && rooms.some((r) => r.id === wanted)) await enterRoom(wanted)
  let savedTab = null
  try {
    savedTab = sessionStorage.getItem('lz_tab')
  } catch (e) {
    /* 무시 */
  }
  const tab = params.get('view') || savedTab
  if (tab === 'group' || tab === 'walk') setView(tab)
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
// 실시간 연결이 끊겨도 모임 안의 멤버와 막차가 늦지 않게 가끔 다시 불러온다
setInterval(() => {
  if (!$('view-group').hidden && inRoom) refreshRoom()
}, 20000)

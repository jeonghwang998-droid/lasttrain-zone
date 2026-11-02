// html/dashboard.html 담당: 나 / 우리 테이블 / 내 걸음 화면
// 화면에 보이는 값은 전부 서버(Supabase)와 현재 시각에서 가져온다. 가짜 데이터는 없다

import { WD, RAIN_BINS } from './data.js'
import { S } from './state.js'
import { hhmm, left, nowSec } from './clock.js'
import { plansFor } from './planner.js'
import { fetchRoutes, routesNote, TRANSIT_CONNECTED } from './transit.js'
import { routeCardsHtml, routesEmptyHtml, lastBoxHtml, restText } from './routeview.js'
import * as Kakao from './kakao.js'
import * as Home from './home.js'
import { permissionState, onPermissionChange, getPosition } from './geo.js'
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
  $('xferVal').textContent = S.xferBuffer ? `환승마다 ${S.xferBuffer}분 여유를 둬요` : '여유 없이 딱 맞는 열차까지 써요'
  $('xferNote').textContent = S.xferBuffer ? `환승마다 ${S.xferBuffer}분 여유를 두고 계산했어요.` : ''
  $('rainVal').textContent = S.rain === 0 ? '안 와요' : `시간당 ${S.rain}mm`

  // 가장 늦게 출발할 수 있는 경로가 추천, 나머지는 늦게 출발할 수 있는 순서로 다른 경로
  $('routes').innerHTML = plans.length ? routeCardsHtml(plans.slice(0, 1), S.trip, S.ai, 0) : routesEmptyHtml(S.trip, TRANSIT_CONNECTED, routesNote())
  const alts = plans.slice(1)
  $('altPanel').hidden = alts.length === 0
  $('alts').innerHTML = routeCardsHtml(alts, S.trip, S.ai, 1, true)

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

/* ---------- 나: 집 → 막차 알람 목록 → 경로 상세 ---------- */
// 집(도착지)을 한 번 정해 두면, 술자리가 생길 때 출발할 역만 골라 "출발역 → 우리집" 알람을 등록한다.
// 등록한 경로는 계정(Supabase user_routes)에, 집은 my_home 에 저장된다. 위치는 서버에 저장하지 않는다
const HOME_NAME = '우리집' // 도착지가 집인 경로에 보이는 이름
const NEARBY_RADIUS_M = 1500 // 내 위치 근처 역을 찾는 반경
const NEARBY_LIMIT = 8
const HOME_STATION_RADIUS_M = 2000 // 집 근처 역을 찾는 반경
const HOME_STATION_LIMIT = 10
const ROUTE_PICK_KEY = `lz_route:${uid}` // 마지막으로 고른 경로 (이 기기의 편의용)
const XFER_BUFFER_KEY = 'lz_xfer_buffer' // 환승 여유 설정 (이 기기의 편의용)
const DEFAULT_XFER_BUFFER_MIN = 0 // 설정한 적이 없을 때 환승마다 두는 여유(분). 기본은 실제 막차를 그대로 보여 준다

const picked = { from: null, to: null } // 자동완성/근처 역에서 고른 장소(좌표, 역 정보 포함)
let home = null // { name, address, lat, lng, station: { id, label, line } | null }
let editingHome = false
let savedRoutes = []
let routeId = null
let screen = 'list' // 'list' | 'detail'
let formOpen = false // 등록/수정 입력창을 열어 둔 상태
let editingId = null
let toMode = 'home' // 등록 폼의 도착지: 'home'(우리집) | 'other'
let myPos = null // { lat, lng } 현재 위치. 이 기기 안에서만 쓴다
let geoState = 'prompt' // 'granted' | 'prompt' | 'denied' | 'unsupported'
let geoError = ''
let mapHandle = null

const selectedRoute = () => savedRoutes.find((r) => r.id === routeId)
const tripOf = (route) => (route ? MyRoutes.toTrip(route, home) : null)
const destName = (r) => (r.to_home ? HOME_NAME : r.to_name)
const routeTitle = (r) => r.label || `${r.from_name} → ${destName(r)}`

function remember(key, value) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch (e) {
    /* 저장소를 못 쓰면 이번 방문에서만 유지 */
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    return null
  }
}

const distanceText = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)

// 입력창에 적힌 글자와 같은 이름의 선택 장소가 있으면 좌표까지, 아니면 글자만
const placeOf = (name, p) => (p && p.name === name ? p : { name })

/* ----- 화면 전환 ----- */
function renderMeScreen() {
  const needHome = !home || editingHome
  $('home-setup').hidden = !needHome
  $('me-list').hidden = needHome || screen === 'detail'
  $('me-detail').hidden = needHome || screen !== 'detail' || !S.trip
  renderLocCard()
  if (needHome) renderHomeSetup()
  else if (!$('me-list').hidden) renderList()
  remember('lz_screen:' + uid, screen === 'detail' && routeId ? routeId : '')
}

/* ----- 위치 기반 서비스 ----- */
function renderLocCard() {
  const show = Boolean(home) && !editingHome && geoState !== 'granted'
  $('loc-card').hidden = !show
  if (!show) return
  const text = {
    prompt: ['위치 기반 서비스를 켜 주세요', '지금 있는 곳 근처의 지하철역을 찾고, 지도에 내 위치를 보여 드려요.', '위치 켜기'],
    denied: ['위치 권한이 꺼져 있어요', '주소창 왼쪽 자물쇠에서 위치를 허용으로 바꾼 뒤 다시 눌러 주세요.', '다시 확인'],
    unsupported: ['이 기기는 위치 기능을 지원하지 않아요', '근처 역은 직접 검색하거나 노선에서 골라 주세요.', ''],
  }[geoState]
  $('locTitle').textContent = text[0]
  $('locMsg').textContent = geoError || text[1]
  $('locEnable').textContent = text[2]
  $('locEnable').hidden = !text[2]
}

// 위치가 바뀌거나 처음 알게 됐을 때 위치를 쓰는 화면을 다시 그린다
function onPositionChanged() {
  renderLocCard()
  if (!$('trip-ask').hidden) renderNearby()
  if (screen === 'detail' && S.trip) drawRouteMap()
}

async function enableLocation() {
  $('locEnable').disabled = true
  try {
    myPos = await getPosition()
    geoState = 'granted'
    geoError = ''
  } catch (e) {
    geoState = await permissionState()
    geoError = e.message
  } finally {
    $('locEnable').disabled = false
  }
  onPositionChanged()
}

async function initGeo() {
  geoState = await permissionState()
  if (geoState === 'granted') {
    try {
      myPos = await getPosition()
    } catch (e) {
      geoError = e.message
    }
  }
  onPositionChanged() // 처음 알게 된 권한과 위치로 안내 카드, 근처 역, 지도를 다시 그린다
  onPermissionChange(async (state) => {
    geoState = state
    geoError = ''
    if (state === 'granted') {
      try {
        myPos = await getPosition()
      } catch (e) {
        geoError = e.message
      }
    }
    onPositionChanged()
  })
}

$('locEnable').addEventListener('click', enableLocation)

/* ----- 노선/역 목록 (공공데이터): 근처 역 맞추기와 직접 고르기에 쓴다 ----- */
let subwayLines = null
let linesReady = null
let spTarget = 'from'
let spSeq = 0
let lastSeq = 0

const lineOptions = () =>
  '<option value="">노선 선택</option>' + subwayLines.map((l, i) => `<option value="${i}">${esc(l.name)}</option>`).join('')

function prepareStationPicker() {
  if (!linesReady) {
    linesReady = (async () => {
      $('spMsg').textContent = '노선 정보를 불러오는 중이에요…'
      $('spRetry').hidden = true
      try {
        subwayLines = await Subway.loadLines()
        $('spMsg').textContent = ''
        $('spLine').innerHTML = lineOptions()
        $('homeLine').innerHTML = lineOptions()
      } catch (e) {
        $('spMsg').textContent = e.message
        $('spRetry').hidden = false
        linesReady = null // 다시 시도할 수 있게
      }
    })()
  }
  return linesReady
}

// 노선을 고르면 그 노선의 역을 역 선택칸에 채운다
function fillStationSelect(lineSel, stationSel) {
  const line = subwayLines && subwayLines[Number(lineSel.value)]
  stationSel.innerHTML =
    '<option value="">역 선택</option>' + (line ? line.stations.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('') : '')
  stationSel.disabled = !line
  return line
}

// 막차 정보를 box 안에 그린다 (isCurrent: 더 새로운 요청이 있으면 이 결과는 버린다)
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

// 지도에 찍으려면 좌표가 필요하다. 노선에서 고른 역은 좌표가 없어서 카카오에서 찾아 채운다 (못 찾아도 괜찮다)
async function ensureStationCoords(place) {
  if (!place || place.lat != null || !place.stationId || !Kakao.KAKAO_CONNECTED || !subwayLines) return
  const baseName = place.name.replace(/\s*\(.*\)\s*$/, '')
  const found = await Kakao.searchPlaces(baseName, 6, true)
  const hit =
    found.find((p) => {
      const k = Subway.kakaoStation(p)
      const m = k && Subway.matchStation(subwayLines, k)
      return m && m.id === place.stationId
    }) || found[0]
  if (hit) {
    place.lat = hit.lat
    place.lng = hit.lng
  }
}

// 카카오 검색 결과가 지하철역이고 공공데이터 역과 맞으면 역 정보까지 담아 돌려준다
function placeFromSuggestion(p) {
  const k = subwayLines && Subway.kakaoStation(p)
  const m = k && Subway.matchStation(subwayLines, k)
  return m ? { name: m.label, stationId: m.id, line: m.line, lat: p.lat, lng: p.lng } : p
}

/* ----- ① 집 설정 ----- */
let homeDraft = null // 검색/현재 위치로 고른 집 { name, address, lat, lng }
let homeStationPick = null // 집 근처 역으로 고른 { id, label, line }
let homeNearby = [] // [{ n: 카카오 역, m: 공공데이터 역 }]
let homeFound = []

function resetHomeSetup() {
  homeDraft = null
  homeStationPick = null
  homeNearby = []
  homeFound = []
  $('homeInput').value = ''
  $('homeResults').hidden = true
  $('homeResults').innerHTML = ''
  $('homeStep2').hidden = true
  $('homeStations').innerHTML = ''
  $('homeMsg').textContent = ''
  $('homeSave').disabled = true
  $('homeErr').textContent = ''
  $('homeLine').value = ''
  $('homeStation').innerHTML = '<option value="">역 선택</option>'
  $('homeStation').disabled = true
}

function renderHomeSetup() {
  $('homeTitle').textContent = home ? '집을 바꿔요' : '집이 어디예요?'
  $('homeCancel').hidden = !home
  prepareStationPicker()
}

async function pickHomePlace(p) {
  homeDraft = { name: p.name, address: p.address, lat: p.lat, lng: p.lng }
  homeStationPick = null
  $('homeSave').disabled = true
  $('homeResults').hidden = true
  $('homePickedName').textContent = p.name
  $('homePickedAddr').textContent = p.address && p.address !== p.name ? p.address : ''
  $('homeStep2').hidden = false
  $('homeStations').innerHTML = ''
  $('homeMsg').textContent = '가까운 지하철역을 찾는 중이에요…'
  await prepareStationPicker()
  if (!subwayLines) {
    $('homeMsg').textContent = $('spMsg').textContent || '노선 정보를 불러오지 못했어요.'
    return
  }
  const near = await Kakao.nearbyStations(p.lat, p.lng, HOME_STATION_RADIUS_M, HOME_STATION_LIMIT)
  homeNearby = near.map((n) => ({ n, m: Subway.matchStation(subwayLines, n) })).filter((x) => x.m)
  $('homeStations').innerHTML = homeNearby
    .map(
      (x, i) =>
        `<li><button type="button" class="station-opt" data-i="${i}"><b>${esc(x.m.label)}</b><small>${distanceText(x.n.distance)}</small></button></li>`,
    )
    .join('')
  $('homeMsg').textContent = homeNearby.length ? '' : '근처에서 시간표를 확인할 수 있는 역을 찾지 못했어요. 아래에서 노선으로 직접 골라 주세요.'
}

function chooseHomeStation(station) {
  homeStationPick = { id: station.id, label: station.label, line: station.line }
  $('homeSave').disabled = false
  $('homeStations')
    .querySelectorAll('.station-opt')
    .forEach((b) => b.setAttribute('aria-pressed', homeNearby[Number(b.dataset.i)].m.id === station.id))
}

$('home-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const q = $('homeInput').value.trim()
  if (!q) {
    $('homeErr').textContent = '집 주소나 건물 이름을 입력해 주세요.'
    return
  }
  if (!Kakao.KAKAO_CONNECTED) {
    $('homeErr').textContent = '주소 검색을 쓸 수 없어요. 아래 "현재 위치로 찾기"를 눌러 주세요.'
    return
  }
  $('homeErr').textContent = ''
  const [byAddress, byPlace] = await Promise.all([Kakao.searchAddress(q), Kakao.searchPlaces(q, 5)])
  const seen = new Set()
  homeFound = [...byAddress, ...byPlace].filter((p) => {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  $('homeResults').hidden = false
  $('homeResults').innerHTML = homeFound.length
    ? homeFound
        .slice(0, 8)
        .map((p, i) => `<li><button type="button" data-i="${i}"><span class="nm">${esc(p.name)}</span><span class="ad">${esc(p.address)}</span></button></li>`)
        .join('')
    : '<li class="empty-row">검색 결과가 없어요. 주소를 더 자세히 적어 보세요.</li>'
})

$('homeInput').addEventListener('input', () => {
  $('homeErr').textContent = ''
})

$('homeResults').addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (btn) pickHomePlace(homeFound[Number(btn.dataset.i)])
})

$('homeLocate').addEventListener('click', async () => {
  const btn = $('homeLocate')
  btn.disabled = true
  $('homeErr').textContent = ''
  try {
    myPos = await getPosition()
    geoState = 'granted'
    const address = await Kakao.reverseGeocode(myPos.lat, myPos.lng)
    await pickHomePlace({ name: address || '현재 위치', address, lat: myPos.lat, lng: myPos.lng })
  } catch (err) {
    geoState = await permissionState()
    $('homeErr').textContent = err.message
  } finally {
    btn.disabled = false
  }
})

$('homeStations').addEventListener('click', (e) => {
  const btn = e.target.closest('.station-opt')
  if (btn) chooseHomeStation(homeNearby[Number(btn.dataset.i)].m)
})

$('homeLine').addEventListener('change', () => fillStationSelect($('homeLine'), $('homeStation')))
$('homeStation').addEventListener('change', () => {
  const line = subwayLines && subwayLines[Number($('homeLine').value)]
  const st = line && line.stations[Number($('homeStation').value)]
  if (st) chooseHomeStation({ id: st.id, label: Subway.stationLabel(st, line), line: line.name })
})

$('homeSave').addEventListener('click', async () => {
  if (!homeDraft || !homeStationPick) return
  const btn = $('homeSave')
  btn.disabled = true
  try {
    await Home.saveHome(uid, { ...homeDraft, station: homeStationPick })
    home = await Home.loadHome(uid)
    editingHome = false
    screen = 'list'
    resetHomeSetup()
    await loadMyRoutes() // 도착지가 집인 경로는 새 집을 따라간다
    renderMeScreen()
    showToast('집을 설정했어요.', 3000)
  } catch (err) {
    $('homeErr').textContent = Home.homeError(err)
    btn.disabled = false
  }
})

$('homeEdit').addEventListener('click', () => {
  editingHome = true
  resetHomeSetup()
  renderMeScreen()
})
$('homeCancel').addEventListener('click', () => {
  editingHome = false
  resetHomeSetup()
  renderMeScreen()
})

/* ----- ② 막차 알람 목록 ----- */
async function loadMyRoutes() {
  try {
    savedRoutes = await MyRoutes.listRoutes()
  } catch (e) {
    savedRoutes = []
    $('tripErr').textContent = MyRoutes.routeError(e)
  }
  if (!selectedRoute()) routeId = (savedRoutes.find((r) => r.id === recall(ROUTE_PICK_KEY)) || savedRoutes[0] || {}).id || null
  S.trip = tripOf(selectedRoute())
  remember(ROUTE_PICK_KEY, routeId)
}

function renderList() {
  $('homeLabel').textContent = [home.station && home.station.label, home.address || home.name].filter(Boolean).join(' · ')
  const has = savedRoutes.length > 0
  const asking = !has || formOpen
  $('trip-ask').hidden = !asking
  $('alarm-panel').hidden = !has
  $('routeAdd').hidden = asking
  $('tripTitle').textContent = editingId ? '경로를 수정해요' : '어디서 출발할까요?'
  $('tripSubmit').textContent = editingId ? '수정하기' : '등록하기'
  $('tripCancel').hidden = !has
  renderToMode()

  $('myRoutes').innerHTML = savedRoutes
    .map(
      (r) =>
        `<li class="alarm-row${r.alarm_on ? ' on' : ''}">` +
        `<button type="button" class="alarm-main" data-id="${r.id}">` +
        `<span class="al-title">${esc(routeTitle(r))}</span>` +
        `<span class="al-sub">${r.label ? `${esc(r.from_name)} → ${esc(destName(r))} · ` : ''}${r.alarm_on ? '알람 켜짐' : '알람 꺼짐'}</span></button>` +
        `<button type="button" class="toggle" data-alarm="${r.id}" aria-pressed="${r.alarm_on}" aria-label="${esc(routeTitle(r))} 알람"></button>` +
        `<div class="al-actions"><button type="button" class="x route-edit" data-id="${r.id}">수정</button>` +
        `<button type="button" class="x route-del" data-id="${r.id}">삭제</button></div></li>`,
    )
    .join('')

  if (asking) {
    prepareStationPicker()
    renderNearby()
  }
}

// 내 위치 근처 지하철역 (공공데이터 시간표를 확인할 수 있는 역만). 누르면 출발역으로 정해진다
let nearbySeq = 0
let nearbyList = []
async function renderNearby() {
  const box = $('nearby')
  const mine = ++nearbySeq
  if (!myPos) {
    box.innerHTML = `<p class="sp-msg">${geoState === 'unsupported' ? '이 기기는 위치 기능을 지원하지 않아요.' : '위치를 켜면 지금 있는 곳 근처 역이 여기에 나와요.'}</p>`
    return
  }
  box.innerHTML = '<p class="sp-msg">근처 역을 찾는 중이에요…</p>'
  await prepareStationPicker()
  if (!subwayLines) {
    box.innerHTML = ''
    return
  }
  const near = await Kakao.nearbyStations(myPos.lat, myPos.lng, NEARBY_RADIUS_M, NEARBY_LIMIT)
  if (mine !== nearbySeq) return
  nearbyList = near.map((n) => ({ n, m: Subway.matchStation(subwayLines, n) })).filter((x) => x.m)
  box.innerHTML = nearbyList.length
    ? nearbyList
        .map((x, i) => `<button type="button" class="chip" data-i="${i}"><b>${esc(x.m.label)}</b><small>${distanceText(x.n.distance)}</small></button>`)
        .join('')
    : '<p class="sp-msg">근처 1.5km 안에서 시간표를 확인할 수 있는 역을 찾지 못했어요. 검색하거나 노선에서 골라 주세요.</p>'
}

function chooseFrom(place) {
  $('fromInput').value = place.name
  picked.from = place
  $('tripErr').textContent = ''
  if (place.stationId) {
    const mine = ++spSeq
    fillLastTrains($('spInfo'), place.name, place.stationId, () => mine === spSeq)
  }
}

$('nearby').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip')
  if (!btn) return
  const x = nearbyList[Number(btn.dataset.i)]
  chooseFrom({ name: x.m.label, stationId: x.m.id, line: x.m.line, lat: x.n.lat, lng: x.n.lng })
})

function renderToMode() {
  const isHome = toMode === 'home'
  $('toHome').setAttribute('aria-pressed', isHome)
  $('toOther').setAttribute('aria-pressed', !isHome)
  $('toHomeChip').hidden = !isHome
  $('toInput').hidden = isHome
  $('toHomeLabel').textContent = home && home.station ? home.station.label : ''
  $('spTo').disabled = isHome
  if (isHome && spTarget === 'to') setSpTarget('from')
}

function setSpTarget(t) {
  spTarget = t
  $('spFrom').setAttribute('aria-pressed', t === 'from')
  $('spTo').setAttribute('aria-pressed', t === 'to')
}

$('toHome').addEventListener('click', () => {
  toMode = 'home'
  renderToMode()
})
$('toOther').addEventListener('click', () => {
  toMode = 'other'
  renderToMode()
  $('toInput').focus()
})

// 입력창을 열고 값을 채운다 (route 가 없으면 빈 입력창 = 새로 등록)
function openForm(route) {
  formOpen = true
  editingId = route ? route.id : null
  toMode = route && !route.to_home ? 'other' : 'home'
  $('fromInput').value = route ? route.from_name : ''
  $('toInput').value = route && !route.to_home ? route.to_name : ''
  $('labelInput').value = route ? route.label : ''
  const trip = tripOf(route)
  picked.from = trip && trip.from.stationId ? trip.from : trip && trip.from.lat != null ? trip.from : null
  picked.to = trip && !trip.to.isHome && (trip.to.stationId || trip.to.lat != null) ? trip.to : null
  $('tripErr').textContent = ''
  setSpTarget('from')
  $('spLine').value = ''
  $('spStation').innerHTML = '<option value="">역 선택</option>'
  $('spStation').disabled = true
  $('spInfo').hidden = true
  spSeq++
  screen = 'list'
  renderMeScreen()
  $('fromInput').focus()
}

function closeForm() {
  formOpen = false
  editingId = null
  renderMeScreen()
}

// 장소 자동완성 (카카오). 출발은 지하철역만 찾고, 고른 장소는 picked 에 좌표와 역 정보까지 담긴다
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
    if (!Kakao.KAKAO_CONNECTED || !q) return hide()
    const mine = ++seq
    timer = setTimeout(async () => {
      const res = await Kakao.searchPlaces(q, 6, which === 'from')
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
    const p = placeFromSuggestion(found[Number(btn.dataset.i)])
    if (which === 'from') chooseFrom(p)
    else {
      input.value = p.name
      picked.to = p
    }
    hide()
  })
  input.addEventListener('blur', () => setTimeout(hide, 150))
}
wireSuggest('from')
wireSuggest('to')

/* ----- 노선에서 고르기 ----- */
$('spFrom').addEventListener('click', () => setSpTarget('from'))
$('spTo').addEventListener('click', () => setSpTarget('to'))
$('spRetry').addEventListener('click', () => {
  linesReady = null
  prepareStationPicker()
})

$('spLine').addEventListener('change', () => {
  $('spInfo').hidden = true
  fillStationSelect($('spLine'), $('spStation'))
})

$('spStation').addEventListener('change', () => {
  const line = subwayLines && subwayLines[Number($('spLine').value)]
  const station = line && line.stations[Number($('spStation').value)]
  if (!station) return
  const label = Subway.stationLabel(station, line)
  const place = { name: label, stationId: station.id, line: line.name }
  ensureStationCoords(place) // 지도용 좌표. 늦게 채워져도 저장 전에는 보통 끝나 있다
  if (spTarget === 'from') chooseFrom(place)
  else {
    $('toInput').value = label
    picked.to = place
    $('tripErr').textContent = ''
  }
  // 출발을 골랐고 도착이 비어 있으면 이어서 도착을 고르게 한다
  if (spTarget === 'from' && toMode === 'other' && !$('toInput').value.trim()) setSpTarget('to')
})

// 등록하기 (수정 중이면 수정하기)
$('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fromName = $('fromInput').value.trim()
  if (!fromName) {
    $('tripErr').textContent = '출발할 지하철역을 입력하거나 골라 주세요.'
    return
  }
  const from = placeOf(fromName, picked.from)
  let to
  if (toMode === 'home') {
    if (!home || !home.station) {
      $('tripErr').textContent = '집 근처 지하철역이 정해지지 않았어요. 집을 다시 설정해 주세요.'
      return
    }
    if (from.stationId === home.station.id) {
      $('tripErr').textContent = '출발역이 집 근처 역과 같아요.'
      return
    }
    to = { isHome: true, name: home.station.label, stationId: home.station.id, line: home.station.line, lat: home.lat, lng: home.lng }
  } else {
    const toName = $('toInput').value.trim()
    if (!toName) {
      $('tripErr').textContent = '도착지를 입력해 주세요.'
      return
    }
    if (fromName === toName) {
      $('tripErr').textContent = '출발지와 도착지가 같아요.'
      return
    }
    to = placeOf(toName, picked.to)
  }

  const wasEditing = Boolean(editingId)
  const btn = $('tripSubmit')
  btn.disabled = true
  try {
    await ensureStationCoords(from)
    const row = wasEditing
      ? await MyRoutes.editRoute(editingId, { label: $('labelInput').value.trim(), from, to })
      : await MyRoutes.addRoute(uid, { label: $('labelInput').value.trim(), from, to })
    await loadMyRoutes()
    routeId = row.id
    formOpen = false
    editingId = null
    $('tripErr').textContent = ''
    renderMeScreen()
    showToast(wasEditing ? '경로를 수정했어요.' : '경로를 등록했어요. 눌러서 막차를 확인해 보세요.', 3500)
  } catch (err) {
    $('tripErr').textContent = MyRoutes.routeError(err)
  } finally {
    btn.disabled = false
  }
})

$('routeAdd').addEventListener('click', () => openForm(null))
$('tripCancel').addEventListener('click', closeForm)

// 알람을 켜고 끈다. 켤 때 브라우저 알림 권한도 한 번 물어본다
async function toggleAlarm(id) {
  const r = savedRoutes.find((x) => x.id === id)
  if (!r) return
  const on = !r.alarm_on
  if (on && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => {})
  }
  try {
    await MyRoutes.setAlarm(id, on)
  } catch (err) {
    showToast(MyRoutes.routeError(err), 5000)
    return
  }
  r.alarm_on = on
  renderMeScreen()
  syncDetailHead()
  showToast(on ? '알람을 켰어요. 앱이 열려 있는 동안 출발 시각이 가까워지면 알려 드려요.' : '알람을 껐어요.', 4000)
}

// 목록: 열기 / 알람 / 수정 / 삭제
$('myRoutes').addEventListener('click', async (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  if (btn.dataset.alarm) return toggleAlarm(btn.dataset.alarm)
  const id = btn.dataset.id
  if (btn.classList.contains('alarm-main')) {
    openRoute(id)
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
    renderMeScreen()
  }
})

/* ----- ③ 경로 상세: 지도, 추천 막차, 다른 경로 ----- */
function syncDetailHead() {
  const r = selectedRoute()
  if (!r) return
  $('detailTitle').textContent = routeTitle(r)
  $('detailSub').textContent = r.label ? `${r.from_name} → ${destName(r)}` : ''
  $('detailAlarm').setAttribute('aria-pressed', r.alarm_on)
}

async function drawRouteMap() {
  const t = S.trip
  if (!t) return
  const mapEl = $('routeMap')
  $('mapMsg').textContent = ''
  if (!Kakao.KAKAO_CONNECTED) {
    mapEl.hidden = true
    $('mapMsg').textContent = '지도를 쓰려면 카카오 지도 키가 필요해요.'
    return
  }
  await ensureStationCoords(t.from)
  const points = []
  if (myPos) points.push({ lat: myPos.lat, lng: myPos.lng, kind: 'me', label: '내 위치' })
  if (t.from.lat != null) points.push({ lat: t.from.lat, lng: t.from.lng, kind: 'from', label: t.from.name.replace(/\s*\(.*\)\s*$/, '') })
  if (t.to.lat != null) points.push({ lat: t.to.lat, lng: t.to.lng, kind: t.to.isHome ? 'home' : 'to', label: t.to.isHome ? HOME_NAME : t.to.name })
  if (!points.length) {
    mapEl.hidden = true
    $('mapMsg').textContent = '지도에 표시할 위치가 없어요. 위치를 켜거나, 출발역을 검색해서 다시 등록해 보세요.'
    return
  }
  mapEl.hidden = false
  mapHandle = await Kakao.drawMap(mapEl, points)
  if (!mapHandle) {
    mapEl.hidden = true
    $('mapMsg').textContent = '지도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
  } else if (!myPos) {
    $('mapMsg').textContent = '위치를 켜면 지도에 내 위치도 보여 드려요.'
  }
}

// 고른 출발역의 막차 (역으로 등록한 경로만)
function renderLast() {
  const from = S.trip && S.trip.from
  const mine = ++lastSeq
  if (!from || !from.stationId) {
    $('lastPanel').hidden = true
    return
  }
  $('lastPanel').hidden = false
  fillLastTrains($('lastBody'), from.name, from.stationId, () => mine === lastSeq)
}

async function loadRoutes() {
  if (!S.trip) {
    S.routes = []
    return
  }
  try {
    S.routes = await fetchRoutes(S.trip, myPos)
  } catch (e) {
    console.error(e)
    S.routes = []
    showToast('경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 6000)
  }
}

async function openRoute(id) {
  routeId = id
  screen = 'detail'
  formOpen = false
  editingId = null
  S.trip = tripOf(selectedRoute())
  remember(ROUTE_PICK_KEY, routeId)
  renderMeScreen()
  syncDetailHead()
  drawRouteMap()
  renderLast()
  await loadRoutes()
  rerender()
}

$('detailBack').addEventListener('click', () => {
  screen = 'list'
  mapHandle = null
  renderMeScreen()
})
$('detailAlarm').addEventListener('click', () => {
  if (routeId) toggleAlarm(routeId)
})

// 알림: 토스트와, 권한이 있고 화면이 가려져 있으면 브라우저 알림
function alertUser(msg) {
  showToast(msg)
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification('막차 자기장', { body: msg })
    }
  } catch (e) {
    /* 알림을 못 띄우는 환경 */
  }
}

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
    const route = selectedRoute()
    if (hit !== undefined && route && route.alarm_on && getPrefs().notify['t' + hit]) alertUser(MSG[hit])

    plans.forEach((p, i) => {
      const el = $('rs' + i)
      if (!el) return
      const rr = p.leave - now
      el.textContent = rr < 0 ? '놓침' : hhmm(p.leave)
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
  const savedXfer = recall(XFER_BUFFER_KEY)
  S.xferBuffer = savedXfer === null ? DEFAULT_XFER_BUFFER_MIN : Number(savedXfer)
  $('xfer').value = S.xferBuffer

  try {
    home = await Home.loadHome(uid)
  } catch (e) {
    $('homeErr').textContent = Home.homeError(e)
  }
  await loadMyRoutes()
  initGeo().catch((e) => console.error(e))
  renderMeScreen()
  // 새로고침해도 보던 경로 화면에 머문다
  const lastOpen = recall('lz_screen:' + uid)
  if (lastOpen && home && savedRoutes.some((r) => r.id === lastOpen)) await openRoute(lastOpen)

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
$('xfer').addEventListener('input', (e) => {
  S.xferBuffer = Number(e.target.value)
  remember(XFER_BUFFER_KEY, String(S.xferBuffer))
  rerender()
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

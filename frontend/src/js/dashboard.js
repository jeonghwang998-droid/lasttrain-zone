// html/dashboard.html 담당: 나 / 우리 테이블 / 내 걸음 화면
// 화면에 보이는 값은 전부 서버(Supabase)와 현재 시각에서 가져온다. 가짜 데이터는 없다

import { WD, RAIN_BINS } from './data.js'
import { S } from './state.js'
import { hhmm, fm, left, nowSec, secToDate, serviceDayStart } from './clock.js'
import { plansFor } from './planner.js'
import { fetchRoutes, routesNote, destinationStations, applyWalk, TRANSIT_CONNECTED, WALK_MAX_M } from './transit.js'
import { loadDeadlines, zoneStations, zoneCircles, bestEscape } from './zone.js'
import { routeCardsHtml, routesEmptyHtml, lastBoxHtml, restText, lineChipsHtml } from './routeview.js'
import * as Kakao from './kakao.js'
import * as Home from './home.js'
import { permissionState, onPermissionChange, getPosition, watchPosition, distanceM, WALK_DETOUR } from './geo.js'
import { initApp, url } from './app.js'
import { getPrefs, logout } from './account.js'
import { sessionUserId, loadConfig, loadProfile, saveBuffer, loadTrips, addTrip, deleteTrip } from './db.js'
import * as Rooms from './rooms.js'
import * as MyRoutes from './myroutes.js'
import * as Subway from './subway.js'
import { ring } from './notify.js'

initApp()

const $ = (id) => document.getElementById(id)

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 서버나 지도 API 를 기다리는 동안 보여 주는 문구 (돌아가는 원 + 글자)
const loadingHtml = (text) => `<span class="spin" aria-hidden="true"></span>${esc(text)}`
const ROUTES_LOADING =
  `<li class="route-loading"><p class="rl-title">${loadingHtml('막차 계산 중이에요')}</p>` +
  '<p class="rl-sub">시간표에서 환승 연결을 하나씩 맞춰 보고 있어요. 조금만 기다려 주세요.</p>' +
  '<i class="skel" style="width:55%"></i><i class="skel" style="width:85%"></i><i class="skel" style="width:70%"></i></li>'

// 처음 화면을 덮고 있는 '불러오는 중'을 걷어 낸다
function hideBoot() {
  const el = $('boot')
  if (!el || el.classList.contains('out')) return
  el.classList.add('out')
  setTimeout(() => el.remove(), 300)
}

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
let routesLoading = false // 교통 API 에서 경로를 받아 막차를 계산하는 중

let rooms = []
let roomId = null
let members = []
let unwatch = null

/* ---------- 알림 토스트 ---------- */
let toastTimer
function showToast(msg, ms = 7000) {
  $('toastText').textContent = msg
  $('toast').classList.add('show')
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
  $('routes').innerHTML = routesLoading
    ? ROUTES_LOADING
    : plans.length
      ? routeCardsHtml(plans.slice(0, 1), S.trip, S.ai, 0)
      : routesEmptyHtml(S.trip, TRANSIT_CONNECTED, routesNote())
  $('heroChips').innerHTML = lineChipsHtml(plans[0])
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
  if (screen === 'detail' && S.trip) {
    drawRouteMap()
    startLiveLocation()
    if (myPos && !zone.loading && (!zone.center || zone.note)) loadZone()
  }
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
      $('spMsg').innerHTML = loadingHtml('노선 정보를 불러오는 중이에요')
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
  box.innerHTML = `<p class="sp-load">${loadingHtml('막차를 확인하는 중이에요')}</p>`
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
  $('homeMsg').innerHTML = loadingHtml('가까운 지하철역을 찾는 중이에요')
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
  $('homeResults').hidden = false
  $('homeResults').innerHTML = `<li class="empty-row">${loadingHtml('주소를 찾는 중이에요')}</li>`
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
  pollRouteAlarms() // 경로를 더하거나 고치면 알람 시각도 다시 계산
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
  box.innerHTML = `<p class="sp-msg">${loadingHtml('근처 역을 찾는 중이에요')}</p>`
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
/* ----- 막차 알람: 알람을 켠 경로마다 일어날 시각을 계산해 두고 30분, 10분 전, 그 시각에 울린다 ----- */
const ROUTE_ALARM_POLL_MS = 5 * 60000 // 열지 않은 경로의 일어날 시각을 다시 계산하는 간격
const routeAlarms = new Map() // 경로 id -> { leave: 일어날 시각(초), name }
const routeFired = {} // 이미 울린 경로 알람 ('경로|분|서비스 날')

async function pollRouteAlarms() {
  const on = savedRoutes.filter((r) => r.alarm_on)
  for (const id of [...routeAlarms.keys()]) if (!on.some((r) => r.id === id)) routeAlarms.delete(id)
  for (const r of on) {
    const trip = tripOf(r)
    if (!trip || (r.to_home && !home)) continue
    try {
      const best = plansFor(await fetchRoutes(trip, myPos), S.ai)[0]
      if (best) routeAlarms.set(r.id, { leave: best.leave, name: routeTitle(r) })
      else routeAlarms.delete(r.id)
    } catch (e) {
      console.error(e) // 다음 계산 때 다시 시도
    }
  }
}

// 매 0.25초: 상세 화면에 열린 경로는 지금 화면의 계산(plans)을, 나머지는 뒤에서 계산한 값을 쓴다
function checkRouteAlarms(now) {
  const day = serviceDayStart()
  for (const r of savedRoutes) {
    if (!r.alarm_on) continue
    const live = r.id === routeId && plans[0]
    const a = live ? { leave: plans[0].leave, name: routeTitle(r) } : routeAlarms.get(r.id)
    if (!a) continue
    const rest = a.leave - now
    for (const t of [30, 10, 0]) {
      const key = `${r.id}|${t}|${day}`
      if (rest <= t * 60 && rest > -120 && !routeFired[key]) {
        routeFired[key] = 1
        if (getPrefs().notify['t' + t]) alertUser(`[${a.name}] ${MSG[t]}`, `lz-route-${r.id}`)
      }
    }
  }
}

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
  pollRouteAlarms()
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

// 지도 칸 보이기/숨기기. 숨기면 출발 카드가 지도 위에 겹치지 않고 위로 올라간다
function showMap(on) {
  $('routeMap').hidden = !on
  $('mapWrap').hidden = !on
}

async function drawRouteMap() {
  const t = S.trip
  if (!t) return
  $('mapMsg').textContent = ''
  if (!Kakao.KAKAO_CONNECTED) {
    showMap(false)
    $('mapMsg').textContent = '지도를 쓰려면 카카오 지도 키가 필요해요.'
    return
  }
  showMap(true)
  $('mapLoading').hidden = false
  try {
    await drawRouteMapInner(t)
  } finally {
    $('mapLoading').hidden = true
  }
  renderLive()
}

async function drawRouteMapInner(t) {
  const mapEl = $('routeMap')
  await ensureStationCoords(t.from)
  const points = []
  if (myPos) points.push({ lat: myPos.lat, lng: myPos.lng, kind: 'me', label: '내 위치' })
  if (t.from.lat != null) points.push({ lat: t.from.lat, lng: t.from.lng, kind: 'from', label: t.from.name.replace(/\s*\(.*\)\s*$/, '') })
  if (t.to.lat != null) points.push({ lat: t.to.lat, lng: t.to.lng, kind: t.to.isHome ? 'home' : 'to', label: t.to.isHome ? HOME_NAME : t.to.name })
  if (!points.length) {
    showMap(false)
    $('mapMsg').textContent = '지도에 표시할 위치가 없어요. 위치를 켜거나, 출발역을 검색해서 다시 등록해 보세요.'
    return
  }
  mapHandle = await Kakao.drawMap(mapEl, points)
  if (!mapHandle) {
    showMap(false)
    $('mapMsg').textContent = '지도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
  } else if (!myPos) {
    $('mapMsg').textContent = '위치를 켜면 지도에 내 위치도 보여 드려요.'
  }
}

/* ----- 실시간: 지금 위치에서 출발역까지 걷기, 막차 자기장 ----- */
const LIVE_REFRESH_MS = 5000 // 자기장 반경과 걷기 카드를 다시 그리는 간격 (시간이 지나면 자기장이 줄어든다)
const WALK_REPLAN_M = 15 // 이만큼 움직이면 일어날 시각을 다시 계산한다
const ZONE_RECENTER_M = 1500 // 자기장을 계산한 자리에서 이만큼 멀어지면 주변 역을 다시 찾는다
let stopWatch = null
let lastPlannedPos = null
let zone = { routeId: null, center: null, stations: [], note: '', loading: false }

const walkSpeed = () => S.walkSpeed || S.walkDefault || 1
const koreanOr = (msg, fallback) => (msg && /[가-힣]/.test(msg) ? msg : fallback)

// 상세 화면에 있는 동안 위치를 계속 따라간다
function startLiveLocation() {
  if (stopWatch || geoState !== 'granted' || screen !== 'detail') return
  stopWatch = watchPosition(
    (pos) => {
      myPos = pos
      if (mapHandle) mapHandle.setMe(pos.lat, pos.lng)
      if (S.trip && (!lastPlannedPos || distanceM(lastPlannedPos, pos) >= WALK_REPLAN_M)) {
        lastPlannedPos = pos
        applyWalk(S.routes, myPos, S.trip.from)
        rerender()
      }
      if (zone.center && distanceM(zone.center, pos) >= ZONE_RECENTER_M) loadZone()
      renderLive()
    },
    (msg) => {
      geoError = msg
    },
  )
}

function stopLiveLocation() {
  if (stopWatch) stopWatch()
  stopWatch = null
  lastPlannedPos = null
}

// 자기장 자료: 집 근처 역까지의 막차 마감(서버) + 내 주변 역(카카오)
async function loadZone() {
  const t = S.trip
  const id = routeId
  const center = myPos || (t && t.from.lat != null ? t.from : null)
  zone = { routeId: id, center, stations: [], note: '', loading: true }
  renderLive()
  try {
    if (!center) {
      zone.note = '위치를 켜면 지금 있는 곳의 막차 자기장을 보여 드려요.'
      return
    }
    const targets = await destinationStations(t.to)
    if (!targets.length) {
      zone.note = '집 근처에서 시간표를 확인할 수 있는 역을 찾지 못했어요.'
      return
    }
    const res = await loadDeadlines(targets)
    const stations = res.note ? [] : await zoneStations(center, res.stations)
    if (routeId !== id) return // 그사이 다른 경로를 열었다
    zone.stations = stations
    zone.note = res.note || ''
  } catch (e) {
    console.error(e)
    zone.note = koreanOr(e && e.message, '막차 자기장을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  } finally {
    if (routeId === id) {
      zone.loading = false
      renderLive()
    }
  }
}

function renderLive() {
  if (screen !== 'detail' || !S.trip) return
  const now = nowSec() / 60
  const circles = zoneCircles(zone.stations, now, walkSpeed(), S.buffer)
  if (mapHandle) mapHandle.setZone(circles)

  const st = $('zoneStatus')
  if (zone.loading) st.innerHTML = loadingHtml('막차 자기장을 계산하는 중이에요')
  else if (zone.note) st.textContent = zone.note
  else if (!zone.stations.length) st.textContent = '내 주변에서 집으로 갈 수 있는 역을 찾지 못했어요.'
  else if (!circles.length) st.innerHTML = '<b class="out">귀가 가능 구역이 모두 사라졌어요.</b> 택시나 심야버스를 알아보세요.'
  else if (!myPos) st.textContent = `주변에서 아직 탈 수 있는 역 ${circles.length}곳이 자기장 안에 있어요. 위치를 켜면 내가 안에 있는지 알려 드려요.`
  else {
    const best = bestEscape(myPos, circles, walkSpeed())
    st.innerHTML = best
      ? `<b class="in">지금 위치는 귀가 가능 구역 안이에요.</b> ${esc(best.circle.name)}까지 걸어서 ${best.walkMin}분${S.buffer ? `, 일찍 일어나기 ${S.buffer}분을 빼고도` : ','} ${best.slack}분 여유`
      : '<b class="out">지금 위치는 귀가 가능 구역 밖이에요.</b> 걸어서 막차 전에 닿는 역이 없어요.'
  }
  renderWalkCard(now)
}

// 지금 위치 → 출발역: 거리, 걷는 시간, 탈 열차까지 여유
function renderWalkCard(nowMin) {
  const from = S.trip && S.trip.from
  const show = Boolean(myPos && from && from.lat != null)
  $('walkCard').hidden = !show
  if (!show) return
  const meters = distanceM(myPos, from) * WALK_DETOUR
  const walkMin = Math.max(1, Math.ceil(meters / walkSpeed()))
  const dist = meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`
  $('walkTitle').textContent = `지금 위치 → ${from.name}`
  // 걸어갈 거리가 아니면 걷는 시간은 빼고, 일어날 시각은 출발역 기준이라고 알린다 (transit.applyWalk 와 같은 기준)
  if (meters > WALK_MAX_M) {
    $('walkSub').textContent = `약 ${dist} · 걸어가기엔 멀어요`
    $('walkMin').textContent = '--'
    $('walkTrain').textContent = `출발역에서 멀리 있어서, 일어날 시각은 ${from.name}에 있다고 보고 계산했어요. 역 2km 안으로 오면 걷는 시간까지 넣어 다시 계산해요.`
    return
  }
  $('walkSub').textContent = `약 ${dist} · 지금 출발하면 ${hhmm((nowMin + walkMin) * 60)} 도착`
  $('walkMin').textContent = walkMin
  const first = plans[0] && plans[0].legs[0]
  if (!first) {
    $('walkTrain').textContent = ''
    return
  }
  const spare = Math.floor(first.dep - (nowMin + walkMin))
  $('walkTrain').innerHTML =
    spare >= 0
      ? `탈 열차 <b>${fm(first.dep)}</b> ${esc(first.leg.name)}까지 역에서 <b>${spare}분</b> 여유`
      : `지금 걸어가도 <b>${fm(first.dep)}</b> ${esc(first.leg.name)} 열차는 놓쳐요. 다른 경로를 확인해 보세요.`
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

let routesSeq = 0
async function loadRoutes() {
  const mine = ++routesSeq
  S.routes = []
  if (!S.trip) return
  routesLoading = true
  renderMe()
  try {
    const routes = await fetchRoutes(S.trip, myPos)
    if (mine === routesSeq) S.routes = routes
  } catch (e) {
    console.error(e)
    if (mine === routesSeq) showToast('경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 6000)
  } finally {
    if (mine === routesSeq) routesLoading = false
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
  loadZone()
  startLiveLocation()
  renderLast()
  await loadRoutes()
  lastPlannedPos = myPos
  rerender()
}

$('detailBack').addEventListener('click', () => {
  screen = 'list'
  stopLiveLocation()
  mapHandle = null
  renderMeScreen()
})
$('detailAlarm').addEventListener('click', () => {
  if (routeId) toggleAlarm(routeId)
})

// 알람: 화면 위 안내 + 소리, 진동, 시스템 알림 (내 정보의 알림 설정대로)
function alertUser(msg, tag) {
  showToast(msg)
  ring(msg, tag).catch((e) => console.error(e))
}

/* ---------- 우리 테이블 ---------- */
// 모임 목록(새 모임, 초대 코드 입장)과 모임 안.
// 모임 안: 멤버마다 자기 도착지(집 또는 고른 역)로 막차를 계산해 출발 시각(leave_at)을 모임에 공유하고,
// 가장 빠른 마지노선을 '다 같이 일어날 시각'으로 보여 준다. 알람을 켠 멤버는 그 시각에 맞춰 같이 알림을 받는다.
// 집에 도착하면 '귀가 완료'를 눌러 모두에게 알린다 (안심 귀가 체크)
const ROOM_REPLAN_MS = 60000 // 모임 안에서 내 막차를 다시 계산하는 간격 (시간이 지나고 위치가 바뀌므로)
const ROOM_ALARM_POLL_MS = 30000 // 알람을 켠 모임들의 '다 같이 일어날 시각'을 확인하는 간격 (모임 화면 밖에서도)
const ROOM_MSG = {
  30: '다 같이 일어날 시각까지 30분 남았어요.',
  10: '다 같이 일어날 시각까지 10분 남았어요. 계산부터 하세요.',
  0: '지금 다 같이 일어나야 막차 타요!',
}

let inRoom = false
let generated = null // 방금 코드를 만든 모임 { code, place_label }
let mySettings = null // 이 모임에서 내 도착지와 알람 { use_home, dest_station_id, dest_label, dest_lat, dest_lng, alarm_on }
let roomMapHandle = null
let roomPlanSeq = 0
let sharedLeave = null // 마지막으로 모임에 알린 내 출발 시각(ms)
const alarmDeadlines = new Map() // 모임 id -> { at: Date, name } (알람을 켠 모임들)
const roomFired = {} // 이미 울린 모임 알람
const lastStatus = new Map() // '모임 id|멤버 id' -> 지난번에 본 상태 (귀가 완료로 바뀌는 순간을 알기 위해)

// 알람을 켠 모임에서 다른 멤버가 귀가 완료로 바뀌면 알린다. 처음 본 상태는 기억만 한다
function noticeArrivals(id, list, name) {
  for (const m of list) {
    const key = `${id}|${m.userId}`
    const before = lastStatus.get(key)
    lastStatus.set(key, m.status)
    if (before && before !== 'arrived' && m.status === 'arrived' && m.userId !== uid && getPrefs().notify.arrived) {
      alertUser(`[${name}] ${m.nickname}님이 집에 도착했어요.`, `lz-arrived-${key}`)
    }
  }
}

const currentRoom = () => rooms.find((r) => r.id === roomId)
const clockOf = (date) => date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 아직 귀가하지 않은 멤버 중 가장 이른 출발 시각
function groupDeadline(list) {
  const active = list.filter((m) => m.status !== 'arrived' && m.leaveAt)
  if (!active.length) return null
  const at = new Date(Math.min(...active.map((m) => +m.leaveAt)))
  return { at, who: active.filter((m) => +m.leaveAt === +at) }
}

async function loadRooms() {
  try {
    rooms = await Rooms.myRooms()
  } catch (e) {
    $('groupErr').textContent = Rooms.roomError(e)
    rooms = []
  }
  if (inRoom && !currentRoom()) closeRoom() // 나간 모임
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
  sharedLeave = null
  roomMapHandle = null
  showRoomView()
  unwatch = Rooms.watchRoom(id, () => refreshRoom())
  $('roomErr').textContent = ''
  $('myRoomRoute').innerHTML = ''
  $('roomMap').hidden = true
  members = []
  $('people').innerHTML = `<li class="people-loading">${loadingHtml('멤버를 불러오는 중이에요')}</li>`
  try {
    mySettings = await Rooms.mySettings(id, uid)
  } catch (e) {
    mySettings = null
    $('roomErr').textContent = Rooms.roomError(e)
  }
  if (!mySettings) mySettings = { use_home: true, alarm_on: false } // 처음엔 내 집으로
  renderDestMode()
  await refreshRoom()
  if (geoState === 'granted') {
    try {
      myPos = await getPosition()
    } catch (e) {
      geoError = e.message
    }
  }
  planMyRoomRoute()
}

function closeRoom() {
  if (unwatch) unwatch()
  unwatch = null
  roomId = null
  inRoom = false
  members = []
  roomMapHandle = null
  roomPlanSeq++
  showRoomView()
}

async function refreshRoom() {
  if (!inRoom) return
  const id = roomId
  let list = []
  try {
    list = await Rooms.roomMembers(id)
  } catch (e) {
    $('roomErr').textContent = Rooms.roomError(e)
  }
  if (!inRoom || roomId !== id) return // 기다리는 사이 다른 화면으로 옮겼다
  members = list
  const room = currentRoom()
  const g = groupDeadline(members)
  if (room && mySettings && mySettings.alarm_on) {
    if (g) alarmDeadlines.set(id, { at: g.at, name: room.place_label || '모임' })
    else alarmDeadlines.delete(id)
    noticeArrivals(id, members, room.place_label || '모임')
  }
  renderRoom()
}

function renderRoom() {
  const room = currentRoom()
  if (!room) return
  $('roomName').textContent = room.place_label || '이름 없는 모임'
  $('roomCodeChip').textContent = `초대 코드 ${room.code}`
  $('roomAlarm').setAttribute('aria-pressed', Boolean(mySettings && mySettings.alarm_on))

  const g = groupDeadline(members)
  const firstIds = new Set(g ? g.who.map((m) => m.userId) : [])
  // 아직 귀가 안 한 사람은 출발 시각이 이른 순, 귀가 완료한 사람은 아래로
  const sorted = [...members].sort((a, b) => {
    const ra = a.status === 'arrived' ? 2 : a.leaveAt ? 0 : 1
    const rb = b.status === 'arrived' ? 2 : b.leaveAt ? 0 : 1
    if (ra !== rb) return ra - rb
    if (ra === 0) return a.leaveAt - b.leaveAt
    return a.joinedAt - b.joinedAt
  })
  $('people').innerHTML = sorted
    .map((m) => {
      const arrived = m.status === 'arrived'
      const tags = `${m.userId === uid ? ' (나)' : ''}${m.userId === room.host_id ? ' · 방장' : ''}`
      const detail = arrived
        ? `귀가 완료${m.arrivedAt ? ` ${clockOf(m.arrivedAt)}` : ''}`
        : m.leaveAt
          ? `${clockOf(m.leaveAt)}까지 일어나야 해요`
          : '막차 계산 전'
      const icon = arrived
        ? '<svg class="ico ok" viewBox="0 0 24 24" aria-label="귀가 완료"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>'
        : `<i class="m-dot${firstIds.has(m.userId) ? ' first' : ''}" aria-hidden="true"></i>`
      return (
        `<li class="${arrived ? 'arrived' : firstIds.has(m.userId) ? 'first' : ''}"><span class="mode">${icon}</span>` +
        `<div><div class="who">${esc(m.nickname)}${tags}</div><div class="home">${detail}</div></div>` +
        `<span class="when"${!arrived && m.leaveAt ? ` data-leave="${+m.leaveAt}"` : ''}>${arrived ? '✓' : ''}</span><span></span></li>`
      )
    })
    .join('')

  const me = members.find((m) => m.userId === uid)
  const arrived = Boolean(me && me.status === 'arrived')
  $('btnArrived').textContent = arrived ? '귀가 완료 취소' : '집에 도착했어요'
  $('btnArrived').classList.toggle('btn-primary', !arrived)
  roomTick()
}

// 매 0.25초: 다 같이 일어날 시각까지 남은 시간
function roomTick() {
  if (!inRoom) return
  const g = groupDeadline(members)
  if (!g) {
    $('gTime').textContent = '--:--'
    const allHome = members.length > 0 && members.every((m) => m.status === 'arrived')
    if (allHome) $('gCount').textContent = '모두 귀가했어요'
    else $('gCount').innerHTML = loadingHtml('멤버들의 막차 계산 중이에요')
    $('gWho').textContent = allHome ? '' : '각자 이 모임을 열면 출발 시각이 공유돼요'
  } else {
    const r = (g.at - Date.now()) / 1000
    $('gTime').textContent = clockOf(g.at)
    $('gCount').textContent = r < 0 ? '마지노선이 지났어요. 택시나 심야버스를 알아보세요' : `앞으로 ${left(r)}`
    $('gWho').textContent = `${g.who.map((m) => (m.userId === uid ? '나' : m.nickname)).join(', ')}의 막차 기준`
  }
  document.querySelectorAll('#people [data-leave]').forEach((el) => {
    el.textContent = left((Number(el.dataset.leave) - Date.now()) / 1000)
  })
}

// 알람을 켠 모임들: 다 같이 일어날 시각 30, 10, 0분 전에 알린다 (앱이 열려 있으면 어느 화면에서든)
function checkRoomAlarms() {
  for (const [id, { at, name }] of alarmDeadlines) {
    const r = (at - Date.now()) / 1000
    for (const t of [30, 10, 0]) {
      const key = `${id}|${+at}|${t}`
      if (r <= t * 60 && r > -120 && !roomFired[key]) {
        roomFired[key] = 1
        if (getPrefs().notify['t' + t]) alertUser(`[${name}] ${ROOM_MSG[t]}`, `lz-room-${id}`)
      }
    }
  }
}

async function pollRoomAlarms() {
  let ids = []
  try {
    ids = await Rooms.alarmRooms(uid)
  } catch (e) {
    return // 아직 SQL 008 전이면 조용히 넘어간다
  }
  for (const id of [...alarmDeadlines.keys()]) if (!ids.includes(id)) alarmDeadlines.delete(id)
  for (const id of ids) {
    const room = rooms.find((r) => r.id === id)
    if (!room) continue
    const list = inRoom && roomId === id ? members : await Rooms.roomMembers(id).catch(() => null)
    if (!list) continue
    const g = groupDeadline(list)
    if (g) alarmDeadlines.set(id, { at: g.at, name: room.place_label || '모임' })
    else alarmDeadlines.delete(id)
    noticeArrivals(id, list, room.place_label || '모임')
  }
}

/* ----- 모임 안: 내 도착지와 내 막차 ----- */
// 내 도착지: 집이면 my_home, 아니면 고른 역
function myRoomDest() {
  if (!mySettings) return null
  if (mySettings.use_home) {
    return home && home.station
      ? { name: home.station.label, stationId: home.station.id, line: home.station.line, lat: home.lat, lng: home.lng, isHome: true }
      : null
  }
  return mySettings.dest_station_id
    ? { name: mySettings.dest_label, stationId: mySettings.dest_station_id, lat: mySettings.dest_lat, lng: mySettings.dest_lng }
    : null
}

function renderDestMode() {
  const isHome = Boolean(mySettings && mySettings.use_home)
  $('roomDestHome').setAttribute('aria-pressed', isHome)
  $('roomDestOther').setAttribute('aria-pressed', !isHome)
  $('roomDestWrap').hidden = isHome
  $('roomDestInput').value = !isHome && mySettings.dest_label ? mySettings.dest_label : ''
}

async function saveRoomSettings(changes) {
  mySettings = { ...mySettings, ...changes }
  try {
    await Rooms.saveMySettings(roomId, uid, mySettings)
  } catch (e) {
    $('roomErr').textContent = Rooms.roomError(e)
  }
}

// 지금 위치에서 가장 가까운 역 → 내 도착지. 계산한 출발 시각은 모임에 공유한다
async function planMyRoomRoute() {
  const mine = ++roomPlanSeq
  const room = currentRoom()
  if (!room) return
  const msg = $('myPlanMsg')
  $('roomLocBtn').hidden = true
  const to = myRoomDest()
  if (!to) {
    msg.textContent = mySettings && mySettings.use_home ? '집이 아직 설정되지 않았어요. 나 탭에서 집을 먼저 정해 주세요.' : '내릴 지하철역을 검색해서 골라 주세요.'
    $('myRoomRoute').innerHTML = ''
    $('roomMap').hidden = true
    return
  }
  if (!myPos) {
    msg.textContent = '위치를 켜면 지금 있는 곳에서 내 막차를 계산해요.'
    $('roomLocBtn').hidden = geoState === 'unsupported'
    return
  }
  msg.innerHTML = loadingHtml('막차 계산 중이에요')
  await prepareStationPicker()
  const near = subwayLines ? await Kakao.nearbyStations(myPos.lat, myPos.lng, NEARBY_RADIUS_M, NEARBY_LIMIT) : []
  const st = near.map((n) => ({ n, m: Subway.matchStation(subwayLines, n) })).find((x) => x.m)
  if (mine !== roomPlanSeq) return
  if (!st) {
    msg.textContent = '근처 1.5km 안에 시간표를 확인할 수 있는 지하철역이 없어요.'
    return
  }
  const trip = { from: { name: st.m.label, stationId: st.m.id, line: st.m.line, lat: st.n.lat, lng: st.n.lng }, to }
  let routes = []
  try {
    routes = await fetchRoutes(trip, myPos)
  } catch (e) {
    console.error(e)
    if (mine === roomPlanSeq) msg.textContent = '내 막차를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    return
  }
  if (mine !== roomPlanSeq) return
  const best = plansFor(routes, S.ai)[0] || null
  $('myRoomRoute').innerHTML = best ? routeCardsHtml([best], trip, S.ai, 100) : routesEmptyHtml(trip, TRANSIT_CONNECTED, routesNote())
  if (best && $('rs100')) $('rs100').textContent = hhmm(best.leave)
  msg.textContent = best ? `가까운 ${trip.from.name}에서 출발 · ${hhmm(best.leave)}에 일어나면 돼요` : ''

  // 지도: 내 위치, 출발역, 도착지
  const mapEl = $('roomMap')
  const points = [{ lat: myPos.lat, lng: myPos.lng, kind: 'me', label: '내 위치' }, { lat: trip.from.lat, lng: trip.from.lng, kind: 'from', label: trip.from.name.replace(/\s*\(.*\)\s*$/, '') }]
  if (to.lat != null) points.push({ lat: to.lat, lng: to.lng, kind: to.isHome ? 'home' : 'to', label: to.isHome ? HOME_NAME : to.name })
  mapEl.hidden = false
  if (!roomMapHandle) roomMapHandle = await Kakao.drawMap(mapEl, points)
  else roomMapHandle.setMe(myPos.lat, myPos.lng)
  if (!roomMapHandle) mapEl.hidden = true

  // 모임에 내 출발 시각 알리기 (바뀌었을 때만)
  const leaveAt = best ? secToDate(best.leave) : null
  const next = leaveAt ? +leaveAt : null
  if (next !== sharedLeave) {
    try {
      await Rooms.setMyLeaveAt(room.id, uid, leaveAt)
      sharedLeave = next
      refreshRoom()
    } catch (e) {
      $('roomErr').textContent = Rooms.roomError(e)
    }
  }
}

// 도착지 검색 (지하철역만)
let roomDestFound = []
let roomDestTimer
$('roomDestInput').addEventListener('input', () => {
  clearTimeout(roomDestTimer)
  const q = $('roomDestInput').value.trim()
  const list = $('roomDestSuggest')
  if (!Kakao.KAKAO_CONNECTED || !q) {
    list.hidden = true
    return
  }
  roomDestTimer = setTimeout(async () => {
    await prepareStationPicker()
    roomDestFound = (await Kakao.searchPlaces(q, 6, true)).map(placeFromSuggestion).filter((p) => p.stationId)
    list.innerHTML = roomDestFound.map((p, i) => `<li><button type="button" data-i="${i}"><span class="nm">${esc(p.name)}</span></button></li>`).join('')
    list.hidden = !roomDestFound.length
  }, 250)
})
$('roomDestSuggest').addEventListener('mousedown', (e) => e.preventDefault())
$('roomDestSuggest').addEventListener('click', async (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  const p = roomDestFound[Number(btn.dataset.i)]
  $('roomDestInput').value = p.name
  $('roomDestSuggest').hidden = true
  await saveRoomSettings({ use_home: false, dest_station_id: p.stationId, dest_label: p.name, dest_lat: p.lat ?? null, dest_lng: p.lng ?? null })
  roomMapHandle = null
  planMyRoomRoute()
})
$('roomDestInput').addEventListener('blur', () => setTimeout(() => ($('roomDestSuggest').hidden = true), 150))

$('roomDestHome').addEventListener('click', async () => {
  await saveRoomSettings({ use_home: true })
  renderDestMode()
  roomMapHandle = null
  planMyRoomRoute()
})
$('roomDestOther').addEventListener('click', () => {
  mySettings = { ...mySettings, use_home: false }
  renderDestMode()
  $('roomDestInput').focus()
  if (mySettings.dest_station_id) {
    saveRoomSettings({ use_home: false })
    roomMapHandle = null
    planMyRoomRoute()
  }
})

$('roomLocBtn').addEventListener('click', async () => {
  await enableLocation()
  planMyRoomRoute()
})

// 다 같이 일어날 시각 알람
$('roomAlarm').addEventListener('click', async () => {
  const on = !(mySettings && mySettings.alarm_on)
  if (on && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => {})
  }
  await saveRoomSettings({ alarm_on: on })
  if (on) {
    const g = groupDeadline(members)
    if (g) alarmDeadlines.set(roomId, { at: g.at, name: (currentRoom() || {}).place_label || '모임' })
  } else alarmDeadlines.delete(roomId)
  renderRoom()
  showToast(on ? '알람을 켰어요. 다 같이 일어날 시각 30분, 10분 전과 그 시각에 알려 드려요. (지금은 앱이 열려 있을 때만 울려요)' : '모임 알람을 껐어요.', 5000)
})

// 안심 귀가 체크
$('btnArrived').addEventListener('click', () =>
  runRoomAction(async () => {
    const me = members.find((m) => m.userId === uid)
    const arrived = !(me && me.status === 'arrived')
    await Rooms.setArrived(roomId, uid, arrived)
    await refreshRoom()
    showToast(arrived ? '귀가 완료를 모임에 알렸어요. 오늘도 안전하게 도착했네요.' : '귀가 완료를 취소했어요.', 3500)
  }, $('roomErr')),
)

$('roomCodeChip').addEventListener('click', () => {
  const room = currentRoom()
  if (room) shareRoom(room)
})

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

$('btnLeave').addEventListener('click', () => {
  if (!confirm('이 모임에서 나갈까요?')) return
  runRoomAction(async () => {
    await Rooms.leaveRoom(roomId)
    alarmDeadlines.delete(roomId)
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
      $('heroLead').textContent = '막차 타려면 이때 일어나기'
      $('heroTime').textContent = hhmm(b.leave)
      $('heroCount').textContent = `앞으로 ${left(r)}`
    }
    const pct = Math.max(0, Math.min(1, 1 - r / 3600)) * 100
    $('train').style.left = pct + '%'
    $('done').style.width = pct + '%'

    plans.forEach((p, i) => {
      const el = $('rs' + i)
      if (!el) return
      const rr = p.leave - now
      el.textContent = rr < 0 ? '놓침' : hhmm(p.leave)
      $('r' + i).classList.toggle('gone', rr < 0)
    })
  } else if (routesLoading) {
    document.body.dataset.level = 'calm'
    $('heroLead').innerHTML = loadingHtml('막차 계산 중이에요')
    $('heroTime').textContent = '--:--'
    $('heroCount').textContent = '시간표를 거꾸로 따라가며 일어날 시각을 찾고 있어요'
  } else {
    document.body.dataset.level = 'calm'
    $('heroLead').textContent = TRANSIT_CONNECTED ? '탈 수 있는 막차가 없어요' : '막차 정보를 불러올 수 없어요'
    $('heroTime').textContent = '--:--'
    $('heroCount').textContent = TRANSIT_CONNECTED ? '' : '교통 정보 연결 후 출발 시각이 계산돼요'
  }

  $('heroTime').classList.toggle('loading', routesLoading && !b)

  checkRouteAlarms(now)
  roomTick()
  checkRoomAlarms()
}

function updateLastRest(now) {
  document.querySelectorAll('.lt-rest').forEach((el) => {
    el.textContent = restText(Number(el.dataset.min), now / 60)
  })
}

function rerender() {
  renderMe()
  renderLive()
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
  if (v === 'group' && inRoom) {
    refreshRoom()
    planMyRoomRoute()
  }
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
    hideBoot()
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
  const params = new URLSearchParams(location.search)
  if (params.get('home') === 'edit') {
    editingHome = true
    screen = 'list'
    resetHomeSetup()
    params.delete('home')
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''))
  }
  renderMeScreen()
  // 새로고침해도 보던 경로 화면에 머문다
  const lastOpen = editingHome ? null : recall('lz_screen:' + uid)
  const opening = lastOpen && home && savedRoutes.some((r) => r.id === lastOpen) ? openRoute(lastOpen) : null
  hideBoot() // 경로 화면은 열어 두고, 막차 계산은 화면 안에서 '계산 중'으로 보여 준다
  if (opening) await opening

  renderWalk()
  renderMe()
  await loadRooms()
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
setInterval(renderLive, LIVE_REFRESH_MS)
// 실시간 연결이 끊겨도 모임 안의 멤버와 막차가 늦지 않게 가끔 다시 불러온다
setInterval(() => {
  if (!$('view-group').hidden && inRoom) refreshRoom()
}, 20000)
// 모임 안: 시간이 지나고 위치가 바뀌면 내 막차와 출발 시각을 다시 계산해 공유한다
setInterval(() => {
  if (!$('view-group').hidden && inRoom) planMyRoomRoute()
}, ROOM_REPLAN_MS)
// 알람을 켠 모임들의 다 같이 일어날 시각 (모임 화면 밖에서도)
pollRoomAlarms()
setInterval(pollRoomAlarms, ROOM_ALARM_POLL_MS)
// 알람을 켠 경로들 (열지 않은 경로도)
setInterval(pollRouteAlarms, ROUTE_ALARM_POLL_MS)

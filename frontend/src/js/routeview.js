// 경로 카드 그리기: 환승마다 구간(노선, 역, 막차 시각)과 환승 연결 여유를 타임라인으로 보여 준다
// 화면 로직과 분리한 순수 함수라서 계산 결과(plans)만 넣으면 HTML 문자열이 나온다
// 보여 주는 값은 전부 plans(= 교통 API 에서 받은 경로 + 역산 결과)에서 온다. 여기에 고정된 노선, 역, 시각은 없다

import { fm, hhmm } from './clock.js'

// 도착지가 내 집일 때 화면에 보이는 이름
const HOME_LABEL = '우리집'

// 환승 연결 여유가 이 분 이하면 '빠듯해요'로 강조한다 (기본 환승 여유 3분보다 작아야 눈에 띈다)
export const TIGHT_SLACK_MIN = 2

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 노선 색은 style 속성에 들어가므로 색 코드 모양일 때만 쓴다
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '')

const badge = (leg) => `<span class="badge"${safeColor(leg.c) ? ` style="--c:${safeColor(leg.c)}"` : ''}>${esc(leg.name)}</span>`

// 한 구간: 노선 배지, 탑승역 → 하차역, 출발과 도착 시각, 막차 표시
function rideItem(x, next) {
  const { leg, dep, arr, late } = x
  const color = safeColor(leg.c)
  const stations = [leg.from, leg.to].filter(Boolean).map(esc).join(' <i>→</i> ')
  const isOwnLast = dep === leg.deps[leg.deps.length - 1]

  let tag = ''
  if (!next) tag = '<span class="tag last">막차</span>'
  else if (isOwnLast) tag = '<span class="tag last">이 노선 막차</span>'
  else tag = `<span class="tag link">${esc(next.leg.name)} 막차에 맞춘 열차</span>`

  return (
    `<li class="ride"${color ? ` style="--c:${color}"` : ''}><time>${fm(dep)}</time>` +
    `<div class="ride-top">${badge(leg)}<span class="stations">${stations}</span></div>` +
    `<div class="ride-time"><span class="arr">${fm(arr)} 도착 · ${arr - dep}분</span></div>` +
    `<div class="ride-tags">${tag}${late ? `<span class="late">AI 예상 지연 최대 ${late}분</span>` : ''}</div>` +
    `</li>`
  )
}

// 환승: 어느 역에서 몇 분 걷고, 다음 열차까지 여유가 얼마나 남는지
function transferItem(x, next) {
  const slack = next.dep - (x.arr + x.leg.xfer)
  const tight = slack <= TIGHT_SLACK_MIN
  const where = x.leg.to ? `${esc(x.leg.to)} 환승` : '환승'
  return (
    `<li class="xfer"><time></time><div class="xfer-top">${where}<span class="walk"> · 걸어서 ${x.leg.xfer}분</span></div>` +
    `<div class="slack ${tight ? 'tight' : 'ok'}">${esc(next.leg.name)}까지 여유 ${slack}분${tight ? ' · 빠듯해요' : ''}</div></li>`
  )
}

const durationText = (min) => (min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`)

// 경로 하나의 요약 수치: 도착 시각, 환승 횟수, 걸리는 시간, 가장 빠듯한 환승 여유
function planFacts(p) {
  const first = p.legs[0]
  const last = p.legs[p.legs.length - 1]
  const arrive = last.arr
  let tightest = null
  p.legs.forEach((x, k) => {
    const next = p.legs[k + 1]
    if (!next) return
    const slack = next.dep - (x.arr + x.leg.xfer)
    tightest = tightest === null ? slack : Math.min(tightest, slack)
  })
  return { arrive, transfers: p.legs.length - 1, total: arrive - (first.dep - p.walk), tightest }
}

function timelineHtml(p, trip, ai) {
  let why = ''
  p.legs.forEach((x, k) => {
    if (k < p.legs.length - 1 && x.raw !== null && x.raw !== x.dep) {
      why = `시간표상 ${fm(x.raw)} 열차도 있지만, 늦게 도착하면 다음 막차를 놓칠 수 있어 ${fm(x.dep)} 열차로 잡았어요.`
    }
  })

  let steps = ''
  p.legs.forEach((x, k) => {
    const next = p.legs[k + 1]
    steps += rideItem(x, next)
    if (next) steps += transferItem(x, next)
  })

  const last = p.legs[p.legs.length - 1]
  const arrive = last.arr
  const from = trip && trip.from ? trip.from.name : ''
  const to = trip && trip.to ? (trip.to.isHome ? HOME_LABEL : trip.to.name) : ''
  return (
    `<ol class="timeline">` +
    `<li class="node start"><time>${hhmm(p.leave)}</time><div class="node-name">${esc(from) || '출발'}</div>` +
    `<div class="node-sub">${p.route.board ? `${esc(p.route.board)}까지 ` : ''}걸어서 ${p.walk}분</div></li>` +
    steps +
    `<li class="node end"><time>${fm(arrive)}</time><div class="node-name">${esc(to) || '도착'}</div><div class="node-sub">${fm(arrive)} 도착</div></li>` +
    `</ol>${why && ai ? `<p class="why">${esc(why)}</p>` : ''}`
  )
}

// i: 이 경로의 번호(tick 이 출발까지 남은 시간을 채우는 자리의 id 가 된다), collapsible: 접어 두는 카드
function routeItem(p, i, trip, ai, collapsible) {
  const f = planFacts(p)
  const tight = f.tightest !== null && f.tightest <= TIGHT_SLACK_MIN
  const head =
    `<div class="route-head"><div class="route-info">` +
    `<div class="chips">${p.legs.map((x) => badge(x.leg)).join('<span class="sep">›</span>')}${i === 0 ? '<span class="pick">가장 늦게 출발 가능</span>' : ''}</div>` +
    `<div class="route-meta">${f.transfers ? `환승 ${f.transfers}회` : '환승 없음'} · 소요 ${durationText(f.total)} · ${fm(f.arrive)} 도착</div>` +
    (f.tightest !== null
      ? `<div class="route-meta"><span class="slack ${tight ? 'tight' : 'ok'}">가장 빠듯한 환승 여유 ${f.tightest}분</span></div>`
      : '') +
    `</div><div class="route-leave"><small>일어나기</small><span class="st" id="rs${i}"></span></div></div>`
  const body = timelineHtml(p, trip, ai)
  return collapsible
    ? `<li class="route alt" id="r${i}"><details><summary>${head}</summary>${body}</details></li>`
    : `<li class="route" id="r${i}">${head}${body}</li>`
}

// 지도 위 출발 카드에 붙는 노선 칩: 1호선 › 서해선 · 환승 1번
export function lineChipsHtml(p) {
  if (!p) return ''
  const n = p.legs.length - 1
  return (
    p.legs.map((x) => badge(x.leg)).join('<span class="sep">›</span>') +
    `<span class="chips-meta">${n ? `환승 ${n}번` : '환승 없음'} · ${fm(p.legs[n].arr)} 도착</span>`
  )
}

// plans: 늦게 출발할 수 있는 순서. startIndex: 첫 카드의 번호
export function routeCardsHtml(plans, trip, ai, startIndex = 0, collapsible = false) {
  return plans.map((p, k) => routeItem(p, startIndex + k, trip, ai, collapsible)).join('')
}

// 보여 줄 경로가 없을 때의 안내. connected: 교통 정보 연결 여부, note: 서버가 알려 준 이유
export function routesEmptyHtml(trip, connected, note = '') {
  const from = trip && trip.from ? esc(trip.from.name) : '출발지'
  const to = trip && trip.to ? esc(trip.to.isHome ? HOME_LABEL : trip.to.name) : '도착지'
  const msg = note
    ? esc(note)
    : connected
    ? `오늘 밤 ${from}에서 ${to}까지 탈 수 있는 경로가 없어요.`
    : `교통 정보 연결이 끝나면 ${from}에서 ${to}까지 탈 수 있는 막차가 여기에 나와요.`
  return `<li class="route-empty">${msg}</li>`
}

/* ---------- 역별 막차 (행마다 마지막 열차) ---------- */

// 막차까지 남은 시간. minutes: 막차 시각(서비스 날 기준 분), nowMin: 지금(같은 기준 분)
export function restText(minutes, nowMin) {
  const d = Math.round(minutes - nowMin)
  if (d < 0) return '지났어요'
  if (d >= 60) return `${Math.floor(d / 60)}시간 ${d % 60}분 남음`
  return `${d}분 남음`
}

// data: 백엔드 /last-trains 응답 { day, trains: [{ end, last, minutes, count }] }
export function lastBoxHtml(label, data) {
  const rows = data.trains
    .map(
      (t) =>
        `<li><span class="dest">${esc(t.end)}행</span>` +
        `<span class="when"><b>${esc(t.last)}</b><small class="lt-rest" data-min="${t.minutes}"></small></span>` +
        `<span class="cnt">${t.count}회 운행</span></li>`,
    )
    .join('')
  return (
    `<div class="lt-head"><b>${esc(label)}</b><span>${esc(data.day)} 막차</span></div>` +
    (rows ? `<ul class="last-list">${rows}</ul>` : '<p class="sp-load">이 역의 운행 정보가 없어요.</p>')
  )
}

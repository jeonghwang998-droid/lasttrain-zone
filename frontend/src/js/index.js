// index.html 담당: 나 / 우리 테이블 / 내 걸음 화면, 시연용 시계

import { WD, PLACES, HOMES, toMin } from './data.js'
import { S, clock } from './state.js'
import { hhmm, fm, left, nowSec, rebase } from './clock.js'
import { plansFor, speedInfo, VALID } from './planner.js'
import { initApp, url } from './app.js'
import { getUser, getPrefs } from './account.js'

initApp()

const $ = (id) => document.getElementById(id)

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const todayWd = (new Date().getDay() + 6) % 7

let plans = [] // AI 보정 반영 경로
let rawPlans = [] // 시간표만 본 경로

function fillSelect(el, obj, val) {
  el.innerHTML = Object.keys(obj)
    .map((k) => `<option value="${k}"${k === val ? ' selected' : ''}>${obj[k]}</option>`)
    .join('')
}

/* ---------- 나 ---------- */
function renderMe() {
  plans = plansFor(S.home, S.ai)
  rawPlans = plansFor(S.home, false)

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
          steps += `<li style="--dot:${x.leg.c}">${fm(x.dep)} ${x.leg.name}${sub}</li>`
        })
        return (
          `<li id="r${i}"><div class="head"><span class="via">${r.name}${i === 0 ? '<span class="pick">가장 늦게 출발 가능</span>' : ''}</span><span class="st" id="rs${i}"></span></div>` +
          `<div class="meta">${r.board}까지 ${r.walkM}m, 걸어서 ${p.walk}분</div>` +
          `<ol class="legs">${steps}</ol>${why && S.ai ? `<p class="why">${why}</p>` : ''}</li>`
        )
      })
      .join('') || '<li class="meta">이 구간은 오늘 밤 탈 수 있는 경로가 없어요. 출발지나 집을 바꿔보세요.</li>'

  const d = $('diff')
  if (S.ai && plans[0] && rawPlans[0]) {
    const gap = Math.round((rawPlans[0].leave - plans[0].leave) / 60)
    d.hidden = false
    d.innerHTML =
      gap > 0
        ? `시간표만 보면 ${hhmm(rawPlans[0].leave)}에 일어나도 되지만, 오늘 밤 ${S.trips.length ? '지연 위험과 내 걸음 속도를' : '지연 위험을'} 반영해 <b>${gap}분 앞당겼어요.</b>`
        : 'AI 보정을 반영해도 시간표 기준과 같아요. 오늘 밤은 지연 위험이 낮아요.'
  } else {
    d.hidden = true
  }
  tick()
}

/* ---------- 우리 테이블 ---------- */
function renderGroup() {
  const list = [{ id: 0, name: '나', home: S.home }, ...S.friends]
    .map((f) => {
      const b = plansFor(f.home, S.ai)[0]
      return { id: f.id, name: f.name, home: f.home, leave: b ? b.leave : Infinity }
    })
    .sort((a, b) => a.leave - b.leave)

  $('people').innerHTML = list
    .map(
      (f, i) =>
        `<li><span class="rank">${i + 1}</span><div><div class="who">${esc(f.name)}</div><div class="home">${HOMES[f.home]}${isFinite(f.leave) ? `, ${hhmm(f.leave)}까지 출발` : ''}</div></div><span class="left" data-leave="${f.leave}"></span>${f.id ? `<button class="x" data-id="${f.id}" aria-label="${esc(f.name)} 빼기">빼기</button>` : '<span></span>'}</li>`,
    )
    .join('')
  tick()
}

/* ---------- 내 걸음 ---------- */
function renderWalk() {
  const s = speedInfo()
  $('speed').innerHTML = `${Math.round(s.speed)}<small>m/분</small>`
  $('formula').textContent = s.n
    ? `(평균 75 × 5 + 내 기록 중앙값 ${s.mine.toFixed(1)} × ${s.n}) ÷ (5 + ${s.n})`
    : '기록이 없어서 전체 평균 75m/분을 써요.'
  $('trips').innerHTML = S.trips
    .map((t, i) => {
      const v = t.d / t.m
      const bad = v < VALID[0] || v > VALID[1]
      return `<li class="${bad ? 'bad' : ''}"><span>${t.d}m, ${t.m}분 → ${v.toFixed(1)}m/분${bad ? '<span class="tag">제외</span>' : ''}</span><button class="x" data-i="${i}" aria-label="기록 지우기">지우기</button></li>`
    })
    .join('')
}

/* ---------- 알림 토스트 ---------- */
let toastTimer
function showToast(msg) {
  $('toastText').textContent = msg
  $('toast').classList.add('show')
  try {
    navigator.vibrate && navigator.vibrate([200, 100, 200])
  } catch (e) {
    /* 진동 미지원 */
  }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 7000)
}

const MSG = {
  30: '30분 남았어요. 슬슬 정리할 타이밍이에요.',
  10: '10분 남았어요. 계산부터 하세요.',
  0: '지금 일어나야 막차 타요!',
}

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

    const key = [S.from, S.home, S.buffer, S.ai, S.wd, S.rain, b.leave].join('|')
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
    document.body.dataset.level = 'missed'
    $('heroLead').textContent = '경로가 없어요'
    $('heroTime').textContent = '--:--'
    $('heroCount').textContent = ''
  }

  document.querySelectorAll('.people .left').forEach((el) => {
    const lv = Number(el.dataset.leave)
    el.textContent = isFinite(lv) ? left(lv - now) : '경로 없음'
  })
}

function rerender() {
  renderMe()
  renderGroup()
}

function setView(v) {
  ;['me', 'group', 'walk'].forEach((n) => {
    $('view-' + n).hidden = n !== v
    $('tab-' + n).setAttribute('aria-pressed', n === v)
  })
  if (v === 'group') renderGroup()
  if (v === 'walk') renderWalk()
}

// 시연용 시계 속도 전환 (실시간 / 1초에 1분 / 실제 시각)
function setSpeed(btn, speed, real) {
  rebase()
  if (!real && clock.wasReal) {
    clock.base = toMin($('start').value || '22:00') * 60
    clock.t0 = performance.now()
  }
  clock.speed = speed
  clock.real = !!real
  clock.wasReal = !!real
  ;['sp1', 'sp60', 'spReal'].forEach((id) => $(id).setAttribute('aria-pressed', id === btn))
  $('start').disabled = !!real
  S.fired = {}
  tick()
}

/* ---------- 상단 로그인 영역 ---------- */
function renderAuth() {
  const user = getUser()
  $('authArea').innerHTML = user
    ? `<a href="${url('html/profile.html')}" class="avatar" aria-label="내 정보">${esc(user.nickname.slice(0, 1))}</a>`
    : `<a href="${url('html/login.html')}" class="btn btn-sm">로그인</a><a href="${url('html/signup.html')}" class="btn btn-sm btn-primary">회원가입</a>`
}

/* ---------- 초기화와 이벤트 ---------- */
renderAuth()
fillSelect($('from'), PLACES, S.from)
fillSelect($('home'), HOMES, S.home)
$('buffer').value = S.buffer
fillSelect($('fhome'), HOMES, 'suwon')
$('wd').innerHTML = WD.map(
  (w, i) => `<option value="${i}"${i === S.wd ? ' selected' : ''}>${w}${i === todayWd ? ' (오늘)' : ''}</option>`,
).join('')
$('rain').value = S.rain

$('from').addEventListener('change', (e) => { S.from = e.target.value; rerender() })
$('home').addEventListener('change', (e) => { S.home = e.target.value; rerender() })
$('buffer').addEventListener('input', (e) => { S.buffer = Number(e.target.value); rerender() })
$('wd').addEventListener('change', (e) => { S.wd = Number(e.target.value); rerender() })
$('rain').addEventListener('input', (e) => { S.rain = Number(e.target.value); rerender() })
$('ai').addEventListener('click', (e) => {
  S.ai = !S.ai
  e.currentTarget.setAttribute('aria-pressed', S.ai)
  rerender()
})

$('tab-me').addEventListener('click', () => setView('me'))
$('tab-group').addEventListener('click', () => setView('group'))
$('tab-walk').addEventListener('click', () => setView('walk'))
$('toastClose').addEventListener('click', () => $('toast').classList.remove('show'))

$('start').addEventListener('change', (e) => {
  if (!e.target.value) return
  clock.base = toMin(e.target.value) * 60
  clock.t0 = performance.now()
  S.fired = {}
  tick()
})
$('sp1').addEventListener('click', () => setSpeed('sp1', 1))
$('sp60').addEventListener('click', () => setSpeed('sp60', 60))
$('spReal').addEventListener('click', () => setSpeed('spReal', 1, true))

$('fname').addEventListener('input', () => { $('ferr').textContent = '' })
$('fadd').addEventListener('click', () => {
  const n = $('fname').value.trim()
  if (!n) {
    $('ferr').textContent = '이름을 입력하세요.'
    return
  }
  S.friends.push({ id: S.nextId++, name: n, home: $('fhome').value })
  $('fname').value = ''
  renderGroup()
})
$('people').addEventListener('click', (e) => {
  const id = e.target.dataset && e.target.dataset.id
  if (!id) return
  S.friends = S.friends.filter((f) => String(f.id) !== id)
  renderGroup()
})

;[$('tdist'), $('tmin')].forEach((el) => el.addEventListener('input', () => { $('terr').textContent = '' }))
$('tadd').addEventListener('click', () => {
  const d = Number($('tdist').value)
  const m = Number($('tmin').value)
  if (!(d > 0) || !(m > 0)) {
    $('terr').textContent = '거리(m)와 걸린 시간(분)을 둘 다 0보다 크게 입력하세요.'
    return
  }
  S.trips.push({ d: Math.round(d), m: Math.round(m * 10) / 10 })
  $('tdist').value = ''
  $('tmin').value = ''
  renderWalk()
  rerender()
})
$('tsample').addEventListener('click', () => {
  S.trips.push({ d: 820, m: 15.5 }, { d: 640, m: 11.8 }, { d: 900, m: 17 }, { d: 700, m: 30 })
  renderWalk()
  rerender()
})
$('trips').addEventListener('click', (e) => {
  const i = e.target.dataset && e.target.dataset.i
  if (i === undefined) return
  S.trips.splice(Number(i), 1)
  renderWalk()
  rerender()
})

renderWalk()
rerender()
setInterval(tick, 250)

// 핵심 계산: 지연 예측 조회, 보행 속도 추정, 막차 역산

import { Q90, RAIN_BINS, HOUR_IDX } from './data.js'
import { S } from './state.js'

// 학습된 q90 예측표에서 지연(분)을 읽는다. 강수량은 구간 사이를 선형 보간
function q90(line, hour, wd, rain) {
  const t = Q90[line]
  if (!t) return 0
  let hi = HOUR_IDX[hour]
  if (hi === undefined) hi = hour >= 2 && hour < 4 ? 4 : 0
  const row = t[hi][wd]
  const r = Math.min(Math.max(rain, 0), 30)
  for (let k = 0; k < RAIN_BINS.length - 1; k++) {
    if (r <= RAIN_BINS[k + 1]) {
      const a = RAIN_BINS[k]
      const b = RAIN_BINS[k + 1]
      return row[k] + ((row[k + 1] - row[k]) * (r - a)) / (b - a)
    }
  }
  return row[row.length - 1]
}

// 이 구간을 dep(분)에 출발했을 때 예상 최대 지연 (0~15분)
function lateFor(leg, dep) {
  if (!leg.line) return 0
  const hour = Math.floor((dep + leg.ride) / 60) % 24
  return Math.round(Math.min(Math.max(q90(leg.line, hour, S.wd, S.rain), 0), 15))
}

/* ---------- 막차 역산 ---------- */
// 마지막 구간의 막차에서 거꾸로 올라가며, 다음 구간에 늦지 않는 가장 늦은 열차를 고른다
export function planRoute(route, useAI) {
  let deadline = null
  const out = []
  for (let i = route.legs.length - 1; i >= 0; i--) {
    const leg = route.legs[i]
    let pick = null
    let late = 0
    let raw = null // 지연을 고려하지 않았을 때 고를 열차
    if (deadline === null) {
      pick = leg.deps[leg.deps.length - 1]
    } else {
      for (let j = leg.deps.length - 1; j >= 0; j--) {
        const dep = leg.deps[j]
        if (dep + leg.ride + leg.xfer > deadline) continue
        if (raw === null) raw = dep
        const lt = useAI ? lateFor(leg, dep) : 0
        if (dep + leg.ride + leg.xfer + lt <= deadline) {
          pick = dep
          late = lt
          break
        }
      }
      if (pick === null) return null
    }
    out.unshift({ leg, dep: pick, late, raw })
    deadline = pick
  }
  const speed = (useAI ? S.walkSpeed : S.walkDefault) || S.walkDefault || 1
  const walk = Math.max(1, Math.ceil(route.walkM / speed))
  return { route, legs: out, walk, leave: (out[0].dep - walk - S.buffer) * 60 }
}

// 가져온 경로들 중 탈 수 있는 것만, 늦게 출발 가능한 순으로
export function plansFor(routes, useAI) {
  return routes
    .map((r) => planRoute(r, useAI))
    .filter(Boolean)
    .sort((a, b) => b.leave - a.leave)
}

"""막차 역산 알고리즘

핵심 아이디어: 마지막 구간의 막차에서 출발해 거꾸로(역방향) 거슬러 올라가며
각 구간에서 '탈 수 있는 가장 늦은 열차'를 찾고, 마지막에 도보 시간과 여유 시간을 뺀다.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from math import asin, ceil, cos, radians, sin, sqrt

WALK_M_PER_MIN = 75   # 평균 보행 속도 약 4.5km/h
DETOUR = 1.3          # 직선거리를 실제 걷는 거리로 보정하는 계수
SERVICE_DAY_START = 4 # 새벽 4시 전 시각은 전날 운행일로 취급


# ---------- 시간 유틸 ----------
def to_min(hhmm: str) -> int:
    """'23:40' -> 1420, '00:15' -> 1455 (자정을 넘긴 막차도 크기 비교가 되도록)"""
    h, m = map(int, hhmm.split(":"))
    t = h * 60 + m
    return t + 1440 if h < SERVICE_DAY_START else t


def fmt(t: int) -> str:
    t %= 1440
    return f"{t // 60:02d}:{t % 60:02d}"


# ---------- 도보 시간 ----------
def walk_minutes(lat1: float, lng1: float, lat2: float, lng2: float,
                 m_per_min: float = WALK_M_PER_MIN) -> int:
    """두 좌표 사이 직선거리(하버사인)를 걷는 시간(분)으로 환산"""
    r = 6_371_000
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = p2 - p1, radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    meters = 2 * r * asin(sqrt(a)) * DETOUR
    return max(1, ceil(meters / m_per_min))


# ---------- 데이터 구조 ----------
@dataclass
class Leg:
    """경로의 한 구간 (환승 한 번마다 구간이 하나씩 늘어남)"""
    name: str
    departures: list[int]   # 이 구간 탑승역의 출발 시각(분), 오름차순
    ride: int               # 탑승 시간(분)
    transfer_walk: int = 0  # 내린 뒤 다음 구간 타는 곳까지 환승 도보(분)
    line: str = ""          # 지연 예측 모델에 넘길 노선명 (예: "1호선")


@dataclass
class Route:
    name: str
    board_lat: float  # 첫 탑승 정류장/역 좌표
    board_lng: float
    legs: list[Leg]


@dataclass
class Plan:
    route: Route
    leave_at: int          # 지금 있는 곳에서 일어나야 하는 시각
    boardings: list[int]   # 구간별 실제 탑승 시각
    walk: int              # 탑승역까지 도보(분)


# ---------- 핵심: 역산 ----------
def latest_boardings(legs: list[Leg], extra_delay=None) -> list[int] | None:
    """마지막 구간부터 거꾸로 올라가며 구간별 '가장 늦게 탈 수 있는 열차'를 구한다.
    중간에 이어지지 않는 구간이 있으면 None.
    extra_delay(leg, dep) -> 분: 이 열차가 환승역에 늦게 도착할 예상치 (ML 모델이 제공)"""
    deadline: int | None = None
    boardings: list[int] = []

    for leg in reversed(legs):
        if deadline is None:
            dep = leg.departures[-1]  # 마지막 구간은 막차 그 자체
        else:
            # dep + ride + transfer_walk <= deadline 을 만족하는 가장 늦은 dep
            limit = deadline - leg.ride - leg.transfer_walk
            i = bisect_right(leg.departures, limit)  # 이진 탐색 O(log T)
            # 지연은 0 이상이라 답은 i-1 이하에 있음 -> 거기서부터 지연까지 넣어 확인
            dep = None
            for j in range(i - 1, -1, -1):
                cand = leg.departures[j]
                late = extra_delay(leg, cand) if extra_delay else 0
                if cand + leg.ride + leg.transfer_walk + late <= deadline:
                    dep = cand
                    break
            if dep is None:
                return None  # 이 구간에서 다음 구간 막차에 맞출 열차가 없음
        boardings.append(dep)
        deadline = dep  # 이전 구간은 이 시각까지 도착해야 함

    return boardings[::-1]


def plan_route(route: Route, lat: float, lng: float, buffer: int,
               extra_delay=None, m_per_min: float = WALK_M_PER_MIN) -> Plan | None:
    boardings = latest_boardings(route.legs, extra_delay)
    if boardings is None:
        return None
    walk = walk_minutes(lat, lng, route.board_lat, route.board_lng, m_per_min)
    return Plan(route, boardings[0] - walk - buffer, boardings, walk)


def best_plan(routes: list[Route], lat: float, lng: float, now: int, buffer: int = 5, **kw) -> Plan | None:
    """아직 탈 수 있는 경로 중 '가장 늦게 일어나도 되는' 경로를 고른다."""
    plans = [p for r in routes if (p := plan_route(r, lat, lng, buffer, **kw))]
    alive = [p for p in plans if p.leave_at >= now]
    return max(alive, key=lambda p: p.leave_at) if alive else None


def alert_times(plan: Plan, now: int, offsets=(30, 10, 0)) -> list[tuple[int, int]]:
    """(알림 보낼 시각, 몇 분 전 알림인지). 이미 지난 알림은 제외 -> 스케줄러 큐에 넣을 값"""
    return [(plan.leave_at - o, o) for o in offsets if plan.leave_at - o >= now]

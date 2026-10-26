"""택시비 추정 (README 6-5)

직선거리 × 도로 보정 계수로 주행 거리를 추정하고, 요금 공식으로 계산한다.
요금 기준값은 지역/시기별로 다르니 실제 값을 확인해서 FARE 에 넣을 것.
"""
from __future__ import annotations

ROAD_FACTOR = 1.35  # 직선거리 → 실제 도로 거리 보정

FARE = {
    "base_fare": 0,          # TODO: 기본요금 (원)
    "base_distance_m": 0,    # TODO: 기본 거리
    "unit_distance_m": 0,    # TODO: 추가 요금 단위 거리
    "unit_fare": 0,          # TODO: 단위당 요금
    "night_surcharge": {},   # TODO: {시작 시: 할증률} 예) {22: 0.2, 23: 0.4, 2: 0.2}
}


def estimate_fare(straight_m: float, hour: int) -> int:
    """TODO: 거리 요금 + 심야 할증 → 100원 단위 반올림"""
    raise NotImplementedError

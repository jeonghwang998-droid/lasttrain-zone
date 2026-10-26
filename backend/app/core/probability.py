"""막차 확률 (README 6-4)

분위수 모델(q50, q70, q90, q95)의 예측 지연과 환승 여유 시간을 비교한다.
"""
from __future__ import annotations

QUANTILES = (0.5, 0.7, 0.9, 0.95)


def leg_success_probability(slack_min: float, predicted: dict[float, float]) -> float:
    """slack_min: 환승 여유(분), predicted: {분위수: 예측 지연(분)}

    예) q90=4분 ≤ 여유 5분 < q95=7분 → 0.9
    TODO: 여유가 q50 보다도 작으면 0.5 미만 → 낮은 값(예: 0.3)으로 처리할지 팀에서 결정
    """
    raise NotImplementedError


def route_probability(leg_probs: list[float]) -> float:
    """환승이 여러 번이면 구간별 확률을 곱한다"""
    p = 1.0
    for x in leg_probs:
        p *= x
    return p

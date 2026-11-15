"""막차 확률: 분위수 예측 지연과 환승 여유를 비교한다

정의
- 환승 여유(분)  = 다음 구간 출발 − (이번 열차 도착 예정 + 환승 도보 시간)
- 구간 확률      = P(이번 열차 지연 ≤ 환승 여유)
- 경로 확률      = 구간 확률의 곱
- 갈아탈 막차는 정시에 떠난다고 본다 (늦게 떠나 주는 덕을 기대하지 않는 보수적 가정)

한계 (확률을 읽을 때 주의)
- 구간끼리 독립이라고 본다. 실제로는 비 오는 밤처럼 여러 구간이 함께 늦는 일이 많아서
  경로 확률이 실제보다 조금 높게 나올 수 있다
- 분위수 사이는 직선으로 잇는다 (지연 분포를 몇 개 점으로만 알기 때문)
- 학습한 가장 높은 분위수(예: 0.95)보다 높은 확률은 말하지 않는다 (그 위 꼬리는 모른다)
"""
from __future__ import annotations

GRADES = ("안전", "주의", "위험", "데이터부족")


def transfer_slack(arrive_min: float, walk_min: float, next_depart_min: float) -> float:
    """환승 여유(분). 음수면 시간표대로 와도 못 갈아탄다"""
    return next_depart_min - (arrive_min + walk_min)


def sorted_quantiles(predicted: dict[float, float]) -> list[tuple[float, float]]:
    """분위수 예측값을 분위수 순으로 정렬하고, 위 분위수가 아래보다 작아지는 교차를 없앤다
    (분위수마다 따로 학습한 모델이라 가끔 q90 < q70 처럼 뒤집힌다 → 앞의 값 이상으로 끌어올린다)"""
    out: list[tuple[float, float]] = []
    top = float("-inf")
    for q in sorted(predicted):
        top = max(top, float(predicted[q]))
        out.append((float(q), top))
    return out


def leg_success_probability(slack_min: float, predicted: dict[float, float] | None) -> float | None:
    """P(지연 ≤ 여유). predicted: {분위수: 예측 지연(분)}. 예측이 없으면 None (데이터 부족)

    분위수 점 (지연 v_i, 확률 q_i) 를 직선으로 이은 누적분포에서 읽는다.
    - 여유가 가장 낮은 분위수 값보다 작으면: 첫 구간의 기울기로 0 까지 이어 내린다
    - 여유가 가장 높은 분위수 값 이상이면: 가장 높은 분위수 (그 위는 모르니 더 높게 말하지 않는다)
    """
    if not predicted:
        return None
    pts = sorted_quantiles(predicted)
    if len(pts) == 1:
        q, v = pts[0]
        return q if slack_min >= v else 0.0

    # 같은 지연 값에 여러 분위수가 겹치면 (교차를 없애며 생긴 평평한 곳) 가장 높은 분위수를 쓴다
    xs: list[float] = []
    ps: list[float] = []
    for q, v in pts:
        if xs and v == xs[-1]:
            ps[-1] = q
        else:
            xs.append(v)
            ps.append(q)

    if slack_min >= xs[-1]:
        return ps[-1]
    if len(xs) == 1:  # 모든 분위수가 같은 값 → 그보다 작으면 모른다고 보지 않고 0
        return 0.0
    if slack_min < xs[0]:
        slope = (ps[1] - ps[0]) / (xs[1] - xs[0])
        return max(0.0, ps[0] - slope * (xs[0] - slack_min))
    for i in range(len(xs) - 1):
        if xs[i] <= slack_min < xs[i + 1]:
            t = (slack_min - xs[i]) / (xs[i + 1] - xs[i])
            return ps[i] + t * (ps[i + 1] - ps[i])
    return ps[-1]


def route_probability(leg_probs: list[float | None]) -> float | None:
    """환승이 여러 번이면 구간별 확률을 곱한다. 한 구간이라도 모르면 경로 확률도 모른다(None).
    환승이 없는 경로(빈 목록)는 갈아탈 일이 없으니 1"""
    p = 1.0
    for x in leg_probs:
        if x is None:
            return None
        p *= x
    return p


def grade(probability: float | None, thresholds: dict) -> str:
    """thresholds: app_config probability.grade_thresholds ({"safe": .., "caution": ..})"""
    if probability is None:
        return "데이터부족"
    if probability >= thresholds["safe"]:
        return "안전"
    if probability >= thresholds["caution"]:
        return "주의"
    return "위험"

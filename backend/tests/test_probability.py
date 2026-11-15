import pytest

from app.core.probability import (
    grade,
    leg_success_probability,
    route_probability,
    sorted_quantiles,
    transfer_slack,
)

# 시험용 분위수 예측 (분): 보통 1분, 10번 중 9번은 4분 안, 20번 중 19번은 7분 안
PRED = {0.5: 1.0, 0.7: 2.0, 0.9: 4.0, 0.95: 7.0}
THRESHOLDS = {"safe": 0.9, "caution": 0.7}


def test_transfer_slack():
    # 23:34 도착, 4분 걸어 갈아타고, 23:39 출발 → 여유 1분
    assert transfer_slack(23 * 60 + 34, 4, 23 * 60 + 39) == 1


def test_sorted_quantiles_removes_crossing():
    # q90 이 q70 보다 작게 나온 경우 → q70 값으로 끌어올린다
    assert sorted_quantiles({0.9: 1.5, 0.5: 1.0, 0.7: 2.0}) == [(0.5, 1.0), (0.7, 2.0), (0.9, 2.0)]


def test_exact_quantile_points():
    assert leg_success_probability(1.0, PRED) == pytest.approx(0.5)
    assert leg_success_probability(4.0, PRED) == pytest.approx(0.9)


def test_linear_between_quantiles():
    # 4분과 7분 사이 가운데(5.5분) → 0.9 와 0.95 의 가운데
    assert leg_success_probability(5.5, PRED) == pytest.approx(0.925)
    assert leg_success_probability(3.0, PRED) == pytest.approx(0.8)


def test_above_top_quantile_is_capped():
    # 여유가 아무리 커도 학습한 가장 높은 분위수보다 높게 말하지 않는다
    assert leg_success_probability(30.0, PRED) == pytest.approx(0.95)


def test_below_bottom_quantile_extrapolates_down_to_zero():
    # 첫 구간 기울기 (0.7-0.5)/(2-1)=0.2 로 내려간다: 0분 → 0.3, 아주 작으면 0
    assert leg_success_probability(0.0, PRED) == pytest.approx(0.3)
    assert leg_success_probability(-10.0, PRED) == 0.0


def test_crossing_flat_region_uses_highest_quantile():
    # q70 과 q90 이 같은 값(교차 정리 후) → 그 값의 여유면 0.9
    assert leg_success_probability(2.0, {0.5: 1.0, 0.7: 2.0, 0.9: 1.5}) == pytest.approx(0.9)


def test_monotone_in_slack():
    probs = [leg_success_probability(s / 2, PRED) for s in range(-10, 30)]
    assert all(a <= b for a, b in zip(probs, probs[1:]))


def test_missing_prediction_is_none():
    assert leg_success_probability(5.0, None) is None
    assert leg_success_probability(5.0, {}) is None


def test_route_probability_multiplies():
    assert route_probability([0.9, 0.9]) == pytest.approx(0.81)
    assert route_probability([]) == 1.0
    assert route_probability([0.9, None]) is None


def test_grade():
    assert grade(0.95, THRESHOLDS) == "안전"
    assert grade(0.9, THRESHOLDS) == "안전"
    assert grade(0.8, THRESHOLDS) == "주의"
    assert grade(0.5, THRESHOLDS) == "위험"
    assert grade(None, THRESHOLDS) == "데이터부족"

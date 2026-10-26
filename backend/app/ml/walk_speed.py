"""개인 보행 속도 학습

문제: 처음 쓰는 사람은 기록이 없고, 기록 1~2개로 속도를 정하면 너무 들쭉날쭉하다.
해결: 베이지안 축소 추정(shrinkage)
      개인 속도 = (전체 평균 x K + 내 기록 합) / (K + 내 기록 수)
      기록이 적을 땐 전체 평균에 가깝고, 기록이 쌓일수록 내 속도로 옮겨간다.

기록 방법: 앱에서 '출발' 알림을 누른 시각과 위치 -> 역 반경 50m 안에 들어온 시각과 위치
          거리(m) / 걸린 시간(분) = 그 날의 보행 속도
"""
from __future__ import annotations

from statistics import median

PRIOR_SPEED = 75.0   # 전체 평균 (m/분)
K = 5                # '전체 평균을 기록 5개만큼 믿는다'는 뜻
VALID = (35, 140)    # 이 범위를 벗어나면 편의점 들름/뛰어감/택시 등으로 보고 버림


def personal_speed(trips: list[tuple[float, float]]) -> float:
    """trips: [(거리 m, 걸린 시간 분), ...] -> 개인 보행 속도(m/분)"""
    speeds = [d / t for d, t in trips if t > 0 and VALID[0] <= d / t <= VALID[1]]
    if not speeds:
        return PRIOR_SPEED
    # 이상치에 덜 흔들리도록 평균 대신 중앙값으로 내 기록을 요약
    n, mine = len(speeds), median(speeds)
    return (PRIOR_SPEED * K + mine * n) / (K + n)


if __name__ == "__main__":
    history = [(820, 13.5), (640, 10.0), (900, 15.2), (700, 30.0)]  # 마지막은 편의점 들른 날 -> 제외됨
    for i in range(len(history) + 1):
        print(f"기록 {i}개 -> {personal_speed(history[:i]):.1f} m/분")

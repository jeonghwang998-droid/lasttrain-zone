"""개발용 가짜 지연 데이터 생성기

!!! 이 파일이 만드는 지연(delay_min)은 실제 기록이 아니라 꾸민 숫자다 !!!
실제 도착 기록(train_arrivals)이 쌓이기 전에 학습 → 리포트 → 서빙 흐름을 먼저 완성하려는 용도다.
가짜로 학습한 모델의 확률(예: 94%)은 의미가 없다. 발표나 화면에는 쓰지 않는다.

역, 열차번호, 시간표 시각은 진짜 KRIC 시간표(backend/data/kric/)에서 가져오고, 지연만 아래 규칙으로 만든다.
결과 칸은 DB 의 train_delays 뷰와 같다 → ml/dataset.py 가 --source fake / db 를 같은 모양으로 돌려준다.

실행 (저장소 맨 위 폴더에서):  python ml/make_fake_data.py   →  ml/data/fake_delays.csv
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import kric_network as net  # noqa: E402

OUT = ROOT / "ml" / "data" / "fake_delays.csv"
REGION = "01"  # 수도권
SEED = 42

# ---- 가짜 데이터를 만드는 규칙 (실제 정책값이 아니라 꾸민 세상의 설정이다) ----
START = date(2026, 8, 1)
DAYS = 75
NIGHT_FROM_MIN, NIGHT_TO_MIN = 21 * 60, 25 * 60 + 30  # 21:00 ~ 다음 날 01:30 도착 열차만
# 노선별 지연 성향: (평균적으로 늦는 분, 흔들림). 역은 노선마다 이 이름들 중 있는 것만 쓴다
LINES = {
    "수도권 1호선": (1.2, 1.6, ["신도림", "금정", "부평", "소사", "수원"]),
    "수도권 4호선": (0.7, 0.9, ["사당", "금정", "초지", "고잔"]),
    "수도권 2호선": (0.4, 0.6, ["신도림", "사당", "홍대입구", "강남"]),
    "7호선": (0.5, 0.7, ["온수", "부평구청", "가산디지털단지"]),
    "수인분당": (0.9, 1.2, ["초지", "고잔", "중앙", "수원"]),
    "서해선": (0.6, 0.8, ["소사", "초지", "시흥대야"]),
}
LATE_NIGHT_PER_HOUR = 0.25  # 밤이 깊을수록 시간당 이만큼 더 늦는다
FRI_SAT_EXTRA = 0.6  # 금·토 밤 (다음 날 쉬는 날) 추가 지연
STATION_SPREAD = 0.4  # 역마다 다른 성향의 흔들림
INCIDENT_RATE = 0.015  # 사고·장애로 크게 늦는 비율
INCIDENT_MIN, INCIDENT_MAX = 5, 40  # 큰 지연 범위 (일부는 유효 범위 밖이라 학습에서 빠진다)


def day_code(d: date) -> str:
    return "9" if d.weekday() >= 5 else "8"  # 토·일은 휴일 시간표 (train_delays 뷰와 같은 규칙)


def main() -> None:
    rng = np.random.default_rng(SEED)
    lines = net.load_lines(REGION)
    tables = {code: net.load_timetable(REGION, code) for code in ("8", "9")}
    if not lines or not all(tables.values()):
        raise SystemExit("KRIC 시간표가 없어요. backend 에서 python build_network.py 로 먼저 받아 주세요.")

    # 고른 역의 밤 열차: (요일 코드, 역 키) -> [(열차번호, 예정 도착 분)]
    stops = []
    for line in lines:
        if line["name"] not in LINES:
            continue
        base, spread, wanted = LINES[line["name"]]
        for st in line["stations"]:
            if st["name"] not in wanted:
                continue
            key = net.node_key(st["opr"], line["line"], st["stin"])
            stops.append({
                "station_key": key,
                "tago_id": net.tago_id(st["opr"], line["line"], st["stin"]),
                "line_name": line["name"],
                "station_name": st["name"],
                "base": base,
                "spread": spread,
                "station_eff": rng.normal(0, STATION_SPREAD),
            })

    rows = []
    for k in range(DAYS):
        d = START + timedelta(days=k)
        code = day_code(d)
        fri_sat = d.weekday() in (4, 5)
        for s in stops:
            seen = set()
            for train_no, arr, dep in tables[code].get(s["station_key"], []):
                sched = arr if arr is not None else dep
                if not train_no or train_no in seen or not (NIGHT_FROM_MIN <= sched <= NIGHT_TO_MIN):
                    continue
                seen.add(train_no)
                hour = sched // 60
                mean = s["base"] + s["station_eff"] + LATE_NIGHT_PER_HOUR * (hour - 21) + (FRI_SAT_EXTRA if fri_sat else 0)
                # 오른쪽으로 꼬리가 긴 분포: 대부분 조금 늦고, 가끔 많이 늦는다
                noise = rng.gamma(2.0, s["spread"] / 2) - s["spread"]
                delay = mean + noise
                if rng.random() < INCIDENT_RATE:
                    delay += rng.uniform(INCIDENT_MIN, INCIDENT_MAX)
                rows.append({
                    "service_date": d.isoformat(),
                    "train_no": train_no,
                    "station_key": s["station_key"],
                    "tago_id": s["tago_id"],
                    "line_name": s["line_name"],
                    "station_name": s["station_name"],
                    "scheduled_min": sched,
                    "delay_min": round(float(delay), 1),
                    "hour": hour,
                    "weekday": d.weekday(),
                })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    df.to_csv(OUT, index=False, encoding="utf-8")
    print(f"[가짜 데이터] {len(df):,}줄 → {OUT}")
    print(f"  기간 {df.service_date.min()} ~ {df.service_date.max()}, 노선 {df.line_name.nunique()}개, 역 {df.station_key.nunique()}곳")


if __name__ == "__main__":
    main()

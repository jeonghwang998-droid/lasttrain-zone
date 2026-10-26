"""개발용 가짜 데이터 생성기

실제 데이터(collect.py)가 쌓이기 전에 학습/서빙 파이프라인을 먼저 완성하기 위한 용도.
collect.py build 결과(delays.csv)와 컬럼이 같으므로, 나중에 파일만 바꾸면 그대로 돌아간다.
발표 때는 반드시 '가짜 데이터로 검증한 결과'와 '실제 데이터 결과'를 구분해서 보여줄 것.
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

rng = np.random.default_rng(42)

LINES = {  # 노선별 기본 지연 성향 (평균 분, 흔들림 정도)
    "1호선": (1.0, 1.4),
    "4호선": (0.6, 0.7),
    "2호선": (0.4, 0.5),
}
NIGHT_HOURS = [21, 22, 23, 0, 1]

rows = []
start = date(2026, 8, 1)
for d in range(75):
    day = start + timedelta(days=d)
    wd = day.weekday()
    rainy = rng.random() < 0.25
    for line, (base, spread) in LINES.items():
        for hour in NIGHT_HOURS:
            rain = rng.gamma(1.5, 4.0) if rainy and rng.random() < 0.7 else 0.0
            temp = 24 - d * 0.12 + rng.normal(0, 2)
            for _ in range(4):  # 시간대별 열차 4대
                late_night = 0.4 if hour in (0, 1) else 0.0
                fri_sat = 1.0 if wd in (4, 5) else 0.0
                mean = base + 0.8 * late_night + 1.0 * fri_sat + 0.45 * np.sqrt(rain) * (spread + 0.5)
                delay = rng.gamma(2.0, max(mean, 0.1) / 2.0) - 0.3 + rng.normal(0, 0.3)
                if rng.random() < 0.03:  # 가끔 생기는 큰 지연 (고장, 혼잡)
                    delay += rng.uniform(5, 15)
                rows.append({
                    "date": day.isoformat(), "line": line, "station": "-", "train_no": "-",
                    "hour": hour, "weekday": wd, "rain_mm": round(rain, 1),
                    "temp_c": round(temp, 1), "delay_min": round(delay, 2),
                })

pd.DataFrame(rows).to_csv("data/delays.csv", index=False)
print(f"{len(rows)}건 생성 -> data/delays.csv")

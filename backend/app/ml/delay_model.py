"""3단계: 서비스에서 지연 예측 사용

Flask 서버가 켜질 때 한 번만 로드하고, 요청마다 predict만 호출한다.
"""
from __future__ import annotations

from dataclasses import dataclass

import joblib
import pandas as pd

from .features import make_features


@dataclass
class Context:
    """예측 시점의 상황 (날씨는 기상청 단기예보 API 등에서 받아오면 됨)"""
    weekday: int        # 0=월 ... 6=일 (운행일 기준)
    rain_mm: float = 0.0


class DelayPredictor:
    MAX_EXTRA = 15  # 예측이 튀어도 15분 이상은 더하지 않음 (안전장치)

    def __init__(self, path):
        bundle = joblib.load(path)
        self.q90 = bundle["q90"]
        self.columns = bundle["columns"]

    def predict(self, line: str, hour: int, ctx: Context) -> float:
        row = pd.DataFrame([{"line": line, "hour": hour, "weekday": ctx.weekday,
                             "rain_mm": ctx.rain_mm}])
        return float(self.q90.predict(make_features(row, self.columns))[0])

    def extra_delay_fn(self, ctx: Context):
        """last_train.latest_boardings에 넘길 함수를 만든다.
        환승 구간의 '도착 지연'만 반영: 앞 열차가 늦으면 다음 막차를 놓치니까."""
        def fn(leg, dep_min: int) -> int:
            if not leg.line:
                return 0
            arrive_hour = ((dep_min + leg.ride) // 60) % 24
            d = self.predict(leg.line, arrive_hour, ctx)
            return int(round(min(max(d, 0), self.MAX_EXTRA)))
        return fn

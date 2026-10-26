"""학습/추론 공통 특징 생성
※ ml/train_delay.py 의 make_features 와 반드시 같게 유지할 것
"""
from __future__ import annotations

import pandas as pd


def make_features(df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    X = pd.DataFrame({
        "hour": df["hour"].where(df["hour"] >= 4, df["hour"] + 24),
        "weekday": df["weekday"],
        "next_day_off": df["weekday"].isin([4, 5]).astype(int),
        "rain_mm": df["rain_mm"],
    })
    X = pd.concat([X, pd.get_dummies(df["line"], prefix="line", dtype=int)], axis=1)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0)
    return X

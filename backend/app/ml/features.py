"""지연 예측 특징 생성. 학습(ml/train.py)과 서빙(app/ml/delay_model.py)이 이 파일 하나만 쓴다

입력 칸: line_name, station_key, hour, weekday, (있으면) event  (ml/dataset.py 의 칸과 같은 이름)
특징:
  hour      시간대 (21, 22, 23, 24=자정 넘은 0시, 25=1시 … 운행일 기준이라 밤이 이어진다)
  weekday   요일 0=월 … 6=일 (운행일 기준. 금·토 밤이 따로 갈리도록 나무 모델이 나눠 본다)
  is_dep    출발 기록이면 1, 도착이면 0. 출발 지연은 문 닫히는 시간까지 더해져 도착보다 크다.
            앱의 예측은 늘 도착 기준이라 event 칸 없이 부르면 0 (도착)
  line_*    노선 (원-핫)
  st_*      역 (원-핫). 기록이 넉넉한 역만 켠다. 모자란 역은 모두 0 → 노선 단위로 예측된다

역 단위 → 노선 단위 → 데이터 부족으로 내려가는 판단(support)도 여기 둔다. 기준 수는 app_config 의 ml.min_samples.
"""
from __future__ import annotations

import pandas as pd

UNKNOWN = ""  # 기록이 모자라 역 단위로 보지 않는 역


def support_counts(df: pd.DataFrame) -> dict:
    """학습 데이터의 역별, 노선별 기록 수. 예측할 때 어느 단위로 볼지 정하는 데 쓴다"""
    return {
        "station": df["station_key"].value_counts().to_dict(),
        "line": df["line_name"].value_counts().to_dict(),
    }


def level_for(line_name: str, station_key: str, support: dict, min_samples: int) -> str:
    """'station' | 'line' | 'none'(데이터 부족)"""
    if support["station"].get(station_key, 0) >= min_samples:
        return "station"
    if support["line"].get(line_name, 0) >= min_samples:
        return "line"
    return "none"


def coarsen(df: pd.DataFrame, support: dict, min_samples: int) -> pd.DataFrame:
    """기록이 모자란 역은 역 정보를 지운다 (노선 단위로 학습·예측되게)"""
    out = df.copy()
    keep = out["station_key"].map(lambda k: support["station"].get(k, 0) >= min_samples)
    out.loc[~keep, "station_key"] = UNKNOWN
    return out


def make_features(df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    """columns 를 주면 그 칸 구성과 순서에 맞춘다 (예측할 때 학습 때와 같게). 처음 보는 노선·역은 모두 0"""
    is_dep = (df["event"] == "dep").astype(int) if "event" in df else 0
    X = pd.DataFrame({"hour": df["hour"].astype(int), "weekday": df["weekday"].astype(int), "is_dep": is_dep}, index=df.index)
    lines = pd.get_dummies(df["line_name"], prefix="line", dtype=int)
    stations = pd.get_dummies(df["station_key"].where(df["station_key"] != UNKNOWN), prefix="st", dtype=int)
    X = pd.concat([X, lines, stations], axis=1)
    if columns is not None:
        X = X.reindex(columns=columns, fill_value=0)
    return X

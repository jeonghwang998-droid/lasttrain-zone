"""학습 데이터 불러오기: --source fake / db 둘 다 같은 칸, 같은 형식의 DataFrame 을 돌려준다

- fake : ml/data/fake_delays.csv (make_fake_data.py 가 만든 가짜 지연)
- db   : Supabase train_delays 뷰 (실제 도착 기록 × KRIC 시간표). service_role 키 필요

두 출처 모두 app_config 의 ml.delay_valid_range 밖의 지연은 뺀다 (db 는 뷰가 이미 빼고, fake 는 여기서 뺀다).
돌려주는 DataFrame 의 attrs["source"] 에 출처를 적어 둔다 (리포트가 가짜 데이터 표시에 쓴다).

확인:  python ml/dataset.py --source fake
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import db  # noqa: E402

FAKE_PATH = ROOT / "ml" / "data" / "fake_delays.csv"
SOURCES = ("fake", "db")

# 두 출처가 공통으로 돌려주는 칸 (train_delays 뷰의 칸 중 학습에 쓰는 것)
COLUMNS = [
    "service_date",   # 운행일 (datetime64, 날짜 기준 학습/시험 분할에 쓴다)
    "train_no",       # 열차번호
    "station_key",    # 역 (KRIC 역 키)
    "tago_id",        # 역 (앱이 쓰는 공공데이터 역 id)
    "line_name",      # 노선 이름
    "station_name",   # 역 이름
    "scheduled_min",  # 시간표 도착 (서비스 날 0시 기준 분)
    "delay_min",      # 지연(분) = 실제 도착 − 시간표 도착
    "hour",           # 시간대 (24, 25 = 자정 넘은 0시, 1시)
    "weekday",        # 요일 0=월 … 6=일 (운행일 기준)
    "event",          # 'arr' 도착 / 'dep' 출발 (가짜 데이터는 모두 도착)
]


def _load_fake() -> pd.DataFrame:
    if not FAKE_PATH.exists():
        raise SystemExit(f"가짜 데이터가 없어요. 먼저 python ml/make_fake_data.py 를 실행해 주세요. ({FAKE_PATH})")
    df = pd.read_csv(FAKE_PATH, dtype={"train_no": str, "station_key": str, "tago_id": str})
    if "event" not in df:
        df["event"] = "arr"
    rng = db.config_value("ml.delay_valid_range")
    return df[df["delay_min"].between(rng["min"], rng["max"])]


def _load_db() -> pd.DataFrame:
    rows = db.select("train_delays", columns=",".join(COLUMNS), order="service_date,arrival_id")
    return pd.DataFrame(rows, columns=COLUMNS)


def load(source: str) -> pd.DataFrame:
    """출처에 상관없이 COLUMNS 칸, 운행일 순서로 정렬된 표"""
    if source not in SOURCES:
        raise ValueError(f"source 는 {SOURCES} 중 하나여야 해요: {source}")
    df = _load_fake() if source == "fake" else _load_db()
    df = df[COLUMNS].copy()
    df["service_date"] = pd.to_datetime(df["service_date"])
    for c in ("scheduled_min", "hour", "weekday"):
        df[c] = df[c].astype("int64")
    df["delay_min"] = df["delay_min"].astype("float64")
    df = df.sort_values(["service_date", "scheduled_min"], kind="stable").reset_index(drop=True)
    df.attrs["source"] = source
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description="학습 데이터를 불러와 요약을 보여 준다")
    ap.add_argument("--source", choices=SOURCES, required=True)
    df = load(ap.parse_args().source)
    print(f"[{df.attrs['source']}] {len(df):,}줄")
    if df.empty:
        print("  데이터가 없어요." + (" 실제 도착 기록(train_arrivals)이 아직 쌓이지 않았어요." if df.attrs["source"] == "db" else ""))
        return
    print(f"  기간 {df.service_date.min():%Y-%m-%d} ~ {df.service_date.max():%Y-%m-%d} ({df.service_date.dt.date.nunique()}일)")
    print(f"  노선 {df.line_name.nunique()}개, 역 {df.station_key.nunique()}곳")
    print("  노선별 지연(분) 요약:")
    qs = db.config_value("ml.quantiles")
    print(df.groupby("line_name")["delay_min"].describe(percentiles=qs).round(2).to_string())


if __name__ == "__main__":
    main()

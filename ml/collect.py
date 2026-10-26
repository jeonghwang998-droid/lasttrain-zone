"""1단계: 데이터 수집

(1) collect   : 서울시 실시간 지하철 도착정보 API를 주기적으로 호출해서
                '열차가 실제로 역에 도착한 시각'을 arrivals.csv에 쌓는다.
(2) build     : 실제 도착 기록 + 역 시간표 + 날씨를 합쳐서
                학습용 delays.csv(열차별 지연 분)를 만든다.

실행 예)
  python collect.py collect --key 발급받은키 --stations 금정 사당 신도림
  python collect.py build --timetable timetable.csv --weather weather.csv

※ API 응답 필드명(btrainNo, arvlCd, recptnDt 등)은 서울 열린데이터광장의
  '지하철 실시간 도착정보' 문서에서 한 번 더 확인하세요. 다르면 parse_arrivals만 고치면 됩니다.
"""
from __future__ import annotations

import argparse
import csv
import os
import time
from datetime import datetime, timedelta

import requests

API_URL = "http://swopenapi.seoul.go.kr/api/subway/{key}/json/realtimeStationArrival/0/30/{station}"
ARRIVED = {"1"}            # arvlCd 값 중 '도착'으로 볼 코드
POLL_SEC = 30              # 30초마다 조회 (일일 호출 한도 확인 필수)
NIGHT_HOURS = {21, 22, 23, 0, 1}  # 막차 시간대만 수집해서 호출 수 절약


def parse_arrivals(payload: dict) -> list[dict]:
    rows = []
    for item in payload.get("realtimeArrivalList", []):
        if item.get("arvlCd") not in ARRIVED:
            continue
        rows.append({
            "train_no": item.get("btrainNo"),
            "line_id": item.get("subwayId"),
            "station": item.get("statnNm"),
            "direction": item.get("updnLine"),
            "arrived_at": item.get("recptnDt"),  # 'YYYY-MM-DD HH:MM:SS'
        })
    return rows


def collect(key: str, stations: list[str], out: str = "data/arrivals.csv") -> None:
    seen: set[tuple] = set()  # 같은 열차의 '도착' 상태가 여러 번 잡히는 것 방지
    new_file = not os.path.exists(out)
    with open(out, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["train_no", "line_id", "station", "direction", "arrived_at"])
        if new_file:
            w.writeheader()
        while True:
            if datetime.now().hour in NIGHT_HOURS:
                for st in stations:
                    try:
                        res = requests.get(API_URL.format(key=key, station=st), timeout=5)
                        for row in parse_arrivals(res.json()):
                            k = (row["train_no"], row["station"], row["arrived_at"][:10])
                            if k not in seen:
                                seen.add(k)
                                w.writerow(row)
                                f.flush()
                    except (requests.RequestException, ValueError) as e:
                        print(f"[{datetime.now():%H:%M:%S}] {st} 조회 실패: {e}")
            time.sleep(POLL_SEC)


def build(arrivals: str, timetable: str, weather: str, out: str = "data/delays.csv") -> None:
    """timetable.csv 컬럼: train_no, station, line, scheduled (HH:MM)
       weather.csv 컬럼  : datetime (YYYY-MM-DD HH:00), rain_mm, temp_c   (기상자료개방포털 시간자료)"""
    import pandas as pd

    arr = pd.read_csv(arrivals, dtype={"train_no": str})
    tt = pd.read_csv(timetable, dtype={"train_no": str})
    wx = pd.read_csv(weather, parse_dates=["datetime"])

    arr["arrived_at"] = pd.to_datetime(arr["arrived_at"])
    df = arr.merge(tt, on=["train_no", "station"], how="inner")

    # 운행일 기준 예정 시각 만들기 (새벽 0~3시 열차는 전날 운행일 소속)
    df["service_day"] = (df["arrived_at"] - timedelta(hours=4)).dt.normalize()
    hh = df["scheduled"].str.slice(0, 2).astype(int)
    mm = df["scheduled"].str.slice(3, 5).astype(int)
    df["scheduled_at"] = df["service_day"] + pd.to_timedelta(hh.where(hh >= 4, hh + 24) * 60 + mm, unit="m")
    df["delay_min"] = (df["arrived_at"] - df["scheduled_at"]).dt.total_seconds() / 60

    # 잘못 매칭된 기록 제거 (시간표에 없는 임시 열차 등)
    df = df[df["delay_min"].between(-5, 40)]

    df["wx_key"] = df["scheduled_at"].dt.floor("h")
    df = df.merge(wx.rename(columns={"datetime": "wx_key"}), on="wx_key", how="left")
    df[["rain_mm", "temp_c"]] = df[["rain_mm", "temp_c"]].fillna({"rain_mm": 0, "temp_c": df["temp_c"].median()})

    df["date"] = df["service_day"].dt.date
    df["hour"] = df["scheduled_at"].dt.hour
    df["weekday"] = df["service_day"].dt.weekday
    df[["date", "line", "station", "train_no", "hour", "weekday", "rain_mm", "temp_c", "delay_min"]].to_csv(out, index=False)
    print(f"{len(df)}건 저장 -> {out}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--key", required=True)
    c.add_argument("--stations", nargs="+", required=True)
    b = sub.add_parser("build")
    b.add_argument("--arrivals", default="data/arrivals.csv")
    b.add_argument("--timetable", required=True)
    b.add_argument("--weather", required=True)
    a = p.parse_args()
    if a.cmd == "collect":
        collect(a.key, a.stations)
    else:
        build(a.arrivals, a.timetable, a.weather)

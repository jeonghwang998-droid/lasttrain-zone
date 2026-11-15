"""KRIC 역 시간표(backend/data/kric/timetable_*.json)를 DB train_timetable 에 올린다

실시간 도착 기록(train_arrivals)과 맞춰 지연을 계산하는 train_delays 뷰가 이 표를 쓴다.
시간표 파일은 build_network.py (또는 서버 시작 시 자동 받기)가 만든다. 다 받은 요일(.done)만 올린다.

실행 (backend 폴더에서):
  python upload_timetable.py             # 받아 둔 요일 전부
  python upload_timetable.py --day 8     # 평일만
"""
from __future__ import annotations

import argparse
import sys

from app.services import db
from app.services import kric_client as kric
from app.services import kric_network as net

REGION = "01"  # 수도권 (kric_client.REGION_CODES)


def rows_for(day_code: str, lines: list[dict], table: dict) -> list[dict]:
    """시간표 한 요일을 DB 줄로. 한 열차가 같은 역을 두 번 지나면 처음 것만 쓴다 (기본 키가 역+열차)"""
    info = {}
    for line in lines:
        for st in line["stations"]:
            info[net.node_key(st["opr"], line["line"], st["stin"])] = (net.tago_id(st["opr"], line["line"], st["stin"]), line["name"], st["name"])
    out = []
    for key, trains in table.items():
        if key not in info:
            continue
        tago, line_name, station_name = info[key]
        seen = set()
        for train_no, arr, dep in trains:
            if not train_no or train_no in seen:
                continue
            seen.add(train_no)
            out.append({
                "day_code": day_code,
                "station_key": key,
                "tago_id": tago,
                "line_name": line_name,
                "station_name": station_name,
                "train_no": train_no,
                "arr_min": arr,
                "dep_min": dep,
            })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="KRIC 시간표를 DB train_timetable 에 올린다")
    ap.add_argument("--day", choices=sorted(set(kric.DAY_CODES.values())), help="요일 코드 하나만 (8 평일, 9 휴일)")
    args = ap.parse_args()

    lines = net.load_lines(REGION)
    if not lines:
        print("노선 자료가 없어요. 먼저 python build_network.py 로 받아 주세요.")
        return 1
    days = [args.day] if args.day else sorted(set(kric.DAY_CODES.values()))
    for day in days:
        if not net.is_complete(REGION, day):
            print(f"[{day}] 시간표를 다 받지 않았어요. 건너뜀 (python build_network.py 로 받기)")
            continue
        rows = rows_for(day, lines, net.load_timetable(REGION, day))
        print(f"[{day}] {len(rows):,}줄 올리는 중…")

        def progress(done, total):
            if done % 20000 < db.PAGE_ROWS or done == total:
                print(f"  {done:,} / {total:,}")

        db.upsert("train_timetable", rows, on_conflict="day_code,station_key,train_no", progress=progress)
    print("끝")
    return 0


if __name__ == "__main__":
    sys.exit(main())

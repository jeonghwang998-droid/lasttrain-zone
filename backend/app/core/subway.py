"""지하철 노선/역 정리와 막차 뽑기 (순수 로직: 외부 호출 없음)"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

SERVICE_DAY_START = 4  # 새벽 4시 전 시각은 전날 운행일로 취급 (core/last_train.py 와 같은 규칙)
KST = timezone(timedelta(hours=9))

DAILY_TYPES = {"weekday": "01", "saturday": "02", "sunday": "03"}
DAILY_LABELS = {"01": "평일", "02": "토요일", "03": "일요일"}


def daily_type(now: datetime | None = None) -> str:
    """지금이 속한 운행일의 요일 구분 코드. 새벽 4시 전은 전날 기준"""
    now = (now or datetime.now(KST)) - timedelta(hours=SERVICE_DAY_START)
    wd = now.weekday()
    return DAILY_TYPES["weekday"] if wd < 5 else DAILY_TYPES["saturday"] if wd == 5 else DAILY_TYPES["sunday"]


# 역 id 앞부분으로 알 수 있는 운영 지역. 여기에 없는 id 는 수도권/기타로 본다
# (이름이 같은 노선, 예를 들어 수도권 1호선과 부산 1호선이 섞이지 않게 나누는 데만 쓴다)
REGION_BY_ID_PREFIX = {
    "MTRBS": "부산",
    "MTRBGB": "부산",  # 부산김해경전철
    "MTRDG": "대구",
    "MTRDJ": "대전",
    "MTRGJ": "광주",
}
DEFAULT_REGION = "수도권"
REGION_ORDER = [DEFAULT_REGION, "부산", "대구", "대전", "광주"]


def region_of(station_id: str) -> str:
    # 접두어는 길이가 다를 수 있어서 가장 긴 일치를 쓴다 (MTRBGB 가 MTRBS 로 오인되지 않게)
    for prefix in sorted(REGION_BY_ID_PREFIX, key=len, reverse=True):
        if station_id.startswith(prefix):
            return REGION_BY_ID_PREFIX[prefix]
    return DEFAULT_REGION


def _line_sort_key(line: dict):
    m = re.fullmatch(r"(\d+)호선", line["base"])
    region_rank = REGION_ORDER.index(line["region"]) if line["region"] in REGION_ORDER else len(REGION_ORDER)
    return (0, int(m.group(1)), region_rank, "") if m else (1, 0, region_rank, line["base"])


def group_lines(stations: list[dict]) -> list[dict]:
    """역 목록 → [{name, region, stations: [{id, name}]}].
    노선 이름이 지역마다 겹치면(1호선 등) '부산 1호선'처럼 지역을 붙인다. 숫자 노선 먼저, 나머지는 가나다순"""
    by_line: dict[tuple[str, str], list[dict]] = {}
    for s in stations:
        key = (s["subwayRouteName"], region_of(s["subwayStationId"]))
        by_line.setdefault(key, []).append({"id": s["subwayStationId"], "name": s["subwayStationName"]})

    regions_per_name: dict[str, set[str]] = {}
    for base, region in by_line:
        regions_per_name.setdefault(base, set()).add(region)

    lines = [
        {
            "base": base,
            "region": region,
            "name": f"{region} {base}" if len(regions_per_name[base]) > 1 else base,
            "stations": sorted(v, key=lambda x: x["name"]),
        }
        for (base, region), v in by_line.items()
    ]
    lines.sort(key=_line_sort_key)
    return [{"name": l["name"], "region": l["region"], "stations": l["stations"]} for l in lines]


def dep_minutes(dep_time: str) -> int | None:
    """'002530' -> 1465 (자정을 넘긴 막차도 크기 비교가 되도록). 시각이 아니면 None"""
    if not re.fullmatch(r"\d{6}", dep_time or ""):
        return None
    h, m = int(dep_time[:2]), int(dep_time[2:4])
    t = h * 60 + m
    return t + 1440 if h < SERVICE_DAY_START else t


def fmt(minutes: int) -> str:
    minutes %= 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def last_trains(items: list[dict]) -> list[dict]:
    """시간표 → 행(종착역)별 막차. 늦은 막차부터.
    [{direction: 'U'|'D', end: '오이도', last: '00:41', minutes: 1481, count: 87}]"""
    best: dict[tuple[str, str], dict] = {}
    for it in items:
        t = dep_minutes(it.get("depTime", ""))
        if t is None:
            continue
        key = (it.get("upDownTypeCode", ""), it.get("endSubwayStationNm", ""))
        cur = best.setdefault(key, {"direction": key[0], "end": key[1], "minutes": t, "count": 0})
        cur["minutes"] = max(cur["minutes"], t)
        cur["count"] += 1
    out = [{**v, "last": fmt(v["minutes"])} for v in best.values()]
    return sorted(out, key=lambda v: -v["minutes"])

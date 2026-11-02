"""KRIC 데이터로 지하철 연결망 자료를 모아 디스크에 저장한다 (backend/data/kric/, git 제외)

1) 노선 찾기: 이미 가진 공공데이터(TAGO) 역 ID 는 'MTR' + 운영기관(2자) + 노선코드 + 역코드 모양이다.
   여기서 노선코드 후보를 뽑아 KRIC 노선정보로 확인한다 (코드표가 따로 공개돼 있지 않아서)
2) 시간표 모으기: 노선의 역마다 시간표를 받는다. 호출이 많아서 중간에 끊겨도 받은 만큼 저장하고 이어서 받는다
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..config import Config
from ..core.last_train import SERVICE_DAY_START
from . import kric_client as kric

DATA = Path(Config.DATA_DIR) / "kric"
WORKERS = 6  # 동시에 보내는 요청 수 (너무 많으면 거절될 수 있다)
SAVE_EVERY = 25  # 시간표를 이만큼 받을 때마다 저장한다


def node_key(opr: str, line: str, stin: str) -> str:
    return f"{opr}|{line}|{stin}"


def tago_id(opr: str, line: str, stin: str) -> str:
    return f"MTR{opr}{line}{stin}"


def _lines_path(region: str) -> Path:
    return DATA / f"lines_{region}.json"


def _timetable_path(region: str, day: str) -> Path:
    return DATA / f"timetable_{region}_{day}.json"


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, data) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def to_minutes(hhmmss: str) -> int | None:
    """'000500' -> 1445 (새벽 4시 전은 전날 운행일로 본다). 시각이 아니면 None"""
    if not re.fullmatch(r"\d{6}", hhmmss or "") or hhmmss == "000000":
        return None
    h, m = int(hhmmss[:2]), int(hhmmss[2:4])
    t = h * 60 + m
    return t + 1440 if h < SERVICE_DAY_START else t


# ---------- 1) 노선 찾기 ----------
def discover_lines(region_name: str, catalog_lines: list[dict], progress=print) -> list[dict]:
    """권역 하나의 KRIC 노선 목록. [{line, name, stations: [{opr, stin, name, order, tago}]}]"""
    region = kric.REGION_CODES[region_name]
    expect: dict[str, set[str]] = {}  # 후보 노선코드 -> 그 노선에 있어야 할 KRIC 역코드
    tago_names: dict[str, str] = {}  # TAGO 역 ID -> 우리 노선 이름 (화면 표시용)
    for line in catalog_lines:
        if line["region"] != region_name:
            continue
        for st in line["stations"]:
            tago_names[st["id"]] = line["name"]
            m = re.fullmatch(r"MTR([A-Z0-9]{2})(.+)", st["id"])
            if not m:
                continue
            rest = m.group(2)
            for n in (1, 2, 3):
                if len(rest) > n:
                    expect.setdefault(rest[:n], set()).add(rest[n:])

    progress(f"[{region_name}] 노선 코드 후보 {len(expect)}개 확인 중")
    found = []

    def check(code):
        try:
            return code, kric.route_info(region, code)
        except kric.KricApiError as e:
            return code, e

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for code, items in ex.map(check, sorted(expect)):
            if isinstance(items, Exception):
                raise items
            stins = {it["stinCd"] for it in items}
            if not items or not (stins & expect[code]):  # 다른 노선의 코드와 겹친 우연은 버린다
                continue
            stations = [
                {
                    "opr": it["railOprIsttCd"],
                    "stin": it["stinCd"],
                    "name": it["stinNm"],
                    "order": it.get("stinConsOrdr"),
                    "tago": tago_id(it["railOprIsttCd"], code, it["stinCd"]),
                }
                for it in sorted(items, key=lambda x: x.get("stinConsOrdr") or 0)
            ]
            names = [tago_names[s["tago"]] for s in stations if s["tago"] in tago_names]
            name = max(set(names), key=names.count) if names else items[0].get("routNm", code)
            found.append({"line": code, "name": name, "stations": stations})
            progress(f"  {code}: {name} ({len(stations)}개 역)")
    _write(_lines_path(region), found)
    return found


def load_lines(region: str) -> list[dict] | None:
    return _read(_lines_path(region))


# ---------- 2) 시간표 모으기 ----------
def build_timetables(region: str, day_code: str, progress=print) -> dict:
    """역마다 [열차번호, 도착(분), 출발(분)] 목록. 이미 받은 역은 건너뛴다(이어받기)"""
    lines = load_lines(region)
    if not lines:
        raise RuntimeError("노선 목록이 없어요. discover_lines 를 먼저 실행해 주세요.")
    path = _timetable_path(region, day_code)
    table = _read(path) or {}
    todo = []
    for line in lines:
        for st in line["stations"]:
            key = node_key(st["opr"], line["line"], st["stin"])
            if key not in table:
                todo.append((key, st["opr"], line["line"], st["stin"]))
    progress(f"[{region}/{day_code}] 받을 역 {len(todo)}개 (이미 받은 역 {len(table)}개)")

    def fetch(job):
        key, opr, ln, stin = job
        for _ in range(2):  # 한 번 실패하면 한 번 더 시도
            try:
                rows = kric.station_timetable(opr, ln, stin, day_code)
                break
            except kric.KricApiError as e:
                err = e
        else:
            return key, err
        out = []
        for r in rows:
            arr = to_minutes(r.get("arvTm", ""))
            dep = to_minutes(r.get("dptTm", ""))
            if arr is None and dep is None:
                continue
            out.append([r.get("trnNo", ""), arr if arr is not None else dep, dep if dep is not None else arr])
        return key, out

    done = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for key, rows in ex.map(fetch, todo):
            if isinstance(rows, Exception):
                errors += 1
                if rows.kind in ("not_configured", "rejected"):
                    _write(path, table)
                    raise rows  # 키 문제나 한도 초과: 받은 만큼 저장하고 멈춘다
                continue
            table[key] = rows
            done += 1
            if done % SAVE_EVERY == 0:
                _write(path, table)
                progress(f"  {done}/{len(todo)}")
    _write(path, table)
    progress(f"[{region}/{day_code}] 완료: 새로 {done}개, 실패 {errors}개, 전체 {len(table)}개 역")
    return table


def load_timetable(region: str, day_code: str) -> dict | None:
    return _read(_timetable_path(region, day_code))

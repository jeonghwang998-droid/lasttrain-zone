"""KRIC 데이터로 지하철 연결망 자료를 모아 디스크에 저장한다 (backend/data/kric/, git 제외)

1) 노선 찾기: 이미 가진 공공데이터(TAGO) 역 ID 는 'MTR' + 운영기관(2자) + 노선코드 + 역코드 모양이다.
   여기서 노선코드 후보를 뽑아 KRIC 노선정보로 확인한다 (코드표가 따로 공개돼 있지 않아서)
2) 시간표 모으기: 노선의 역마다 시간표를 받는다. 호출이 많아서 중간에 끊겨도 받은 만큼 저장하고 이어서 받는다
3) 서버를 켤 때 자료가 없으면 백그라운드에서 1), 2)를 알아서 한다 (wsgi.py). build_network.py 로 직접 받아도 된다
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
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
    # 모든 역을 받았을 때만 '다 받음'으로 표시한다. 반쯤 받았거나 전부 비어 있는 자료로는 경로를 계산하지 않는다
    if errors == 0 and any(table.values()):
        _write(_done_path(region, day_code), {"stations": len(table)})
    progress(f"[{region}/{day_code}] 완료: 새로 {done}개, 실패 {errors}개, 전체 {len(table)}개 역")
    return table


def _done_path(region: str, day: str) -> Path:
    return DATA / f"timetable_{region}_{day}.done"


def is_complete(region: str, day_code: str) -> bool:
    """노선의 모든 역 시간표를 다 받았는지"""
    return _done_path(region, day_code).exists() and _timetable_path(region, day_code).exists()


def load_timetable(region: str, day_code: str) -> dict | None:
    return _read(_timetable_path(region, day_code))


# ---------- 3) 서버를 켤 때 없으면 알아서 받기 ----------
LOCK = DATA / "build.lock"
LOCK_STALE_SEC = 30 * 60  # 이 시간 동안 잠금 파일이 갱신되지 않으면 받던 프로세스가 죽은 것으로 본다


def is_building() -> bool:
    """어느 프로세스든 지금 자료를 받는 중인지 (개발 모드는 서버 프로세스가 두 개라 파일로 확인한다)"""
    try:
        return time.time() - LOCK.stat().st_mtime < LOCK_STALE_SEC
    except OSError:
        return False


def _take_lock() -> bool:
    DATA.mkdir(parents=True, exist_ok=True)
    if LOCK.exists() and not is_building():
        LOCK.unlink(missing_ok=True)  # 죽은 프로세스가 남긴 잠금
    try:
        os.close(os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return True
    except FileExistsError:
        return False


def start_auto_build(app, region_name: str = "수도권") -> None:
    """자료가 덜 받아져 있으면 백그라운드에서 받는다. 오늘 요일 시간표부터, 그다음 나머지 요일"""
    region = kric.REGION_CODES[region_name]
    from ..core.subway import daily_type  # 여기서만 쓰는 것이라 늦게 불러온다

    today = kric.DAY_CODES[daily_type()]
    days = list(dict.fromkeys([today, *kric.DAY_CODES.values()]))  # 오늘 요일 먼저, 같은 시간표는 한 번만
    if load_lines(region) and all(is_complete(region, d) for d in days):
        return

    def run():
        from ..api.subway import _load_catalog  # 순환 import 를 피하려고 여기서 불러온다

        with app.app_context():
            log = app.logger
            if not Config.KRIC_API_KEY:
                log.warning("[kric] KRIC_API_KEY 가 없어서 지하철 시간표 자료를 받지 않아요")
                return
            if not _take_lock():
                return  # 다른 프로세스가 받는 중
            touch = lambda msg: (LOCK.touch(), log.info("[kric] %s", msg))  # noqa: E731
            try:
                if not load_lines(region):
                    discover_lines(region_name, _load_catalog()["lines"], progress=touch)
                for day in days:
                    if not is_complete(region, day):
                        build_timetables(region, day, progress=touch)
                log.info("[kric] 지하철 시간표 자료 준비 끝")
            except (kric.KricApiError, RuntimeError) as e:
                log.error("[kric] 시간표 자료를 받다가 멈췄어요. 서버를 다시 켜면 이어서 받아요: %s", e)
            finally:
                LOCK.unlink(missing_ok=True)

    threading.Thread(target=run, name="kric-auto-build", daemon=True).start()

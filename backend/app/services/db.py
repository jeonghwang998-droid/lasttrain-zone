"""Supabase 접근 (service role 키, RLS 를 건너뛴다 → 백엔드 전용 데이터와 서버 작업에만 쓴다)

Supabase REST(PostgREST)를 requests 로 직접 부른다.
- select(table, ...)   : 여러 쪽으로 나눠 전부 읽기
- upsert(table, rows)  : 묶음으로 넣기 (겹치면 덮어쓰기)
- rpc(name, args)      : DB 함수 호출
- config_value(key)    : app_config 정책값 (DB 함수 config_value 로 읽는다. 키가 없으면 오류)
"""
from __future__ import annotations

import time

import requests

from ..config import Config

TIMEOUT_SEC = 60
PAGE_ROWS = 1000  # Supabase REST 가 한 번에 돌려주는 최대 줄 수 (프로젝트 기본값)
RETRIES = 5  # 넣기 요청이 네트워크 문제로 끊겼을 때 다시 보내는 횟수
RETRY_WAIT_SEC = 2  # 다시 보내기 전 기다리는 시간 (재시도마다 두 배로 늘린다)


class DbError(RuntimeError):
    """DB 요청 실패. 메시지는 화면이나 로그에 그대로 써도 되는 한국어"""


def _base() -> str:
    if not Config.SUPABASE_URL or not Config.SUPABASE_SERVICE_ROLE_KEY:
        raise DbError("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 .env 에 있어야 해요.")
    return f"{Config.SUPABASE_URL}/rest/v1"


def _headers(extra: dict | None = None) -> dict:
    key = Config.SUPABASE_SERVICE_ROLE_KEY
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _check(res: requests.Response, what: str) -> None:
    if res.ok:
        return
    try:
        body = res.json()
        detail = body.get("message") or body.get("hint") or res.text
    except ValueError:
        detail = res.text
    raise DbError(f"{what} 실패 ({res.status_code}): {detail[:200]}")


def rpc(name: str, args: dict | None = None):
    res = requests.post(f"{_base()}/rpc/{name}", json=args or {}, headers=_headers(), timeout=TIMEOUT_SEC)
    _check(res, f"DB 함수 {name}")
    return res.json() if res.content else None


def config_value(key: str):
    """app_config 의 값 (jsonb 그대로: 숫자, 목록, 객체)"""
    return rpc("config_value", {"k": key})


def select(table: str, columns: str = "*", filters: dict | None = None, order: str | None = None) -> list[dict]:
    """조건에 맞는 줄을 전부 읽는다. filters 는 PostgREST 형식 (예: {"service_date": "gte.2026-08-01"})"""
    params = {"select": columns, **(filters or {})}
    if order:
        params["order"] = order
    rows: list[dict] = []
    start = 0
    while True:
        res = requests.get(
            f"{_base()}/{table}",
            params=params,
            headers=_headers({"Range-Unit": "items", "Range": f"{start}-{start + PAGE_ROWS - 1}"}),
            timeout=TIMEOUT_SEC,
        )
        _check(res, f"{table} 읽기")
        page = res.json()
        rows.extend(page)
        if len(page) < PAGE_ROWS:
            return rows
        start += PAGE_ROWS


def upsert(table: str, rows: list[dict], on_conflict: str, batch: int = PAGE_ROWS, progress=None, keep_existing: bool = False) -> int:
    """rows 를 batch 개씩 넣는다. on_conflict 칸이 같은 줄은 덮어쓴다 (keep_existing 이면 먼저 있던 줄을 남긴다). 보낸 줄 수를 돌려준다"""
    resolution = "ignore-duplicates" if keep_existing else "merge-duplicates"
    done = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        for attempt in range(RETRIES + 1):  # 네트워크가 잠깐 끊겨도 같은 묶음을 다시 보낸다 (덮어쓰기라 두 번 들어가도 안전)
            try:
                res = requests.post(
                    f"{_base()}/{table}",
                    params={"on_conflict": on_conflict},
                    json=chunk,
                    headers=_headers({"Prefer": f"resolution={resolution},return=minimal"}),
                    timeout=TIMEOUT_SEC,
                )
                break
            except requests.RequestException as e:
                if attempt == RETRIES:
                    raise DbError(f"{table} 넣기 실패: 서버에 연결하지 못했어요 ({type(e).__name__})") from e
                time.sleep(RETRY_WAIT_SEC * 2**attempt)
        _check(res, f"{table} 넣기")
        done += len(chunk)
        if progress:
            progress(done, len(rows))
    return done


def insert(table: str, row: dict) -> dict:
    """한 줄 넣고 넣은 줄을 돌려준다"""
    res = requests.post(f"{_base()}/{table}", json=row, headers=_headers({"Prefer": "return=representation"}), timeout=TIMEOUT_SEC)
    _check(res, f"{table} 넣기")
    return res.json()[0]

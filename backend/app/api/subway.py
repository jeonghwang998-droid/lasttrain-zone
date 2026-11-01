"""지하철 노선/역 목록과 역별 막차 (공공데이터포털 TAGO 지하철정보)"""
import json
import re
import time

from flask import Blueprint, current_app, jsonify

from ..auth import require_auth
from ..config import Config
from ..core import subway as core
from ..services import subway_client as client

bp = Blueprint("subway", __name__)

CATALOG_VERSION = 2  # 목록 모양이 바뀌면 올린다. 저장된 옛 파일은 버리고 다시 받는다
_catalog: dict | None = None  # {"v": 버전, "saved_at": 초, "lines": [...]}
_last_cache: dict[tuple[str, str], tuple[float, list]] = {}  # (역 id, 요일) -> (저장 시각, 막차 목록)


def _fail(e: client.SubwayApiError):
    current_app.logger.error("[subway] %s", e)
    if e.kind == "not_configured":
        return jsonify(error="지하철 정보 연결이 아직 준비되지 않았어요. 관리자에게 알려 주세요."), 503
    return jsonify(error="지하철 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."), 502


def _read_catalog_file() -> dict | None:
    try:
        return json.loads(Config.SUBWAY_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _load_catalog() -> dict:
    """메모리 → 파일 → API 순서. 오래됐어도 API 가 실패하면 있던 것을 쓴다"""
    global _catalog
    now = time.time()
    fresh = lambda c: c and c.get("v") == CATALOG_VERSION and now - c.get("saved_at", 0) < Config.SUBWAY_CATALOG_TTL_SEC  # noqa: E731
    if fresh(_catalog):
        return _catalog
    cached = _catalog or _read_catalog_file()
    if cached and cached.get("v") != CATALOG_VERSION:
        cached = None  # 옛 모양은 API 가 실패해도 쓰지 않는다
    if fresh(cached):
        _catalog = cached
        return _catalog
    try:
        lines = core.group_lines(client.fetch_stations())
    except client.SubwayApiError:
        if cached:
            _catalog = cached
            return _catalog
        raise
    _catalog = {"v": CATALOG_VERSION, "saved_at": now, "lines": lines}
    try:
        Config.SUBWAY_CATALOG_PATH.write_text(json.dumps(_catalog, ensure_ascii=False), encoding="utf-8")
    except OSError:
        current_app.logger.warning("[subway] 노선 캐시 파일을 저장하지 못했어요")
    return _catalog


@bp.get("/subway/lines")
@require_auth
def lines():
    try:
        return jsonify(lines=_load_catalog()["lines"])
    except client.SubwayApiError as e:
        return _fail(e)


@bp.get("/subway/stations/<station_id>/last-trains")
@require_auth
def station_last_trains(station_id: str):
    if not re.fullmatch(r"[A-Za-z0-9]{1,30}", station_id):
        return jsonify(error="역 정보가 올바르지 않아요."), 400
    daily = core.daily_type()
    key = (station_id, daily)
    hit = _last_cache.get(key)
    if hit and time.time() - hit[0] < Config.LAST_TRAIN_CACHE_TTL_SEC:
        trains = hit[1]
    else:
        try:
            items = client.fetch_timetable(station_id, daily, "U") + client.fetch_timetable(station_id, daily, "D")
        except client.SubwayApiError as e:
            return _fail(e)
        trains = core.last_trains(items)
        _last_cache[key] = (time.time(), trains)
    return jsonify(station_id=station_id, day=core.DAILY_LABELS[daily], trains=trains)

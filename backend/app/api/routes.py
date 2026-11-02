"""경로 찾기: 출발역에서 집(근처 역들)까지, 오늘 밤 막차까지 탈 수 있는 지하철 경로

요청: POST /api/routes  { from: 출발역 id, to: [{ id: 도착 후보 역 id, walk: 그 역에서 집까지 걷는 분 }] }
     walk 는 어느 역에서 내릴지 고르는 데만 쓰고 응답에는 넣지 않는다
     역 id 는 공공데이터(TAGO) 역 id 다 (화면이 이미 쓰는 것)
응답: { routes: [...], day, note }  routes 의 모양은 frontend/src/js/transit.js 주석과 같다
"""
import re
import statistics
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from ..auth import require_auth
from ..config import Config
from ..core import subway as subway_core
from ..core import transit_router as router
from ..core.last_train import SERVICE_DAY_START
from ..services import kric_client as kric
from ..services import kric_network as kric_net

bp = Blueprint("routes", __name__)

ID_PATTERN = re.compile(r"[A-Za-z0-9-]{1,30}")
MAX_TARGETS = 12
MAX_HOME_WALK_MIN = 60

_cache: dict[tuple[str, str], tuple[float, router.Network]] = {}  # (권역, 요일) -> (자료 파일 시각, 연결망)


def _network(region: str, day: str) -> router.Network | None:
    """디스크에 받아 둔 KRIC 자료로 연결망을 만든다. 다 받은 자료만 쓰고, 자료 파일이 바뀌면 다시 만든다"""
    if not kric_net.is_complete(region, day):
        return None
    path = kric_net.DATA / f"timetable_{region}_{day}.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    hit = _cache.get((region, day))
    if hit and hit[0] == mtime:
        return hit[1]
    lines, table = kric_net.load_lines(region), kric_net.load_timetable(region, day)
    if not lines or not table:
        return None
    net = router.build_network(lines, table, Config.TRANSFER_WALK_MIN)
    _cache[(region, day)] = (mtime, net)
    return net


def _now_service_minutes() -> int:
    now = datetime.now(subway_core.KST)
    t = now.hour * 60 + now.minute
    return t + 1440 if now.hour < SERVICE_DAY_START else t


def _base_line_name(name: str) -> str:
    """'수도권 1호선' -> '1호선' (지연 예측표가 노선 이름만 쓴다)"""
    return name.split(" ", 1)[1] if " " in name and name.split(" ", 1)[0] in kric.REGION_CODES else name


def _to_response(net: router.Network, legs: list[dict]) -> dict:
    out_legs = []
    for leg in legs:
        trains = router.leg_trains(net, leg["board"], leg["alight"])
        line_name = net.nodes[leg["board"]]["line_name"]
        out_legs.append(
            {
                "name": line_name,
                "from": net.nodes[leg["board"]]["name"],
                "to": net.nodes[leg["alight"]]["name"],
                "deps": [d for d, _ in trains],
                "arrs": [a for _, a in trains],
                "ride": round(statistics.median(a - d for d, a in trains)) if trains else 0,
                "xfer": leg["walk"],
                "line": _base_line_name(line_name),
            }
        )
    return {
        "name": " + ".join(l["name"] for l in out_legs),
        "board": out_legs[0]["from"],
        "walkM": 0,
        "legs": out_legs,
    }


@bp.post("/routes")
@require_auth
def find():
    body = request.get_json(silent=True) or {}
    origin = str(body.get("from") or "")
    raw_targets = body.get("to") or []
    if not ID_PATTERN.fullmatch(origin) or not isinstance(raw_targets, list) or not raw_targets:
        return jsonify(error="출발역과 도착역을 확인해 주세요."), 400
    targets_tago = {}
    for t in raw_targets[:MAX_TARGETS]:
        tid, walk = str((t or {}).get("id") or ""), (t or {}).get("walk", 0)
        if ID_PATTERN.fullmatch(tid) and isinstance(walk, (int, float)) and 0 <= walk <= MAX_HOME_WALK_MIN:
            targets_tago[tid] = round(walk)
    if not targets_tago:
        return jsonify(error="출발역과 도착역을 확인해 주세요."), 400

    region = kric.REGION_CODES[subway_core.region_of(origin)]
    daily = subway_core.daily_type()
    day_label = subway_core.DAILY_LABELS[daily]
    net = _network(region, kric.DAY_CODES[daily])
    if net is None:
        if kric_net.is_building():
            return jsonify(routes=[], day=day_label, note="지하철 시간표 자료를 받는 중이에요. 몇 분 뒤 다시 열어 주세요.")
        current_app.logger.warning("[routes] %s/%s 시간표 자료가 없어요. 서버를 다시 켜면 받기 시작해요", region, daily)
        return jsonify(routes=[], day=day_label, note="이 지역의 오늘 시간표 자료가 아직 준비되지 않았어요.")

    origin_node = net.by_tago.get(origin)
    targets = {net.by_tago[t]: w for t, w in targets_tago.items() if t in net.by_tago}
    if origin_node is None or not targets:
        return jsonify(routes=[], day=day_label, note="이 역은 아직 경로를 계산할 수 없어요.")

    found = router.find_routes(net, origin_node, targets, _now_service_minutes())
    return jsonify(routes=[_to_response(net, legs) for legs in found], day=day_label, note="")

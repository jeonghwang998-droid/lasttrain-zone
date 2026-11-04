"""막차 자기장: 역마다 '늦어도 몇 시에 타면 집에 갈 수 있는지'

요청: POST /api/zone  { to: [{ id: 도착 후보 역 id, walk: 그 역에서 집까지 걷는 분 }] }  (경로 찾기와 같은 도착 후보)
응답: { day, now, stations: { 역 id: 마감 시각(분) }, note }
     시각은 서비스 날 기준 분이다 (새벽 4시 전은 +1440). 갈 수 없는 역은 빠진다
화면은 내 주변 역마다 (마감 - 지금) × 걷는 속도 만큼의 원을 그린다. 시간이 지나면 원이 줄어든다 (README 6-2)
"""
from flask import Blueprint, jsonify, request

from ..auth import require_auth
from ..core import subway as subway_core
from ..core import transit_router as router
from ..services import kric_client as kric
from .routes import _network, _now_service_minutes, parse_targets, unavailable_note

bp = Blueprint("zone", __name__)


@bp.post("/zone")
@require_auth
def my_zone():
    targets_tago = parse_targets((request.get_json(silent=True) or {}).get("to"))
    if not targets_tago:
        return jsonify(error="도착역을 확인해 주세요."), 400

    region = kric.REGION_CODES[subway_core.region_of(next(iter(targets_tago)))]
    daily = subway_core.daily_type()
    day_label = subway_core.DAILY_LABELS[daily]
    now = _now_service_minutes()
    net = _network(region, kric.DAY_CODES[daily])
    if net is None:
        return jsonify(day=day_label, now=now, stations={}, note=unavailable_note(region, daily))

    targets = {net.by_tago[t]: w for t, w in targets_tago.items() if t in net.by_tago}
    if not targets:
        return jsonify(day=day_label, now=now, stations={}, note="집 근처 역은 아직 막차를 계산할 수 없어요.")

    deadlines = router.latest_departures(net, targets, now)
    stations = {net.nodes[n]["tago"]: t for n, t in deadlines.items()}
    return jsonify(day=day_label, now=now, stations=stations, note="")

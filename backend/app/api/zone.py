"""자기장"""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth

bp = Blueprint("zone", __name__)


def _todo():
    return jsonify(error="not implemented"), 501



@bp.get("/zone")
@require_auth
def my_zone():
    # TODO
    # 1. 집 역 조회
    # 2. cache 키: zone:{집 역}:{요일}:{강수 구간}
    # 3. core.zone.latest_departures(집 역, ...) → 역별 마지노선
    # 4. {"stations": [{id, name, lat, lng, deadline}]}
    return _todo()

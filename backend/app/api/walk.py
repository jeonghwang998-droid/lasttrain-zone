"""보행 기록"""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth

bp = Blueprint("walk", __name__)


def _todo():
    return jsonify(error="not implemented"), 501



@bp.post("/walk-trips")
@require_auth
def add_walk_trip():
    # TODO: WalkTripRequest → walk_trips insert → ml.walk_speed.personal_speed 로 새 속도 반환
    return _todo()

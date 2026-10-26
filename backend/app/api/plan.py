"""내 막차 계산"""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth

bp = Blueprint("plan", __name__)


def _todo():
    return jsonify(error="not implemented"), 501



@bp.post("/plan")
@require_auth
def plan():
    # TODO
    # 1. PlanRequest 검증
    # 2. 집 좌표/여유 시간 조회 (services/db.py)
    # 3. 경로 후보: cache.get → 없으면 transit_client.search_routes → cache.set
    # 4. 강수량: weather_client.current_rain
    # 5. core.last_train 역산 + ml.delay_model 지연 보정 + core.probability + core.taxi
    # 6. alert_queue 에 30/10/0분 전 알림 재예약, room_members.leave_at 갱신
    return _todo()

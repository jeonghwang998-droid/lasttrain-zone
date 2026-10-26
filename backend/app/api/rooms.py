"""모임방"""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth

bp = Blueprint("rooms", __name__)


def _todo():
    return jsonify(error="not implemented"), 501



@bp.post("/rooms")
@require_auth
def create_room():
    # TODO: 6자리 코드 생성(중복 확인) → rooms, room_members(방장) insert
    return _todo()


@bp.post("/rooms/join")
@require_auth
def join_room():
    # TODO: 코드로 방 찾기 → active/만료 확인 → room_members insert
    return _todo()


@bp.get("/rooms/<room_id>/zone")
@require_auth
def room_zone(room_id):
    # TODO: 멤버 확인 → 멤버별 자기장 → core.zone.intersect_h3 → {"cells": [...]}
    return _todo()


@bp.post("/rooms/<room_id>/call")
@require_auth
def call_everyone(room_id):
    # TODO: 멤버 확인 → 방 전체 즉시 알림 (alert_queue 에 now 로 넣기)
    return _todo()


@bp.patch("/rooms/<room_id>/me")
@require_auth
def update_my_status(room_id):
    # TODO: UpdateMyStatusRequest → room_members.status 갱신 (Realtime 으로 자동 전파)
    #       leaving/arrived 면 내 알림 취소
    return _todo()

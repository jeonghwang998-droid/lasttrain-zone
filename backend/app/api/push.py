"""웹 푸시 구독"""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth

bp = Blueprint("push", __name__)


def _todo():
    return jsonify(error="not implemented"), 501



@bp.post("/push/subscribe")
@require_auth
def subscribe():
    # TODO: PushSubscribeRequest → push_subscriptions upsert (endpoint 기준)
    return _todo()

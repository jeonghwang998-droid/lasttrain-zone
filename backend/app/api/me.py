"""로그인한 사용자 확인: 토큰이 누구 것인지 알아보고 프로필을 돌려준다"""
import requests
from flask import Blueprint, g, jsonify

from ..auth import require_auth
from ..config import Config

bp = Blueprint("me", __name__)


@bp.get("/me")
@require_auth
def me():
    if not Config.SUPABASE_URL or not Config.SUPABASE_ANON_KEY:
        return jsonify(error="서버 설정이 아직 끝나지 않았어요."), 503

    # 사용자 본인의 토큰으로 읽는다. service role 을 쓰지 않으니 RLS 가 그대로 적용된다
    try:
        res = requests.get(
            f"{Config.SUPABASE_URL}/rest/v1/profiles",
            params={"select": "nickname,buffer_min,walk_speed", "id": f"eq.{g.user_id}"},
            headers={
                "apikey": Config.SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {g.token}",
                "Accept": "application/vnd.pgrst.object+json",  # 한 줄이 아니면 오류로
            },
            timeout=5,
        )
    except requests.RequestException:
        return jsonify(error="프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."), 502

    if res.status_code in (404, 406):  # 해당 id 의 프로필이 없음
        return jsonify(error="프로필을 찾을 수 없어요."), 404
    if not res.ok:
        return jsonify(error="프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."), 502

    return jsonify(user_id=g.user_id, **res.json())

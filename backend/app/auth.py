"""Supabase 로그인 토큰(JWT) 검증

사용법:
    @bp.post("/plan")
    @require_auth
    def plan():
        user_id = g.user_id
"""
from functools import wraps

import jwt
from flask import g, jsonify, request

from .config import Config


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify(error="로그인이 필요해요."), 401
        try:
            # TODO: Supabase 프로젝트가 비대칭 서명 키(JWKS)를 쓰면 jwt.PyJWKClient 로 변경
            payload = jwt.decode(
                header.removeprefix("Bearer "),
                Config.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.PyJWTError:
            return jsonify(error="토큰이 유효하지 않아요."), 401
        g.user_id = payload["sub"]
        return fn(*args, **kwargs)

    return wrapper

"""Supabase 로그인 토큰(JWT) 검증

사용법:
    @bp.post("/plan")
    @require_auth
    def plan():
        user_id = g.user_id      # 토큰 주인
        token = g.token          # 사용자 권한(RLS)으로 Supabase 를 부를 때 그대로 전달

서명 방식은 토큰 헤더의 alg 로 고른다.
- ES256/RS256: Supabase 가 공개하는 키(JWKS)로 검증한다. 새 프로젝트의 기본값이고 비밀값이 필요 없다.
- HS256: 예전 방식. SUPABASE_JWT_SECRET 이 있어야 한다.
"""
from functools import wraps

import jwt
from flask import g, jsonify, request

from .config import Config

ASYMMETRIC_ALGS = ("ES256", "RS256")

_jwks_client = None


def _jwks():
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"{Config.SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _verify(token: str) -> dict:
    alg = jwt.get_unverified_header(token).get("alg")
    if alg == "HS256":
        if not Config.SUPABASE_JWT_SECRET:
            raise jwt.InvalidTokenError("HS256 토큰인데 SUPABASE_JWT_SECRET 이 비어 있음")
        key = Config.SUPABASE_JWT_SECRET
    elif alg in ASYMMETRIC_ALGS:
        key = _jwks().get_signing_key_from_jwt(token).key
    else:
        raise jwt.InvalidAlgorithmError(f"지원하지 않는 서명 방식: {alg}")
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated")


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify(error="로그인이 필요해요."), 401
        token = header.removeprefix("Bearer ")
        try:
            payload = _verify(token)
        except jwt.PyJWKClientConnectionError:
            return jsonify(error="인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."), 503
        except jwt.PyJWTError:
            return jsonify(error="로그인 정보가 유효하지 않아요. 다시 로그인해 주세요."), 401
        g.user_id = payload["sub"]
        g.token = token
        return fn(*args, **kwargs)

    return wrapper

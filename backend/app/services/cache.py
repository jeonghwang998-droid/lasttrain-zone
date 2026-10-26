"""Redis 캐시

키 규칙
- route:{출발 격자}:{집 역}          TTL 10분 (출발 위치는 약 100m 격자로 반올림)
- zone:{집 역}:{요일}:{강수 구간}     TTL 30분
- rain:{기상청 격자}                 TTL 30분
"""
import json

from ..config import Config

_client = None


def client():
    """TODO: redis.Redis.from_url(Config.REDIS_URL, decode_responses=True) 싱글턴"""
    raise NotImplementedError


def get_json(key: str):
    raise NotImplementedError


def set_json(key: str, value, ttl_sec: int) -> None:
    raise NotImplementedError

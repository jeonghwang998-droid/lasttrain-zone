"""기상청 단기예보 API

TODO
- current_rain(lat, lng) → 시간당 강수량(mm)
- 위경도 → 기상청 격자(nx, ny) 변환 필요
- 결과는 Redis 에 30분 캐시
"""
from ..config import Config


def current_rain(lat: float, lng: float) -> float:
    raise NotImplementedError

"""ODsay 대중교통 API

TODO
- search_routes(sx, sy, ex, ey) → 경로 후보 (구간별 노선, 탑승역, 환승 정보)
- 응답을 core.last_train 의 Route / Leg 로 변환
- 막차 시각이 응답에 없으면 backend/data/timetables 에서 보충
"""
from ..config import Config


def search_routes(sx: float, sy: float, ex: float, ey: float) -> list[dict]:
    raise NotImplementedError

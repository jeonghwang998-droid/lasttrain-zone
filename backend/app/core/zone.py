"""자기장 계산

1) latest_departures: 집 역에서 시간을 거꾸로 탐색해 '역별 마지노선'을 구한다 (README 6-2)
2) intersect_h3     : 멤버별 자기장을 H3 격자로 바꿔 교집합 셀을 구한다 (README 6-3)
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Station:
    station_id: str
    name: str
    lat: float
    lng: float


@dataclass
class Trip:
    """시간표의 '한 열차가 한 역에서 다음 역으로' 가는 구간"""
    train_no: str
    from_station: str
    to_station: str
    depart: int   # 분 (새벽은 +1440)
    arrive: int


def latest_departures(home_station: str, trips: list[Trip],
                      transfer_min: dict[str, int] | None = None) -> dict[str, int]:
    """역방향 탐색: {station_id: 이 역에서 늦어도 이 시각에는 타야 함(분)}

    TODO
    - 우선순위 큐(가장 늦은 시각 먼저, heapq 에 음수로 넣기)
    - to_station 기준으로 trips 를 인덱싱해두면 빠름
    - 같은 열차를 계속 타는 경우와 갈아타는 경우(환승 도보) 구분
    """
    raise NotImplementedError


def intersect_h3(zones: list[list[tuple[float, float, float]]],
                 center: tuple[float, float], radius_km: float = 5.0, res: int = 9) -> list[str]:
    """zones: 멤버별 [(lat, lng, 반경 m), ...] → 모든 멤버에게 안전한 H3 셀 목록

    TODO
    - import h3 → h3.latlng_to_cell(center, res), h3.grid_disk 로 후보 셀
    - 셀 중심(h3.cell_to_latlng)이 멤버의 원 중 하나에라도 들어가면 그 멤버에게 안전
    - 모든 멤버에게 안전한 셀만 반환
    """
    raise NotImplementedError

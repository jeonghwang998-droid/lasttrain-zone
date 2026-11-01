"""공공데이터포털 국토교통부(TAGO) 지하철정보 API

- GetKwrdFndSubwaySttnList : 지하철역 목록 (이름을 비우면 전체)
- GetSubwaySttnAcctoSchdulList : 역별 시간표 (평일/토/일, 상행/하행)
기능 이름은 대소문자를 구분한다 (맨 앞 G 가 대문자).
"""
import requests

from ..config import Config

BASE = "https://apis.data.go.kr/1613000/SubwayInfo"
PAGE_SIZE = 1000
TIMEOUT_SEC = 20


class SubwayApiError(Exception):
    """kind: 'not_configured' | 'unreachable' | 'rejected'"""

    def __init__(self, kind: str, detail: str = ""):
        super().__init__(f"{kind}: {detail}" if detail else kind)
        self.kind = kind


def _get(operation: str, **params) -> dict:
    if not Config.DATA_GO_KR_KEY:
        raise SubwayApiError("not_configured")
    try:
        res = requests.get(
            f"{BASE}/{operation}",
            params={"serviceKey": Config.DATA_GO_KR_KEY, "_type": "json", **params},
            timeout=TIMEOUT_SEC,
        )
        body = res.json()
    except (requests.RequestException, ValueError) as e:
        raise SubwayApiError("unreachable", type(e).__name__) from e

    response = body.get("response") or {}
    if (response.get("header") or {}).get("resultCode") != "00":
        err = (body.get("OpenAPI_ServiceResponse") or {}).get("cmmMsgHeader") or response.get("header") or {}
        raise SubwayApiError("rejected", str(err.get("errMsg") or err.get("resultMsg")))
    return response.get("body") or {}


def _items(body: dict) -> list[dict]:
    items = body.get("items")
    if not items:  # 결과가 없으면 빈 문자열로 온다
        return []
    one_or_many = items.get("item", [])
    return [one_or_many] if isinstance(one_or_many, dict) else one_or_many


def _all(operation: str, **params) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        body = _get(operation, numOfRows=PAGE_SIZE, pageNo=page, **params)
        got = _items(body)
        out += got
        if not got or len(out) >= int(body.get("totalCount") or 0):
            return out
        page += 1


def fetch_stations() -> list[dict]:
    """[{subwayStationId, subwayStationName, subwayRouteName}]"""
    return _all("GetKwrdFndSubwaySttnList")


def fetch_timetable(station_id: str, daily_type: str, up_down: str) -> list[dict]:
    """daily_type: 01 평일 / 02 토 / 03 일, up_down: U 상행 / D 하행"""
    return _all(
        "GetSubwaySttnAcctoSchdulList",
        subwayStationId=station_id,
        dailyTypeCode=daily_type,
        upDownTypeCode=up_down,
    )

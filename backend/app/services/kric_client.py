"""한국철도공사 철도 공공데이터 포털(KRIC) OpenAPI

- trainUseInfo/subwayRouteInfo    : 노선별 역 구성 순서 (권역 + 노선 코드)
- convenientInfo/stationTimetable : 역 시간표 (열차번호, 도착/출발 시각). 도시·광역철도만 있다
서비스키는 계정당 하나이고 기능(오퍼레이션)은 주소로 구분한다.
"""
import requests

from ..config import Config

BASE = "https://openapi.kric.go.kr/openapi/"
TIMEOUT_SEC = 30

# 권역 코드 (노선정보 API)
REGION_CODES = {"수도권": "01", "부산": "02", "대구": "03", "광주": "04", "대전": "05"}
# 요일 코드 (시간표 API): 공공데이터 TAGO 의 요일 구분(01 평일 / 02 토 / 03 일·휴일)과 맞춘다
DAY_CODES = {"01": "8", "02": "7", "03": "9"}


class KricApiError(Exception):
    """kind: 'not_configured' | 'unreachable' | 'rejected'"""

    def __init__(self, kind: str, detail: str = ""):
        super().__init__(f"{kind}: {detail}" if detail else kind)
        self.kind = kind


def _get(path: str, **params) -> list[dict]:
    if not Config.KRIC_API_KEY:
        raise KricApiError("not_configured")
    try:
        res = requests.get(BASE + path, params={"serviceKey": Config.KRIC_API_KEY, "format": "json", **params}, timeout=TIMEOUT_SEC)
        body = res.json()
    except (requests.RequestException, ValueError) as e:
        raise KricApiError("unreachable", type(e).__name__) from e
    header = body.get("header") or {}
    code = str(header.get("resultCode", ""))
    if code == "03":  # 데이터 없음
        return []
    if code != "00":
        raise KricApiError("rejected", f"{code} {header.get('resultMsg')}")
    items = body.get("body") or []
    return items if isinstance(items, list) else [items]


def route_info(region: str, line_code: str) -> list[dict]:
    """[{railOprIsttCd, lnCd, stinCd, stinNm, stinConsOrdr, routNm, ...}] (역 순서대로)"""
    return _get("trainUseInfo/subwayRouteInfo", mreaWideCd=region, lnCd=line_code)


def station_timetable(operator: str, line_code: str, station_code: str, day_code: str) -> list[dict]:
    """[{trnNo, arvTm, dptTm, orgStinCd, tmnStinCd, ...}]. day_code: 8 평일 / 7 토 / 9 휴일"""
    return _get(
        "convenientInfo/stationTimetable",
        railOprIsttCd=operator,
        lnCd=line_code,
        stinCd=station_code,
        dayCd=day_code,
    )

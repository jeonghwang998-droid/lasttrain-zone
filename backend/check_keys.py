"""키 연결 확인. backend 폴더에서 `python check_keys.py` 로 실행한다.

각 키가 설정되어 있는지, 실제로 호출이 되는지 확인하고 안 되면 이유를 한국어로 알려 준다.
키 값은 화면에 출력하지 않는다.
"""
import re
import sys
from pathlib import Path

import requests

from app.config import Config

sys.stdout.reconfigure(encoding="utf-8")

FRONTEND_CONFIG = Path(__file__).resolve().parents[1] / "frontend" / "src" / "js" / "config.js"
# 브라우저가 이 서버를 여는 주소. 카카오 키에 등록한 도메인과 같아야 한다
SERVER_ORIGINS = ("http://127.0.0.1:5000", "http://localhost:5000")
TIMEOUT = 15

# 공공데이터포털 오류 코드 (returnReasonCode)
DATA_GO_KR_REASONS = {
    "12": "서비스 주소가 없거나 폐기됐어요. 활용신청한 API의 명세서(Swagger)에서 요청 주소를 확인해야 해요.",
    "20": "이 API에 대한 활용 권한이 없어요. 활용신청이 승인됐는지 확인해 주세요.",
    "22": "오늘 호출 한도를 넘었어요.",
    "30": "등록되지 않은 인증키예요. 키를 다시 복사하거나(Decoding 키), 승인 직후라면 잠시 뒤 다시 시도해 주세요.",
    "31": "인증키 사용 기한이 끝났어요.",
    "32": "허용되지 않은 IP예요.",
}

results = []


def report(name, ok, msg):
    results.append(ok)
    print(f"[{'성공' if ok else '실패'}] {name}: {msg}")


def check_supabase():
    if not Config.SUPABASE_URL or not Config.SUPABASE_ANON_KEY:
        return report("Supabase", False, ".env 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없어요.")
    try:
        res = requests.get(
            f"{Config.SUPABASE_URL}/auth/v1/settings", headers={"apikey": Config.SUPABASE_ANON_KEY}, timeout=TIMEOUT
        )
    except requests.RequestException:
        return report("Supabase", False, "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.")
    report("Supabase", res.ok, "연결됐어요." if res.ok else f"키가 거절됐어요. (HTTP {res.status_code})")


def check_kakao():
    text = FRONTEND_CONFIG.read_text(encoding="utf-8") if FRONTEND_CONFIG.exists() else ""
    m = re.search(r"KAKAO_JS_KEY\s*=\s*'([^']*)'", text)
    key = m.group(1) if m else ""
    if not key:
        return report("카카오 JavaScript 키", False, "frontend/src/js/config.js 의 KAKAO_JS_KEY 가 비어 있어요.")
    for origin in SERVER_ORIGINS:
        try:
            res = requests.get(
                "https://dapi.kakao.com/v2/maps/sdk.js",
                params={"appkey": key, "libraries": "services", "autoload": "false"},
                headers={"Referer": origin + "/"},
                timeout=TIMEOUT,
            )
        except requests.RequestException:
            report(f"카카오 ({origin})", False, "서버에 연결하지 못했어요.")
            continue
        if res.ok:
            report(f"카카오 ({origin})", True, "도메인이 등록돼 있어요.")
        elif "domain mismatched" in res.text:
            report(f"카카오 ({origin})", False, "이 주소가 카카오에 등록돼 있지 않아요. 개발자 콘솔의 웹 도메인에 그대로 추가해 주세요.")
        else:
            report(f"카카오 ({origin})", False, f"키가 거절됐어요. (HTTP {res.status_code})")


def check_data_go_kr():
    if not Config.DATA_GO_KR_KEY:
        return report("공공데이터포털", False, ".env 에 DATA_GO_KR_KEY 가 없어요. (Decoding 인증키를 넣어 주세요)")
    # TAGO 지하철정보 (기능 이름은 대소문자 구분)
    url = "https://apis.data.go.kr/1613000/SubwayInfo/GetKwrdFndSubwaySttnList"
    try:
        res = requests.get(
            url, params={"serviceKey": Config.DATA_GO_KR_KEY, "subwayStationName": "서울", "_type": "json", "numOfRows": 1}, timeout=TIMEOUT
        )
        body = res.json()
    except (requests.RequestException, ValueError):
        return report("공공데이터포털", False, "응답을 받지 못했거나 형식이 달라요.")
    header = body.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader")
    if header:
        code = str(header.get("returnReasonCode", ""))
        return report("공공데이터포털", False, DATA_GO_KR_REASONS.get(code, f"오류 코드 {code}: {header.get('errMsg')}"))
    result = body.get("response", {}).get("header", {})
    ok = str(result.get("resultCode")) == "00"
    report("공공데이터포털", ok, "키가 정상이에요." if ok else f"오류: {result.get('resultMsg')}")


if __name__ == "__main__":
    check_supabase()
    check_kakao()
    check_data_go_kr()
    print()
    print("모두 연결됐어요." if all(results) else "연결되지 않은 항목이 있어요. 위 안내대로 고친 뒤 다시 실행해 보세요.")
    sys.exit(0 if all(results) else 1)

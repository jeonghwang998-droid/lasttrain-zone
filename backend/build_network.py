"""지하철 연결망 자료 만들기 (KRIC). backend 폴더에서 실행한다.

    python build_network.py                  # 수도권, 평일
    python build_network.py --day 03         # 수도권, 토·일·휴일 (01 평일 / 02 토 / 03 일·휴일. 토요일은 휴일 시간표)
    python build_network.py --region 부산
    python build_network.py --rediscover     # 노선 목록을 다시 찾는다

시간표는 역마다 한 번씩 받아서 시간이 걸린다. 중간에 끊기면 다시 실행하면 이어서 받는다.
"""
import argparse
import sys

from app import create_app
from app.api.subway import _load_catalog
from app.services import kric_client as kric
from app.services import kric_network as net

sys.stdout.reconfigure(encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description="KRIC 지하철 연결망 자료 만들기")
    p.add_argument("--region", default="수도권", choices=list(kric.REGION_CODES))
    p.add_argument("--day", default="01", choices=list(kric.DAY_CODES), help="01 평일 / 02 토 / 03 일·휴일")
    p.add_argument("--rediscover", action="store_true", help="노선 목록을 다시 찾는다")
    p.add_argument("--lines-only", action="store_true", help="노선 목록만 찾고 시간표는 받지 않는다")
    a = p.parse_args()

    region = kric.REGION_CODES[a.region]
    app = create_app()
    with app.app_context():
        try:
            if a.rediscover or not net.load_lines(region):
                net.discover_lines(a.region, _load_catalog()["lines"])
            lines = net.load_lines(region)
            print(f"노선 {len(lines)}개, 역 {sum(len(l['stations']) for l in lines)}개")
            if not a.lines_only:
                net.build_timetables(region, kric.DAY_CODES[a.day])
        except kric.KricApiError as e:
            msgs = {
                "not_configured": ".env 에 KRIC_API_KEY 가 없어요.",
                "unreachable": "KRIC 서버에 연결하지 못했어요. 잠시 후 다시 실행해 주세요.",
                "rejected": "KRIC 가 요청을 거절했어요 (키 문제나 하루 호출 한도일 수 있어요). 받은 만큼은 저장했으니 나중에 다시 실행하면 이어서 받아요.",
            }
            print(msgs.get(e.kind, "처리하지 못했어요."), f"({e})")
            sys.exit(1)


if __name__ == "__main__":
    main()

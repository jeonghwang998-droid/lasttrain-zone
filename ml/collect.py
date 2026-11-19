"""실제 열차 도착·출발 시각 수집기: 서울시 지하철 실시간 열차 위치정보(OA-12601) → DB train_arrivals

노선마다 한 번 불러 운행 중인 열차 전부를 받는다. 열차 상태가 '도착'(trainSttus=1)이면 그 기록 시각(recptnDt)을
실제 도착 시각으로, '출발'(2)이면 실제 출발 시각으로 본다 (event 'arr' / 'dep').
같은 열차·역·운행일의 도착과 출발은 각각 처음 본 것 하나만 남긴다.

시간표(KRIC)와 짝 맞추기:
  - 역   : 같은 노선에서 괄호를 뗀 역 이름이 같은 역 (예: API '교대' = KRIC '교대(법원.검찰청)')
  - 열차 : 숫자만 남긴 열차번호가 같은 열차 (예: API '0471' = KRIC 'K471')
           그런 열차가 여럿이면 시간표 시각이 가장 가까운 것, 그래도 ml.delay_valid_range 밖이면 못 맞춘 것
  - 못 맞춘 기록은 DB 에 넣지 않고 ml/data/unmatched_<운행일>.csv 에 남긴다 (짝 맞추기 규칙을 고칠 때 본다)

지연 계산(실제 − 시간표)은 DB 뷰 train_delays 가 한다. 학습: python ml/train.py --source db

실행 (어느 폴더에서나, 키는 루트 .env 의 SEOUL_OPENAPI_KEY):
  python ml/collect.py                    # 21:00 ~ 01:30 동안, 하루 호출 한도에 맞춘 간격으로 (시작 전이면 기다린다)
  python ml/collect.py --now              # 시간대 상관없이 바로 시작 (Ctrl+C 로 끝)
  python ml/collect.py --once --dry-run   # 한 번만 불러 짝 맞추기 결과만 보기 (DB 에 안 넣음)
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Config  # noqa: E402,F401  (루트 .env 를 읽는다)
from app.core.subway import KST, SERVICE_DAY_START  # noqa: E402
from app.services import db  # noqa: E402
from app.services import kric_network as net  # noqa: E402

API_URL = "http://swopenapi.seoul.go.kr/api/subway/{key}/json/realtimePosition/0/{rows}/{line}"
MAX_ROWS = 500          # 한 노선에서 한 번에 받을 열차 수 (가장 많은 1호선도 낮에 80대 안팎)
TIMEOUT_SEC = 15
# trainSttus(0 진입, 1 도착, 2 출발, 3 전역출발) → 기록 종류. 진입·전역출발은 시간표에 맞출 시각이 없어 쓰지 않는다
EVENTS = {"1": "arr", "2": "dep"}
OK_CODES = {"INFO-000", "INFO-200"}  # 정상 / 해당 데이터 없음 (운행 끝난 노선)
LIMIT_CODE = "ERROR-337"             # 하루 호출 한도를 넘음
LIMIT_WAIT_SEC = 600                 # 한도에 걸리면 이만큼 쉬었다가 한 노선만 다시 불러 본다
SOURCE = "seoul_realtime"
REGION = "01"           # 수도권 KRIC 자료 (backend/data/kric)
UNMATCHED_DIR = ROOT / "ml" / "data"

# 실시간 API 노선 이름 → KRIC 노선 이름 (lines_01.json).
# 김포골드·인천1·2호선·에버라인·의정부경전철은 이 API 가 주지 않아 뺐다 (2026-11-17 확인)
LINES = {
    "1호선": "수도권 1호선", "2호선": "수도권 2호선", "3호선": "수도권 3호선", "4호선": "수도권 4호선",
    "5호선": "5호선", "6호선": "6호선", "7호선": "7호선", "8호선": "8호선", "9호선": "9호선",
    "경의중앙선": "경의중앙", "공항철도": "공항", "경춘선": "경춘", "수인분당선": "수인분당",
    "신분당선": "신분당", "우이신설선": "우이신설", "서해선": "서해선", "경강선": "경강",
    "GTX-A": "GTX-A", "신림선": "신림선",
}

# 수집 기본값 (실행할 때 바꿀 수 있다). 막차 시간대만 모아 호출 수를 아낀다
# 실시간 키의 하루 호출 한도: 2026-11-17 약 1,000번째에서 ERROR-337 (노선 하나 = 1번)
DEFAULT_DAILY_LIMIT = 1000
LIMIT_MARGIN = 0.9         # 시험 호출 등 여유분을 남긴다
MIN_INTERVAL_SEC = 20
# 간격이 길어도 괜찮다: 한 번 부를 때마다 '도착' 상태로 서 있는 열차가 수백 대 잡힌다 (모든 도착이 아니라 표본을 모은다)
DEFAULT_START = "21:00"
DEFAULT_END = "01:30"


def base_name(name: str) -> str:
    """'교대(법원.검찰청)' → '교대', '응암(하선-종착)' → '응암'"""
    return re.sub(r"\(.*?\)|\s|역$", "", name or "")


def digits(train_no: str) -> str:
    """'K0471' → '471' (열차번호 앞 글자와 앞자리 0 은 기관마다 달라서 숫자만 비교한다)"""
    d = re.sub(r"\D", "", train_no or "")
    return d.lstrip("0") or "0"


def service_day(t: datetime) -> date:
    """새벽 SERVICE_DAY_START 시 전 도착은 전날 운행"""
    return (t - timedelta(hours=SERVICE_DAY_START)).date()


def day_code(d: date) -> str:
    """train_delays 뷰와 같은 규칙: 토·일 '9', 나머지 '8' (공휴일은 아직 평일로 잡힘)"""
    return "9" if d.isoweekday() >= 6 else "8"


class Matcher:
    """실시간 기록 한 줄 → 시간표 형식(station_key, train_no). 못 맞추면 이유를 돌려준다"""

    def __init__(self, window_min: float):
        lines = net.load_lines(REGION)
        if not lines:
            raise SystemExit("KRIC 노선 자료가 없어요. backend 폴더에서 python build_network.py 로 먼저 받아 주세요.")
        self.window = window_min
        self.stations = defaultdict(list)  # (KRIC 노선 이름, 역 이름) → [station_key]
        for line in lines:
            for st in line["stations"]:
                self.stations[(line["name"], base_name(st["name"]))].append(net.node_key(st["opr"], line["line"], st["stin"]))
        self.trains = {}  # 요일 코드 → station_key → 숫자 열차번호 → [(열차번호, 도착 예정 분, 출발 예정 분)]
        for code in ("8", "9"):
            table = net.load_timetable(REGION, code)
            if not table:
                raise SystemExit(f"KRIC 시간표({code})가 없어요. backend 폴더에서 python build_network.py 로 먼저 받아 주세요.")
            idx = {}
            for key, rows in table.items():
                by_no = defaultdict(list)
                for no, arr, dep in rows:
                    if no and (arr is not None or dep is not None):
                        by_no[digits(no)].append((no, arr, dep))
                idx[key] = by_no
            self.trains[code] = idx

    def match(self, api_line: str, item: dict, event: str, at: datetime) -> dict | str:
        """event 'arr' 은 도착 예정, 'dep' 은 출발 예정과 비교한다 (그 시각이 없으면 다른 쪽)"""
        keys = self.stations.get((LINES[api_line], base_name(item.get("statnNm"))))
        if not keys:
            return "역 이름 없음"
        sday = service_day(at)
        actual = (at - datetime.combine(sday, datetime.min.time(), KST)).total_seconds() / 60
        table = self.trains[day_code(sday)]
        best = None
        for key in keys:
            for no, arr, dep in table.get(key, {}).get(digits(item.get("trainNo")), []):
                sched = (dep if dep is not None else arr) if event == "dep" else (arr if arr is not None else dep)
                gap = actual - sched
                if best is None or abs(gap) < abs(best[0]):
                    best = (gap, key, no)
        if best is None:
            return "열차번호 없음"
        if abs(best[0]) > self.window:
            return "시간 차이 큼"
        return {
            "service_date": sday.isoformat(),
            "train_no": best[2],
            "station_key": best[1],
            "direction": item.get("updnLine"),
            "arrived_at": at.isoformat(),
            "event": event,
            "source": SOURCE,
            "raw_train_no": item.get("trainNo"),
            "raw_station_id": item.get("statnId"),
        }


class LimitReached(RuntimeError):
    """하루 호출 한도를 다 썼다"""


def fetch(key: str, api_line: str) -> list[dict]:
    """한 노선의 운행 중인 열차 전부. 운행이 끝난 노선은 빈 목록"""
    url = API_URL.format(key=key, rows=MAX_ROWS, line=urllib.parse.quote(api_line))
    res = requests.get(url, timeout=TIMEOUT_SEC)
    res.raise_for_status()
    body = res.json()
    info = body.get("errorMessage") or body
    code = info.get("code") or info.get("CODE")
    if code == LIMIT_CODE:
        raise LimitReached("오늘 호출 한도를 다 썼어요")
    if code not in OK_CODES:
        raise RuntimeError(f"서울 API 응답 코드 {code}")  # 키 오류, 호출 한도 넘음 등 (원문 메시지는 키가 섞일 수 있어 안 쓴다)
    return body.get("realtimePositionList") or []


class Collector:
    def __init__(self, key: str, matcher: Matcher, dry_run: bool):
        self.key, self.matcher, self.dry_run = key, matcher, dry_run
        self.seen: set[tuple] = set()        # 이미 처리한 (운행일, 원본 열차번호, 원본 역 id, 기록 종류)
        self.pending: list[dict] = []        # DB 에 아직 못 넣은 줄 (다음 회차에 다시 보낸다)
        self.total = Counter()

    def round(self) -> Counter:
        stat = Counter()
        rows, missed = [], []
        for api_line in LINES:
            try:
                items = fetch(self.key, api_line)
            except LimitReached:
                stat["한도"] += 1
                break  # 나머지 노선도 똑같이 막히니 호출을 아낀다
            except Exception as e:  # 한 노선이 실패해도 다른 노선은 계속
                stat["API 실패"] += 1
                print(f"  [{api_line}] 불러오지 못했어요 ({e if isinstance(e, RuntimeError) else type(e).__name__})")
                continue
            for it in items:
                event = EVENTS.get(it.get("trainSttus"))
                if not event or not it.get("recptnDt"):
                    continue
                at = datetime.strptime(it["recptnDt"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
                seen_key = (service_day(at), it.get("trainNo"), it.get("statnId"), event)
                if seen_key in self.seen:
                    continue
                self.seen.add(seen_key)
                got = self.matcher.match(api_line, it, event, at)
                if isinstance(got, dict):
                    rows.append(got)
                    stat["맞춤"] += 1
                    stat["맞춤: " + event] += 1
                else:
                    missed.append({"line": api_line, "event": event, "reason": got, "station": it.get("statnNm"), "station_id": it.get("statnId"),
                                   "train_no": it.get("trainNo"), "recptn_dt": it.get("recptnDt"), "updn": it.get("updnLine")})
                    stat["못 맞춤: " + got] += 1
        self._save(rows)
        self._log_missed(missed)
        self.total.update(stat)
        return stat

    def _save(self, rows: list[dict]) -> None:
        self.pending.extend(rows)
        if self.dry_run or not self.pending:
            return
        try:
            db.upsert("train_arrivals", self.pending, on_conflict="service_date,train_no,station_key,event", keep_existing=True)
            self.total["DB 저장"] += len(self.pending)
            self.pending = []
        except db.DbError as e:
            print(f"  DB 저장 실패, 다음 회차에 다시 보내요 ({len(self.pending)}줄): {e}")

    def _log_missed(self, missed: list[dict]) -> None:
        if not missed:
            return
        UNMATCHED_DIR.mkdir(parents=True, exist_ok=True)
        by_day = defaultdict(list)
        for m in missed:
            by_day[service_day(datetime.strptime(m["recptn_dt"], "%Y-%m-%d %H:%M:%S"))].append(m)
        for d, ms in by_day.items():
            path = UNMATCHED_DIR / f"unmatched_{d:%Y%m%d}.csv"
            new = not path.exists()
            with path.open("a", newline="", encoding="utf-8-sig") as f:
                w = csv.DictWriter(f, fieldnames=list(ms[0]))
                if new:
                    w.writeheader()
                w.writerows(ms)


def window_bounds(now: datetime, start: str, end: str) -> tuple[datetime, datetime]:
    """오늘 운행일의 수집 시작·끝 시각. 끝이 시작보다 이르면 다음 날 새벽"""
    sday = service_day(now)

    def at(hhmm: str, day: date) -> datetime:
        h, m = map(int, hhmm.split(":"))
        if h < SERVICE_DAY_START:  # 새벽 시각은 운행일 다음 날 달력 날짜 (예: 00:00 → 다음 날 0시)
            day += timedelta(days=1)
        return datetime.combine(day, datetime.min.time(), KST).replace(hour=h, minute=m)

    s = at(start, sday)
    e = at(end, sday)
    if e <= s:
        e += timedelta(days=1)
    return s, e


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # 윈도우 터미널에서 한글이 깨지지 않게
    ap = argparse.ArgumentParser(description="서울 실시간 열차 위치 → train_arrivals 수집")
    ap.add_argument("--interval", type=int, help="호출 간격(초). 안 주면 하루 한도와 수집 시간으로 계산")
    ap.add_argument("--daily-limit", type=int, default=DEFAULT_DAILY_LIMIT, help=f"실시간 키 하루 호출 한도, 기본 {DEFAULT_DAILY_LIMIT}")
    ap.add_argument("--start", default=DEFAULT_START, help=f"수집 시작 시각, 기본 {DEFAULT_START}")
    ap.add_argument("--end", default=DEFAULT_END, help=f"수집 끝 시각 (자정 넘어도 됨), 기본 {DEFAULT_END}")
    ap.add_argument("--now", action="store_true", help="시간대 상관없이 바로 시작해 Ctrl+C 까지 수집")
    ap.add_argument("--once", action="store_true", help="한 번만 불러 보고 끝")
    ap.add_argument("--dry-run", action="store_true", help="DB 에 넣지 않고 결과만 보기")
    args = ap.parse_args()

    key = os.environ.get("SEOUL_OPENAPI_KEY", "").strip()
    if not key:
        print("서울 실시간 지하철 인증키가 없어요. 루트 .env 의 SEOUL_OPENAPI_KEY 에 넣어 주세요.")
        return 1
    rng = db.config_value("ml.delay_valid_range")
    window = max(abs(float(rng["min"])), abs(float(rng["max"])))  # 이보다 차이가 크면 학습에서도 빠지므로 다른 열차로 본다
    print("시간표 불러오는 중…")
    col = Collector(key, Matcher(window), args.dry_run)

    if args.once:
        stat = col.round()
        print(f"한 번 수집: {dict(stat)}" + (" (DB 에 넣지 않음)" if args.dry_run else ""))
        for r in col.pending[:5] if args.dry_run else []:
            print("  ", r["service_date"], r["event"], r["station_key"], r["train_no"], "←", r["raw_train_no"], r["arrived_at"][11:19])
        return 0

    start, end = window_bounds(datetime.now(KST), args.start, args.end)
    if args.interval is None:  # 수집 시간 동안 한도의 LIMIT_MARGIN 만 쓰도록
        rounds = args.daily_limit * LIMIT_MARGIN / len(LINES)
        args.interval = max(MIN_INTERVAL_SEC, round((end - start).total_seconds() / rounds))
    if not args.now:
        now = datetime.now(KST)
        if now >= end:
            print(f"오늘 수집 시간({args.start}~{args.end})이 지났어요. --now 로 바로 시작할 수 있어요.")
            return 0
        if now < start:
            print(f"{start:%H:%M} 까지 기다려요… (바로 시작하려면 --now)")
            time.sleep((start - now).total_seconds())
    print(f"수집 시작: {args.interval}초마다 (하루 약 {args.daily_limit} 번 한도 기준), 노선 {len(LINES)}개" + ("" if args.now else f", {end:%H:%M} 까지") + " (끝내려면 Ctrl+C)")
    n = 0
    try:
        while args.now or datetime.now(KST) < end:
            t0 = time.time()
            n += 1
            stat = col.round()
            if stat["한도"]:
                print(f"{datetime.now(KST):%H:%M:%S} 오늘 호출 한도를 다 썼어요. {LIMIT_WAIT_SEC // 60}분 쉬었다가 다시 불러 볼게요.")
                time.sleep(LIMIT_WAIT_SEC)
                continue
            print(f"{datetime.now(KST):%H:%M:%S} {n}회차 새 기록 {stat['맞춤']}개 맞춤 (도착 {stat['맞춤: arr']}, 출발 {stat['맞춤: dep']}) / 못 맞춤 "
                  f"{sum(v for k, v in stat.items() if k.startswith('못'))}개 · 누적 저장 {col.total['DB 저장']:,}")
            time.sleep(max(0.0, args.interval - (time.time() - t0)))
    except KeyboardInterrupt:
        print("\n멈췄어요.")
    col._save([])  # 못 넣은 줄이 남았으면 마지막으로 한 번 더
    print(f"끝: {dict(col.total)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

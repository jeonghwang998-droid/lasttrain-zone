from datetime import datetime

from app.core import subway as s


def _station(sid, name, route):
    return {"subwayStationId": sid, "subwayStationName": name, "subwayRouteName": route}


def test_group_lines_numeric_first_then_name():
    lines = s.group_lines(
        [
            _station("MTRS1", "나", "수인분당"),
            _station("MTRS2", "가", "10호선"),
            _station("MTRS3", "다", "2호선"),
            _station("MTRS4", "가", "2호선"),
            _station("MTRS5", "하", "경춘"),
        ]
    )
    assert [line["name"] for line in lines] == ["2호선", "10호선", "경춘", "수인분당"]
    assert [x["name"] for x in lines[0]["stations"]] == ["가", "다"]  # 역은 가나다순


def test_same_line_name_in_different_cities_is_split_and_labeled():
    lines = s.group_lines(
        [
            _station("MTRS11", "서울역", "1호선"),
            _station("MTRBS11", "서면", "1호선"),
            _station("MTRDG11", "반월당", "1호선"),
            _station("MTRBS21", "센텀시티", "2호선"),
            _station("MTRS51", "광화문", "5호선"),
            _station("MTRBGB1", "사상", "부산김해경전철"),
        ]
    )
    names = [line["name"] for line in lines]
    assert names == ["수도권 1호선", "부산 1호선", "대구 1호선", "2호선", "5호선", "부산김해경전철"]
    busan_1 = next(line for line in lines if line["name"] == "부산 1호선")
    assert [x["name"] for x in busan_1["stations"]] == ["서면"]  # 서울역이 섞이지 않는다
    assert s.region_of("MTRBGB7") == "부산"  # 더 긴 접두어(MTRBGB)가 먼저 맞는다


def test_dep_minutes_wraps_past_midnight():
    assert s.dep_minutes("232000") == 23 * 60 + 20
    assert s.dep_minutes("002530") == 24 * 60 + 25
    assert s.dep_minutes("0") is None  # 도착만 있는 행
    assert s.dep_minutes("") is None


def test_last_trains_per_destination_latest_first():
    rows = [
        {"depTime": "232000", "upDownTypeCode": "D", "endSubwayStationNm": "오이도"},
        {"depTime": "004100", "upDownTypeCode": "D", "endSubwayStationNm": "오이도"},
        {"depTime": "235000", "upDownTypeCode": "U", "endSubwayStationNm": "당고개"},
        {"depTime": "0", "upDownTypeCode": "U", "endSubwayStationNm": "당고개"},
    ]
    out = s.last_trains(rows)
    assert [(t["end"], t["last"], t["count"]) for t in out] == [("오이도", "00:41", 2), ("당고개", "23:50", 1)]


def test_daily_type_uses_service_day():
    assert s.daily_type(datetime(2026, 11, 2, 22, 0, tzinfo=s.KST)) == "01"  # 월요일 밤
    assert s.daily_type(datetime(2026, 11, 7, 12, 0, tzinfo=s.KST)) == "02"  # 토요일
    assert s.daily_type(datetime(2026, 11, 8, 12, 0, tzinfo=s.KST)) == "03"  # 일요일
    # 토요일 밤을 넘긴 일요일 새벽 1시는 아직 토요일 운행일
    assert s.daily_type(datetime(2026, 11, 8, 1, 0, tzinfo=s.KST)) == "02"

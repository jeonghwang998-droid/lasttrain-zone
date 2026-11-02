"""경로 탐색 테스트. 노선망은 테스트용으로 만든 작은 것이다 (실제 노선과 무관)"""
from app.core import transit_router as tr

WALK = 4  # 같은 이름 역에서 갈아탈 때 걷는 분 (테스트용)


def _st(opr, stin, name):
    return {"opr": opr, "stin": stin, "name": name, "tago": f"MTR{opr}{stin}"}


# 출발역 A 는 L1, L3 두 노선이 지난다 (예: 부평역 1호선 / 인천1호선)
LINES = [
    {"line": "L1", "name": "1선", "stations": [_st("X", "a1", "A"), _st("X", "s1", "S"), _st("X", "z1", "Z")]},
    {"line": "L2", "name": "2선", "stations": [_st("X", "s2", "S"), _st("X", "t2", "T")]},
    {"line": "L3", "name": "3선", "stations": [_st("X", "a3", "A"), _st("X", "w3", "W")]},
    {"line": "L4", "name": "4선", "stations": [_st("X", "w4", "W"), _st("X", "u4", "U")]},
]


def _tt(*trains):
    """trains: (열차번호, [(node, 도착, 출발), ...]) → node 별 시간표"""
    out = {}
    for trn, stops in trains:
        for node, arr, dep in stops:
            out.setdefault(node, []).append([trn, arr, dep])
    return out


def _m(h, mm):
    return h * 60 + mm


TT = _tt(
    # L1: A → S (20분). 23:00, 23:30 출발
    ("101", [("X|L1|a1", _m(23, 0), _m(23, 0)), ("X|L1|s1", _m(23, 20), _m(23, 21))]),
    ("103", [("X|L1|a1", _m(23, 30), _m(23, 30)), ("X|L1|s1", _m(23, 50), _m(23, 51))]),
    # L2: S → T (15분). 막차 23:55 → 23:30 출발 L1 은 23:50 도착 + 걷기 4분 = 23:54 라서 탈 수 있다
    ("201", [("X|L2|s2", _m(23, 40), _m(23, 40)), ("X|L2|t2", _m(23, 55), _m(23, 55))]),
    ("203", [("X|L2|s2", _m(23, 55), _m(23, 55)), ("X|L2|t2", _m(24, 10), _m(24, 10))]),
    # L3: A → W (10분). 23:10 출발
    ("301", [("X|L3|a3", _m(23, 10), _m(23, 10)), ("X|L3|w3", _m(23, 20), _m(23, 20))]),
    # L4: W → U (10분). 23:40 출발
    ("401", [("X|L4|w4", _m(23, 40), _m(23, 40)), ("X|L4|u4", _m(23, 50), _m(23, 50))]),
)


def _net():
    return tr.build_network(LINES, TT, WALK)


def test_latest_route_with_transfer():
    routes = tr.find_routes(_net(), "X|L1|a1", {"X|L2|t2": 5, "X|L4|u4": 12}, not_before=_m(22, 0))
    best = routes[0]
    assert [(l["line"], l["board"], l["alight"]) for l in best] == [("L1", "X|L1|a1", "X|L1|s1"), ("L2", "X|L2|s2", "X|L2|t2")]
    assert best[0]["walk"] == WALK  # S 에서 L1 → L2 갈아타며 걷는다


def test_slower_route_that_must_leave_earlier_is_dropped():
    # L3+L4 는 23:10 에 떠나야 하고(L1+L2 는 23:30) 걸리는 시간도 같다(40분) → 보여줄 이유가 없다
    routes = tr.find_routes(_net(), "X|L1|a1", {"X|L2|t2": 5, "X|L4|u4": 12}, not_before=_m(22, 0))
    assert [[l["line"] for l in r] for r in routes] == [["L1", "L2"]]


def test_faster_alternative_from_same_name_station_is_kept():
    # L4 를 빠르게 바꾸면(5분) L3+L4 가 더 빠른 경로라서 남는다. 같은 이름 역 A 의 다른 노선에서 출발한다
    tt = {k: [row[:] for row in v] for k, v in TT.items()}
    tt["X|L4|u4"] = [["401", _m(23, 45), _m(23, 45)]]
    net = tr.build_network(LINES, tt, WALK)
    # 집까지: T 역에서 5분, U 역에서 0분 → L3+L4 는 집까지 35분, L1+L2 는 45분
    routes = tr.find_routes(net, "X|L1|a1", {"X|L2|t2": 5, "X|L4|u4": 0}, not_before=_m(22, 0))
    assert [[l["line"] for l in r] for r in routes] == [["L1", "L2"], ["L3", "L4"]]  # 늦게 출발 가능한 순


def test_latest_chain_uses_last_train_and_connects_backwards():
    c = tr.latest_chain(_net(), [{"line": "L1", "board": "X|L1|a1", "alight": "X|L1|s1", "walk": WALK},
                                 {"line": "L2", "board": "X|L2|s2", "alight": "X|L2|t2", "walk": 0}])
    assert c == {"leave": _m(23, 30), "arrive": _m(24, 10), "home": _m(24, 10)}  # L2 막차 23:55 에 맞는 L1 은 23:30


def test_gets_off_at_the_station_closest_to_home_not_the_first_one():
    # 한 열차가 F → G → H 순으로 간다. G(집까지 20분)보다 H(0분)에 내리는 게 집에 먼저 닿는다
    lines = [{"line": "P", "name": "선", "stations": [_st("W", "f", "F"), _st("W", "g", "G"), _st("W", "h", "H")]}]
    tt = _tt(("7", [("W|P|f", _m(23, 0), _m(23, 0)), ("W|P|g", _m(23, 5), _m(23, 5)), ("W|P|h", _m(23, 8), _m(23, 8))]))
    routes = tr.find_routes(tr.build_network(lines, tt, WALK), "W|P|f", {"W|P|g": 20, "W|P|h": 0}, not_before=_m(22, 0))
    assert routes[0][-1]["alight"] == "W|P|h"
    assert routes[0][-1]["walk"] == 0  # 집까지 걷는 시간은 환승 걷기로 나가지 않는다


def test_no_route_after_last_trains():
    assert tr.find_routes(_net(), "X|L1|a1", {"X|L2|t2": 5}, not_before=_m(23, 59)) == []


def test_leg_trains_only_pairs_of_the_same_train():
    net = _net()
    assert tr.leg_trains(net, "X|L1|a1", "X|L1|s1") == [(_m(23, 0), _m(23, 20)), (_m(23, 30), _m(23, 50))]
    assert tr.leg_trains(net, "X|L1|s1", "X|L1|a1") == []  # 반대 방향은 아님


def test_station_key_ignores_suffix_and_notes():
    assert tr.station_key("서울대입구(관악구청)") == tr.station_key("서울대입구역")


def test_transfers_at_the_first_station_instead_of_riding_past_and_back():
    # 열차 1: A → S → P(더 먼 역). S 와 P 둘 다에서 L2 로 갈아탈 수 있지만, S 에서 내려야 한다
    lines = [
        {"line": "M", "name": "본선", "stations": [_st("Z", "a", "A"), _st("Z", "s", "S"), _st("Z", "p", "P")]},
        {"line": "N", "name": "지선", "stations": [_st("Z", "p2", "P"), _st("Z", "s2", "S"), _st("Z", "t2", "T")]},
    ]
    tt = _tt(
        ("1", [("Z|M|a", _m(23, 0), _m(23, 0)), ("Z|M|s", _m(23, 10), _m(23, 10)), ("Z|M|p", _m(23, 20), _m(23, 20))]),
        # 지선: P → S → T. P 에서 23:30 출발, S 를 23:40 에 지난다
        ("2", [("Z|N|p2", _m(23, 30), _m(23, 30)), ("Z|N|s2", _m(23, 40), _m(23, 40)), ("Z|N|t2", _m(23, 50), _m(23, 50))]),
    )
    routes = tr.find_routes(tr.build_network(lines, tt, WALK), "Z|M|a", {"Z|N|t2": 0}, not_before=_m(22, 0))
    assert [(l["board"], l["alight"]) for l in routes[0]] == [("Z|M|a", "Z|M|s"), ("Z|N|s2", "Z|N|t2")]


def test_does_not_alight_before_boarding():
    # 순환하는 열차: T → A → S 순서. A 에서 타면 T 는 이미 지나갔으니 T 에서 내리는 경로를 만들면 안 된다
    lines = [{"line": "C", "name": "순환", "stations": [_st("Y", "t", "T"), _st("Y", "a", "A"), _st("Y", "s", "S")]}]
    tt = _tt(("9", [("Y|C|t", _m(23, 0), _m(23, 0)), ("Y|C|a", _m(23, 5), _m(23, 5)), ("Y|C|s", _m(23, 10), _m(23, 10))]))
    net = tr.build_network(lines, tt, WALK)
    assert tr.find_routes(net, "Y|C|a", {"Y|C|t": 0}, not_before=_m(22, 0)) == []

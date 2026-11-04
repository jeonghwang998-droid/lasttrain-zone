"""지하철 경로 탐색 (순수 로직: 외부 호출 없음)

열차번호가 있는 역 시간표로 '열차가 A역 몇 시 출발 → B역 몇 시 도착' 구간(connection)을 만들고,
목적지에서 시간을 거꾸로 훑어 '가장 늦게 출발해도 목적지에 닿는' 경로를 찾는다 (역방향 Connection Scan).
이름이 같은 역(예: 부평 1호선과 부평 인천1호선)은 걸어서 갈아탈 수 있는 곳으로 본다.

찾은 경로는 구간(노선, 탄 역, 내린 역)으로 돌려주고, 구간마다 그 사이를 실제로 다니는 열차의
출발/도착 시각 목록을 붙인다. 막차 역산과 지연 보정은 그 목록으로 화면(planner.js)이 한다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

NEG = float("-inf")
POS = float("inf")
MAX_HOP_MIN = 40  # 이웃한 두 정차 사이가 이보다 길면 잘못된 자료로 보고 버린다
MAX_RIDE_MIN = 240  # 한 구간을 타는 시간이 이보다 길면 같은 열차로 보지 않는다
MAX_LEGS = 6


@dataclass(frozen=True)
class Conn:
    dep_node: str
    arr_node: str
    dep: int
    arr: int
    trip: str
    line: str


@dataclass
class Network:
    """역(node) = 운영기관|노선|역코드. 같은 이름의 역도 노선마다 다른 node 다"""

    nodes: dict[str, dict]  # node -> {name, line, line_name, tago}
    conns: list[Conn]  # 출발 시각이 늦은 순
    rows: dict[str, dict[str, tuple[int, int]]]  # node -> {trip: (도착, 출발)}
    groups: dict[str, list[tuple[str, int]]]  # node -> [(걸어서 갈 수 있는 node, 분)] (자기 자신은 0분)
    by_tago: dict[str, str] = field(default_factory=dict)  # 공공데이터(TAGO) 역 id -> node


def station_key(name: str) -> str:
    """같은 역인지 비교하는 이름: 괄호 설명, 공백, 끝의 '역'을 뗀다"""
    return re.sub(r"\(.*?\)", "", name).replace(" ", "").removesuffix("역")


def build_network(lines: list[dict], timetable: dict[str, list], transfer_walk_min: int) -> Network:
    """lines: kric_network.discover_lines 결과, timetable: node -> [[열차번호, 도착, 출발], ...]"""
    nodes: dict[str, dict] = {}
    for line in lines:
        for st in line["stations"]:
            key = f"{st['opr']}|{line['line']}|{st['stin']}"
            nodes[key] = {"name": st["name"], "line": line["line"], "line_name": line["name"], "tago": st["tago"]}

    rows: dict[str, dict[str, tuple[int, int]]] = {}
    trips: dict[str, list[tuple[int, int, str]]] = {}
    for node, items in timetable.items():
        if node not in nodes:
            continue
        line = nodes[node]["line"]
        for trn, arr, dep in items:
            trip = f"{line}:{trn}"
            rows.setdefault(node, {})[trip] = (arr, dep)
            trips.setdefault(trip, []).append((dep, arr, node))

    conns = []
    for trip, stops in trips.items():
        stops.sort()
        for (dep_a, _, a), (_, arr_b, b) in zip(stops, stops[1:]):
            if a != b and 0 <= arr_b - dep_a <= MAX_HOP_MIN:
                conns.append(Conn(a, b, dep_a, arr_b, trip, nodes[a]["line"]))
    conns.sort(key=lambda c: c.dep, reverse=True)

    by_name: dict[str, list[str]] = {}
    for node, info in nodes.items():
        by_name.setdefault(station_key(info["name"]), []).append(node)
    groups = {
        node: [(other, 0 if other == node else transfer_walk_min) for other in by_name[station_key(info["name"])]]
        for node, info in nodes.items()
    }
    return Network(nodes, conns, rows, groups, {info["tago"]: node for node, info in nodes.items()})


Exit = tuple[Conn, "str | None", int]  # (내리는 구간, 갈아탈 node 또는 목적지면 None, 걷는 분)


@dataclass
class _Scan:
    latest: dict[str, float]  # node -> 늦어도 이 시각에 이 역에서 타면 목적지에 닿는다
    choice: dict[str, tuple[Conn, Exit]]  # node -> (그 시각에 타는 구간, 그 열차에서 내릴 곳)


def _scan(net: Network, targets: dict[str, int], banned: frozenset[str], not_before: int) -> _Scan:
    latest: dict[str, float] = {t: POS for t in targets}
    choice: dict[str, tuple[Conn, Exit]] = {}
    exits: dict[str, tuple[int, Exit]] = {}  # 열차 -> (순위, 지금까지 본 구간들 기준으로 내릴 곳)
    for c in net.conns:  # 늦게 출발하는 구간부터
        if c.dep < not_before:
            break
        if c.line in banned:
            continue
        # 이 구간 끝에서 내릴 수 있는지. 순위: 0 목적지, 1 다른 노선으로 환승, 2 같은 승강장에서 다음 열차
        exit_here, rank = None, 3
        if c.arr_node in targets:
            exit_here, rank = (c, None, targets[c.arr_node]), 0
        else:
            for other, walk in net.groups.get(c.arr_node, ()):
                r = 2 if other == c.arr_node else 1
                if r < rank and c.arr + walk <= latest.get(other, NEG):
                    exit_here, rank = (c, other, walk), r
        # 순위가 더 좋으면 바꾸고, 다른 노선 환승끼리는 더 앞쪽 역을 고른다 (지나쳤다 돌아오는 경로를 막는다).
        # 구간을 늦은 것부터 보므로 나중에 찾은 곳이 열차 기준으로 더 앞쪽이다
        # 목적지가 여러 곳이면(집 근처 역들) 도착 + 집까지 걷는 시간이 가장 이른 역에서 내린다
        current = exits.get(c.trip)
        home_sooner = (
            rank == 0
            and current is not None
            and current[0] == 0
            and c.arr + targets[c.arr_node] < current[1][0].arr + current[1][2]
        )
        if exit_here and (current is None or rank < current[0] or rank == current[0] == 1 or home_sooner):
            exits[c.trip] = (rank, exit_here)
        if c.trip in exits and c.dep > latest.get(c.dep_node, NEG):
            latest[c.dep_node] = c.dep
            # 내릴 곳은 지금 기준으로 저장한다. 더 앞쪽 구간을 보면서 내릴 곳이 바뀌어도
            # 이 역에서 탄 뒤에는 이미 지나간 역이라 쓸 수 없기 때문이다
            choice[c.dep_node] = (c, exits[c.trip][1])
    return _Scan(latest, choice)


def _journey(net: Network, origin: str, scan: _Scan) -> list[dict] | None:
    # 출발역과 같은 이름의 다른 노선 역까지 걸어가서 타는 것도 후보로 본다
    best = max(
        ((scan.latest.get(x, NEG) - w, x) for x, w in net.groups.get(origin, [(origin, 0)])),
        default=(NEG, None),
    )
    if best[0] == NEG:
        return None
    node = best[1]
    legs = []
    while len(legs) < MAX_LEGS:
        picked = scan.choice.get(node)
        if picked is None:
            return None
        c, (alight, nxt, walk) = picked
        if nxt is None:  # 목적지: walk 는 그 역에서 집까지 걷는 분 (경로 비교에만 쓴다)
            legs.append({"line": c.line, "board": node, "alight": alight.arr_node, "walk": 0, "home_walk": walk})
            return legs
        legs.append({"line": c.line, "board": node, "alight": alight.arr_node, "walk": walk})
        node = nxt
    return None


def latest_departures(net: Network, targets: dict[str, int], not_before: int) -> dict[str, int]:
    """막차 자기장: 역마다 '늦어도 이 시각에 이 역에서 타면 목적지에 닿는다'(분).
    같은 이름의 다른 노선으로 걸어가서 타는 편이 늦으면 그 시각을 쓴다. 목적지 역과 갈 수 없는 역은 빠진다"""
    latest = _scan(net, targets, frozenset(), not_before).latest
    out = {}
    for node in net.nodes:
        if node in targets:
            continue
        best = max((latest.get(x, NEG) - w for x, w in net.groups.get(node, [(node, 0)])), default=NEG)
        if NEG < best < POS:
            out[node] = int(best)
    return out


def leg_trains(net: Network, board: str, alight: str) -> list[tuple[int, int]]:
    """두 역 사이를 실제로 다니는 열차들의 (탄 역 출발, 내린 역 도착). 출발 순"""
    a, b = net.rows.get(board, {}), net.rows.get(alight, {})
    out = []
    for trip, (_, dep) in a.items():
        if trip in b:
            arr = b[trip][0]
            if 0 < arr - dep <= MAX_RIDE_MIN:
                out.append((dep, arr))
    return sorted(set(out))


def latest_chain(net: Network, legs: list[dict]) -> dict | None:
    """경로를 막차 기준으로 탈 때: 마지막 구간 막차에서 거꾸로, 갈아탈 수 있는 가장 늦은 열차를 고른다.
    반환: {leave: 첫 열차 출발, arrive: 마지막 역 도착, home: 집 도착(마지막 역 + 걷기)} (분). 이어지지 않으면 None"""
    deadline, arrive = None, None
    for leg in reversed(legs):
        trains = leg_trains(net, leg["board"], leg["alight"])
        ok = trains if deadline is None else [(d, a) for d, a in trains if a + leg["walk"] <= deadline]
        if not ok:
            return None
        dep, arr = max(ok)
        if arrive is None:
            arrive = arr
        deadline = dep
    return {"leave": deadline, "arrive": arrive, "home": arrive + legs[-1].get("home_walk", 0)}


def _efficient(routes: list[tuple[list[dict], dict]]) -> list[tuple[list[dict], dict]]:
    """다른 경로보다 나은 점이 하나도 없는 경로를 버린다.
    비교: 막차 기준 출발이 늦을수록, 집까지 걸리는 시간이 짧을수록, 환승이 적을수록 좋다.
    예) 더 일찍 떠나야 하고 더 오래 걸리고 환승도 많은 돌아가는 경로는 남지 않는다"""

    def score(item):
        legs, c = item
        return c["leave"], -(c["home"] - c["leave"]), -(len(legs) - 1)

    keep = []
    for item in routes:
        mine = score(item)
        dominated = any(
            all(o >= m for o, m in zip(score(other), mine)) and score(other) != mine for other in routes if other is not item
        )
        if not dominated:
            keep.append(item)
    return keep


def find_routes(
    net: Network, origin: str, targets: dict[str, int], not_before: int, max_routes: int = 4, max_scans: int = 12
) -> list[list[dict]]:
    """효율적인 경로를 막차 기준 출발이 늦은 순으로 최대 max_routes 개.
    가장 늦게 갈 수 있는 경로를 찾은 뒤 그 경로가 쓴 노선을 하나씩 빼고 다시 찾아 후보를 모으고,
    걸리는 시간, 환승, 막차 시각 모두에서 다른 후보보다 못한 경로는 버린다"""
    if origin not in net.nodes or not targets:
        return []
    found: list[list[dict]] = []
    seen: set[tuple] = set()
    queue: list[frozenset[str]] = [frozenset()]
    tried: set[frozenset[str]] = set()
    while queue and len(tried) < max_scans:
        banned = queue.pop(0)
        if banned in tried:
            continue
        tried.add(banned)
        legs = _journey(net, origin, _scan(net, targets, banned, not_before))
        if not legs:
            continue
        sig = tuple((l["line"], l["board"], l["alight"]) for l in legs)
        if sig not in seen:
            seen.add(sig)
            found.append(legs)
        queue.extend(banned | {l["line"]} for l in legs)

    scored = [(legs, c) for legs in found if (c := latest_chain(net, legs))]
    best = sorted(_efficient(scored), key=lambda item: -item[1]["leave"])
    return [legs for legs, _ in best[:max_routes]]

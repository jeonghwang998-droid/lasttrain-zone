from app.core.last_train import Leg, Route, latest_boardings, to_min

T = lambda *xs: [to_min(x) for x in xs]


def test_picks_train_that_catches_last_transfer():
    legs = [
        Leg("1호선", T("22:20", "22:41", "23:05"), ride=62, transfer_walk=3),
        Leg("4호선", T("23:40", "23:52", "00:08"), ride=30),
    ]
    # 23:05 를 타면 00:10 도착이라 00:08 막차를 놓침 → 22:41 이어야 함
    assert latest_boardings(legs) == [to_min("22:41"), to_min("00:08")]


def test_delay_pushes_to_earlier_train():
    legs = [
        Leg("1호선", T("22:41", "23:00"), ride=62, transfer_walk=3, line="1호선"),
        Leg("4호선", T("00:08"), ride=30, line="4호선"),
    ]
    assert latest_boardings(legs)[0] == to_min("23:00")
    assert latest_boardings(legs, extra_delay=lambda leg, dep: 5)[0] == to_min("22:41")


def test_midnight_is_after_evening():
    assert to_min("00:15") > to_min("23:50")

import pytest

from app.core.probability import route_probability


def test_route_probability_multiplies():
    assert route_probability([0.9, 0.9]) == pytest.approx(0.81)


@pytest.mark.skip(reason="TODO: leg_success_probability 구현 후 작성")
def test_leg_success_probability():
    ...

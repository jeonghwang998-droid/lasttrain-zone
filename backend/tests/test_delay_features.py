"""특징 생성과 '역 → 노선 → 데이터 부족' 대체 규칙"""
import numpy as np
import pandas as pd

from app.ml.delay_model import predict_frame, qcol
from app.ml.features import UNKNOWN, coarsen, level_for, make_features, support_counts

MIN = 3  # 시험용 최소 기록 수

TRAIN = pd.DataFrame({
    "line_name":   ["A선"] * 4 + ["A선"] * 1 + ["B선"] * 2,
    "station_key": ["a1"] * 4 + ["a2"] * 1 + ["b1"] * 2,
    "hour":        [22, 23, 24, 25, 22, 23, 24],
    "weekday":     [0, 1, 2, 3, 4, 5, 6],
})
SUPPORT = support_counts(TRAIN)  # a1 4개, a2 1개, A선 5개, B선 2개


def test_level_falls_back_station_line_none():
    assert level_for("A선", "a1", SUPPORT, MIN) == "station"
    assert level_for("A선", "a2", SUPPORT, MIN) == "line"      # 역 기록 부족 → 노선
    assert level_for("A선", "새역", SUPPORT, MIN) == "line"    # 처음 보는 역 → 노선
    assert level_for("B선", "b1", SUPPORT, MIN) == "none"      # 노선 기록도 부족


def test_coarsen_hides_thin_stations():
    out = coarsen(TRAIN, SUPPORT, MIN)
    assert set(out.loc[out.line_name == "A선", "station_key"]) == {"a1", UNKNOWN}
    assert (TRAIN["station_key"] == "a2").any()  # 원본은 그대로


def test_make_features_aligns_columns():
    X = make_features(coarsen(TRAIN, SUPPORT, MIN))
    assert "st_a1" in X.columns and "st_a2" not in X.columns and "line_A선" in X.columns
    one = pd.DataFrame({"line_name": ["C선"], "station_key": ["c9"], "hour": [23], "weekday": [4]})
    Y = make_features(one, list(X.columns))
    assert list(Y.columns) == list(X.columns)
    assert Y.filter(like="line_").sum(axis=1).iloc[0] == 0  # 처음 보는 노선은 모두 0


class _Const:
    """입력과 상관없이 같은 값을 내는 가짜 모델"""
    def __init__(self, v):
        self.v = v

    def predict(self, X):
        return np.full(len(X), self.v)


def test_predict_frame_skips_data_poor_rows():
    cols = list(make_features(coarsen(TRAIN, SUPPORT, MIN)).columns)
    bundle = {"quantiles": [0.5, 0.9], "columns": cols, "models": {0.5: _Const(1.0), 0.9: _Const(3.0)},
              "support": SUPPORT, "min_samples": MIN}
    rows = pd.DataFrame({"line_name": ["A선", "A선", "B선"], "station_key": ["a1", "a2", "b1"],
                         "hour": [23, 23, 23], "weekday": [4, 4, 4]})
    out = predict_frame(bundle, rows)
    assert list(out["level"]) == ["station", "line", "none"]
    assert list(out[qcol(0.9)][:2]) == [3.0, 3.0]
    assert np.isnan(out[qcol(0.9)].iloc[2])


def _bundle():
    cols = list(make_features(coarsen(TRAIN, SUPPORT, MIN)).columns)
    return {"version": "test", "data_source": "fake", "quantiles": [0.5, 0.9, 0.95], "columns": cols,
            "models": {0.5: _Const(1.0), 0.9: _Const(3.0), 0.95: _Const(5.0)},
            "support": SUPPORT, "min_samples": MIN, "reference": {"hour": 23, "weekday": 2}}


def test_delay_model_route_and_data_poor_leg():
    from app.ml.delay_model import DelayModel

    m = DelayModel(_bundle(), {"safe": 0.9, "caution": 0.7})
    ok = {"line_name": "A선", "station_key": "a1", "station_name": "에이", "arrive_min": 23 * 60, "walk_min": 2, "next_depart_min": 23 * 60 + 5}
    r = m.route([ok], weekday=4)
    leg = r["legs"][0]
    assert leg["slack_min"] == 3 and leg["probability"] == 0.9 and leg["grade"] == "안전"
    assert leg["expected_delay_min"] == 1.0 and leg["risk_delay_min"] == 3.0
    assert leg["reason"].startswith("(가짜 데이터)")
    poor = {**ok, "line_name": "B선", "station_key": "b1"}
    r2 = m.route([ok, poor], weekday=4)
    assert r2["probability"] is None and r2["grade"] == "데이터부족"
    assert r2["legs"][1]["probability"] is None and r2["legs"][1]["level"] == "none"


def test_load_active_survives_db_failure(monkeypatch):
    from app.ml import delay_model
    from app.services import db

    def boom(*a, **k):
        raise db.DbError("연결 실패")

    monkeypatch.setattr(db, "select", boom)
    delay_model.load_active()
    assert delay_model.active() is None
    assert "불러오지 못했어요" in delay_model.status()

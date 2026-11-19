"""지연 예측 모델 사용 (학습 평가와 서버가 함께 쓴다)

모델 묶음(bundle, joblib 파일 하나, ml/train.py 가 만든다):
  version, data_source('fake'|'db'), quantiles, columns(특징 순서), models({분위수: 회귀 모델}),
  support(학습 데이터의 역별·노선별 기록 수), min_samples(학습 당시 app_config ml.min_samples),
  reference(이유 문구용 기준 시간대·요일: 학습 데이터에서 가장 흔한 값)

- predict_frame(bundle, df) : 여러 줄을 한 번에 예측 → 분위수별 예측 지연(분)과 예측 단위(station/line/none)
- load_active()             : 서버 시작 때 DB ml_models 의 활성 모델을 불러온다. 없거나 실패해도 서버는 정상 (확률만 null)
- start_loading()           : 뒤에서 불러오고, 그 뒤 RELOAD_CHECK_SEC 마다 활성 모델이 바뀌었는지 보고 다시 불러온다
- DelayModel.leg / .route   : 환승 구간마다 막차 확률, 등급, 예상 지연(q50), 위험 지연(q90), 가장 큰 요인 한 줄
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from ..config import BASE_DIR
from ..core import probability as prob
from .features import UNKNOWN, coarsen, level_for, make_features

log = logging.getLogger(__name__)

# 출력 항목의 정의 (요청 사양): 예상 지연 = 중앙값(q50), 위험 지연 = q90
EXPECTED_LEVEL = 0.5
RISK_LEVEL = 0.9
WEEKDAYS = "월화수목금토일"
RELOAD_CHECK_SEC = 3600  # 활성 모델이 바뀌었는지 보는 간격 (매주 자동 학습이 새 모델을 켜면 서버를 다시 켜지 않아도 바뀐다)


def qcol(q: float) -> str:
    """분위수 예측 칸 이름 (예: 0.9 → 'q0.9')"""
    return f"q{q:g}"


def predict_frame(bundle: dict, df: pd.DataFrame) -> pd.DataFrame:
    """df 칸: line_name, station_key, hour, weekday. 돌려주는 칸: level + 분위수마다 qcol(q)
    level 이 'none'(노선 기록도 모자람)인 줄은 예측값이 NaN (확률을 말하지 않는다)"""
    support, min_samples = bundle["support"], bundle["min_samples"]
    level = [level_for(l, s, support, min_samples) for l, s in zip(df["line_name"], df["station_key"])]
    out = pd.DataFrame({"level": level}, index=df.index)
    X = make_features(coarsen(df, support, min_samples), bundle["columns"])
    known = out["level"] != "none"
    for q in bundle["quantiles"]:
        col = np.full(len(df), np.nan)
        if known.any():
            col[known.to_numpy()] = bundle["models"][q].predict(X[known])
        out[qcol(q)] = col
    return out


def value_at(points: list[tuple[float, float]], level: float) -> float | None:
    """정렬된 (분위수, 지연) 점들에서 level 분위수의 지연을 직선으로 읽는다. 학습한 범위 밖이면 None"""
    for (q0, v0), (q1, v1) in zip(points, points[1:]):
        if q0 <= level <= q1:
            return v0 + (v1 - v0) * (level - q0) / (q1 - q0)
    for q, v in points:
        if q == level:
            return v
    return None


class DelayModel:
    def __init__(self, bundle: dict, thresholds: dict):
        self.bundle = bundle
        self.thresholds = thresholds  # app_config probability.grade_thresholds
        self.version = bundle["version"]
        self.fake = bundle["data_source"] == "fake"

    def _predict(self, rows: list[dict]) -> pd.DataFrame:
        return predict_frame(self.bundle, pd.DataFrame(rows))

    def _risk(self, row) -> float | None:
        pts = prob.sorted_quantiles({q: row[qcol(q)] for q in self.bundle["quantiles"]})
        return value_at(pts, RISK_LEVEL)

    def _reason(self, base: dict, level: str, station_name: str, risk: float | None) -> str:
        """요인을 하나씩 '보통 값'으로 바꿔 보고 위험 지연이 가장 많이 달라지는 요인을 고른다"""
        if level == "none" or risk is None:
            return "이 노선은 지연 기록이 모자라 예측하지 않았어요."
        ref = self.bundle["reference"]
        variants = {
            "hour": {**base, "hour": ref["hour"]},
            "weekday": {**base, "weekday": ref["weekday"]},
            "line": {**base, "line_name": "", "station_key": UNKNOWN},
        }
        if level == "station":
            variants["station"] = {**base, "station_key": UNKNOWN}
        names = list(variants)
        pred = self._predict([variants[n] for n in names])
        deltas = {}
        for i, n in enumerate(names):
            other = self._risk(pred.iloc[i])
            deltas[n] = risk - other if other is not None else 0.0
        top = max(deltas, key=lambda n: abs(deltas[n]))
        d = round(deltas[top], 1)
        prefix = "(가짜 데이터) " if self.fake else ""
        if d == 0:
            return prefix + "특별히 더 늦을 요인은 없어요."
        what = {
            "hour": f"{base['hour'] % 24:02d}시대 열차라서",
            "weekday": f"{WEEKDAYS[base['weekday']]}요일 밤이라서",
            "station": f"{station_name or '이 역'} 도착 기록상",
            "line": f"{base['line_name']} 운행 특성상",
        }[top]
        tail = f"평소보다 {d:.1f}분 더 늦을 수 있어요." if d > 0 else "평소보다 덜 늦는 편이에요."
        return f"{prefix}{what} {tail}"

    def leg(self, line_name: str, station_key: str, station_name: str, arrive_min: int, weekday: int, slack_min: float) -> dict:
        """환승 구간 하나: 이번 열차가 환승역에 늦게 도착해 다음 막차를 놓치지 않을 확률"""
        base = {"line_name": line_name, "station_key": station_key, "hour": int(arrive_min) // 60, "weekday": int(weekday)}
        row = self._predict([base]).iloc[0]
        level = row["level"]
        if level == "none":
            p = None
            expected = risk = None
        else:
            predicted = {q: float(row[qcol(q)]) for q in self.bundle["quantiles"]}
            p = prob.leg_success_probability(slack_min, predicted)
            pts = prob.sorted_quantiles(predicted)
            expected, risk = value_at(pts, EXPECTED_LEVEL), value_at(pts, RISK_LEVEL)
        return {
            "probability": None if p is None else round(p, 3),
            "grade": prob.grade(p, self.thresholds),
            "expected_delay_min": None if expected is None else round(expected, 1),
            "risk_delay_min": None if risk is None else round(risk, 1),
            "reason": self._reason(base, level, station_name, risk),
            "level": level,
            "slack_min": slack_min,
        }

    def route(self, legs: list[dict], weekday: int) -> dict:
        """legs: [{line_name, station_key, station_name, arrive_min, walk_min, next_depart_min}] (환승마다 하나)"""
        out = []
        for g in legs:
            slack = prob.transfer_slack(g["arrive_min"], g["walk_min"], g["next_depart_min"])
            out.append(self.leg(g["line_name"], g["station_key"], g.get("station_name", ""), g["arrive_min"], weekday, slack))
        p = prob.route_probability([x["probability"] for x in out])
        return {"probability": None if p is None else round(p, 3), "grade": prob.grade(p, self.thresholds), "legs": out}


# ---------- 서버가 쓰는 활성 모델 ----------
_active: DelayModel | None = None
_status = "아직 불러오지 않았어요."


def active() -> DelayModel | None:
    return _active


def status() -> str:
    """활성 모델 상태 한 줄 (모델이 없을 때 화면·로그에 쓴다)"""
    return _status


def load_active() -> None:
    """DB ml_models 의 활성 모델을 불러온다. 실패하면 모델 없이 (확률 null) 서버는 계속 돈다"""
    global _active, _status
    from ..services import db

    try:
        rows = db.select("ml_models", columns="version,file_path,data_source", filters={"is_active": "eq.true"})
        if not rows:
            _active, _status = None, "활성화한 지연 예측 모델이 없어요."
            return
        row = rows[0]
        path = BASE_DIR / row["file_path"]
        if not Path(path).exists():
            _active, _status = None, f"모델 파일이 없어요: {row['file_path']}"
            return
        bundle = joblib.load(path)
        _active = DelayModel(bundle, db.config_value("probability.grade_thresholds"))
        _status = f"지연 예측 모델 {row['version']} ({row['data_source']})"
    except Exception as e:  # DB 연결 실패, 파일 손상 등: 서버는 살린다
        _active, _status = None, f"지연 예측 모델을 불러오지 못했어요 ({type(e).__name__})"
        log.warning("[delay_model] %s: %s", _status, e)
    finally:
        log.info("[delay_model] %s", _status)


def active_version_changed() -> bool:
    """DB 의 활성 모델 버전이 지금 불러온 것과 다른가. DB 를 못 읽으면 False (지금 모델을 그대로 쓴다)"""
    from ..services import db

    try:
        rows = db.select("ml_models", columns="version", filters={"is_active": "eq.true"})
    except Exception as e:
        log.warning("[delay_model] 활성 모델 확인 실패: %s", type(e).__name__)
        return False
    want = rows[0]["version"] if rows else None
    have = _active.version if _active else None
    return want != have


def _load_and_watch() -> None:
    load_active()
    while True:
        time.sleep(RELOAD_CHECK_SEC)
        if active_version_changed():
            load_active()


def start_loading() -> None:
    """서버 시작을 막지 않도록 뒤에서 불러온다 (DB 가 느려도 서버는 바로 뜬다). 그 뒤로 활성 모델이 바뀌면 다시 불러온다"""
    threading.Thread(target=_load_and_watch, name="delay-model-load", daemon=True).start()

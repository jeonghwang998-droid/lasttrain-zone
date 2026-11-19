"""지연 예측 모델 학습 (분위수 회귀)

1) 학습 데이터 불러오기 (ml/dataset.py: --source fake | db)
2) 날짜 기준 분할: 맨 마지막 ml.test_days 일은 시험용 (무작위 분할은 미래로 과거를 맞히는 누수가 생겨 쓰지 않는다)
3) ml.quantiles 의 분위수마다 GradientBoostingRegressor(loss="quantile") 학습
   - 기록이 ml.min_samples 보다 적은 역은 역 정보를 지워 노선 단위로 학습한다
4) 비교 기준(baseline): (노선, 시간대)별 학습 기간의 지연 분위수 (없으면 노선 → 전체)
5) 시험 기간 예측 (모델 / baseline) → 검증 리포트 ml/reports/ (ml/report.py)
6) 모델 파일 저장(backend/app/ml/models/<버전>.joblib) → DB ml_models 등록 → 활성화
   --activate : 무조건 활성화
   --auto     : 같은 시험 기간에서 baseline 과 지금 활성 모델보다 Brier 점수가 나을 때만 활성화 (매주 자동 학습용)

정책값(분위수, 최소 기록 수, 시험 기간)은 코드에 쓰지 않고 app_config 에서 읽는다.
특징은 backend/app/ml/features.py 하나만 쓴다.

실행 (저장소 맨 위 폴더에서):  python ml/train.py --source fake [--activate]
                               python ml/train.py --source db --auto
"""
from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "ml"))

import dataset  # noqa: E402
import report  # noqa: E402
from app.ml.delay_model import predict_frame, qcol  # noqa: E402
from app.ml.features import coarsen, make_features, support_counts  # noqa: E402
from app.config import BASE_DIR, Config  # noqa: E402
from app.services import db  # noqa: E402

# 모델 설정 (정책값이 아니라 학습 알고리즘의 손잡이. 바꾸면 리포트로 비교해서 정한다)
GBR_PARAMS = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)


@dataclass
class Policy:
    """app_config 에서 읽은 학습 정책"""
    quantiles: list[float]
    min_samples: int
    test_days: int

    @classmethod
    def load(cls) -> "Policy":
        return cls(
            quantiles=sorted(float(q) for q in db.config_value("ml.quantiles")),
            min_samples=int(db.config_value("ml.min_samples")),
            test_days=int(db.config_value("ml.test_days")),
        )


@dataclass
class TrainResult:
    source: str
    policy: Policy
    train: pd.DataFrame
    test: pd.DataFrame
    bundle: dict
    pred: pd.DataFrame  # 시험 기간 줄마다: level, 모델 분위수 예측(qcol), baseline 예측('base_' + qcol)
    seconds: float = 0.0
    notes: list[str] = field(default_factory=list)


def split_by_date(df: pd.DataFrame, test_days: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """운행일 기준: 마지막 test_days 일이 시험, 그 앞이 학습"""
    days = sorted(df["service_date"].dt.normalize().unique())
    if len(days) <= test_days:
        raise SystemExit(f"운행일이 {len(days)}일뿐이라 시험용 {test_days}일을 떼면 학습할 날이 없어요.")
    cut = days[-test_days]
    return df[df["service_date"] < cut], df[df["service_date"] >= cut]


def baseline_predict(train: pd.DataFrame, test: pd.DataFrame, quantiles: list[float]) -> pd.DataFrame:
    """(노선, 도착/출발, 시간대)별 학습 기간 분위수. 그 조합이 학습에 없으면 (노선, 도착/출발), 그것도 없으면 전체"""
    out = pd.DataFrame(index=test.index)
    for q in quantiles:
        by_leh = train.groupby(["line_name", "event", "hour"])["delay_min"].quantile(q)
        by_le = train.groupby(["line_name", "event"])["delay_min"].quantile(q)
        overall = float(train["delay_min"].quantile(q))
        v = pd.Series([by_leh.get(k, np.nan) for k in zip(test["line_name"], test["event"], test["hour"])], index=test.index)
        v2 = pd.Series([by_le.get(k, np.nan) for k in zip(test["line_name"], test["event"])], index=test.index)
        v = v.fillna(v2).fillna(overall)
        out["base_" + qcol(q)] = v.astype(float)
    return out


def fit(train: pd.DataFrame, policy: Policy, source: str, progress=print) -> dict:
    """분위수마다 모델 하나. 돌려주는 bundle 은 app/ml/delay_model.predict_frame 이 그대로 쓴다"""
    support = support_counts(train)
    X = make_features(coarsen(train, support, policy.min_samples))
    y = train["delay_min"].to_numpy()
    models = {}
    for q in policy.quantiles:
        t0 = time.time()
        models[q] = GradientBoostingRegressor(loss="quantile", alpha=q, **GBR_PARAMS).fit(X, y)
        progress(f"  분위수 {q:g} 학습 ({time.time() - t0:.0f}초)")
    return {
        "data_source": source,
        "quantiles": policy.quantiles,
        "columns": list(X.columns),
        "models": models,
        "support": support,
        "min_samples": policy.min_samples,
        "gbr_params": GBR_PARAMS,
        # 이유 문구("23시대 열차라서 …")를 만들 때 비교할 보통 시간대·요일: 학습 데이터에서 가장 흔한 값
        "reference": {"hour": int(train["hour"].mode().iloc[0]), "weekday": int(train["weekday"].mode().iloc[0])},
    }


def run(source: str, progress=print) -> TrainResult:
    t0 = time.time()
    policy = Policy.load()
    df = dataset.load(source)
    if df.empty:
        raise SystemExit("학습할 데이터가 없어요." + (" 실제 도착 기록(train_arrivals)이 아직 없어요." if source == "db" else ""))
    train, test = split_by_date(df, policy.test_days)
    progress(f"[{source}] 학습 {len(train):,}줄 ({train.service_date.min():%m/%d}~{train.service_date.max():%m/%d}) / "
             f"시험 {len(test):,}줄 ({test.service_date.min():%m/%d}~{test.service_date.max():%m/%d})")
    bundle = fit(train, policy, source, progress)
    pred = pd.concat([predict_frame(bundle, test), baseline_predict(train, test, policy.quantiles)], axis=1)
    res = TrainResult(source, policy, train, test, bundle, pred, seconds=time.time() - t0)
    n_none = int((pred["level"] == "none").sum())
    if n_none:
        res.notes.append(f"시험 {n_none:,}줄은 노선 기록도 모자라 '데이터 부족'으로 예측하지 않았어요.")
    return res


def quick_summary(res: TrainResult) -> None:
    """3단계 확인용: 분위수별 적중률 (실제 지연 ≤ 예측인 비율이 분위수에 가까울수록 좋다)"""
    y = res.test["delay_min"]
    ok = res.pred["level"] != "none"
    print("  예측 단위:", res.pred["level"].value_counts().to_dict())
    print("  분위수   목표   모델 적중률   baseline 적중률")
    for q in res.policy.quantiles:
        m = (y[ok] <= res.pred.loc[ok, qcol(q)]).mean()
        b = (y <= res.pred["base_" + qcol(q)]).mean()
        print(f"  {q:>5g}  {q:>5.2f}      {m:>6.3f}         {b:>6.3f}")
    for n in res.notes:
        print("  " + n)


def save_and_register(res: TrainResult, version: str, metrics: dict, activate: bool) -> Path:
    """모델 파일 저장 → DB ml_models 에 등록 → (activate 면) 활성화. 기존 활성 모델은 DB 함수가 한 번에 끈다"""
    bundle = {**res.bundle, "version": version}
    Config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = Config.MODELS_DIR / f"{version}.joblib"
    joblib.dump(bundle, path)
    db.insert("ml_models", {
        "version": version,
        "data_source": res.source,
        "quantiles": res.policy.quantiles,
        "features": bundle["columns"],
        "metrics": metrics,
        "file_path": path.relative_to(BASE_DIR).as_posix(),
    })
    if activate:
        db.rpc("activate_ml_model", {"p_version": version})
    return path


def current_active() -> dict | None:
    """DB 의 지금 활성 모델 {version, data_source, bundle}. 없거나 파일이 없으면 None"""
    rows = db.select("ml_models", columns="version,data_source,file_path", filters={"is_active": "eq.true"})
    if not rows:
        return None
    path = BASE_DIR / rows[0]["file_path"]
    if not path.exists():
        return None
    return {**rows[0], "bundle": joblib.load(path)}


def decide_activation(res: TrainResult, metrics: dict) -> tuple[bool, str]:
    """--auto: baseline 보다 낫고, 지금 활성 모델(실제 데이터)보다도 나을 때만 활성화. (활성화 여부, 이유)"""
    m, b = metrics["brier_model"], metrics["brier_baseline"]
    if m >= b:
        return False, f"baseline 보다 낫지 않아 활성화하지 않았어요 (Brier 모델 {m:.4f} / baseline {b:.4f})"
    cur = current_active()
    if cur is None:
        return True, f"baseline 보다 나아 활성화했어요 (Brier {m:.4f} < {b:.4f}). 지금 활성 모델은 없어요."
    if cur["data_source"] == "fake":
        return True, f"baseline 보다 나아 활성화했어요 (Brier {m:.4f} < {b:.4f}). 가짜 데이터 모델 {cur['version']} 을 바꿔요."
    cmp = report.compare_brier(res, predict_frame(cur["bundle"], res.test), cur["bundle"]["quantiles"])
    metrics["compare_active"] = {"version": cur["version"], **(cmp or {})}
    if cmp is None:
        return True, f"baseline 보다 나아 활성화했어요. 지금 모델 {cur['version']} 과 겹치는 시험 줄이 없어 baseline 으로만 비교했어요."
    if cmp["brier_new"] <= cmp["brier_active"]:
        return True, f"지금 모델 {cur['version']} 보다 나아 활성화했어요 (같은 시험 {cmp['rows']:,}줄 Brier {cmp['brier_new']:.4f} ≤ {cmp['brier_active']:.4f})"
    return False, f"지금 모델 {cur['version']} 이 더 나아 그대로 둬요 (같은 시험 {cmp['rows']:,}줄 Brier {cmp['brier_new']:.4f} > {cmp['brier_active']:.4f})"


def main() -> None:
    ap = argparse.ArgumentParser(description="지연 예측 분위수 모델 학습")
    ap.add_argument("--source", choices=dataset.SOURCES, required=True)
    how = ap.add_mutually_exclusive_group()
    how.add_argument("--activate", action="store_true", help="등록한 모델을 서버가 쓰는 활성 모델로 바꾼다 (기존 활성 모델은 꺼진다)")
    how.add_argument("--auto", action="store_true", help="baseline 과 지금 활성 모델보다 나을 때만 활성화 (매주 자동 학습용)")
    args = ap.parse_args()
    if args.source == "fake":
        print("※ 가짜 데이터로 학습해요. 결과 숫자는 흐름 확인용이고 실제 의미가 없어요.")
    res = run(args.source)
    print(f"학습 끝 ({res.seconds:.0f}초)")
    quick_summary(res)

    version = time.strftime("%Y%m%d-%H%M%S")
    metrics = report.evaluate(res)
    path = report.write(metrics, version, res.policy)
    print(f"리포트: {path}")
    print(f"  Brier 모델 {metrics['brier_model']:.4f} / baseline {metrics['brier_baseline']:.4f}")

    activate = args.activate
    if args.auto:
        activate, why = decide_activation(res, metrics)
        metrics["auto_decision"] = why
        print("자동 판단: " + why)
    path = save_and_register(res, version, metrics, activate)
    print(f"모델 저장·등록: {version} → {path}")
    print("  활성화했어요. 서버가 한 시간 안에 이 모델로 바꿔요 (바로 쓰려면 서버를 다시 켜세요)." if activate
          else "  활성화하지 않았어요. 쓰려면 --activate 를 붙여 다시 학습하거나 DB 함수 activate_ml_model 을 부르세요.")


if __name__ == "__main__":
    main()

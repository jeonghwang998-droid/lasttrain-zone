"""검증 리포트: 시험 기간(학습에 안 쓴 마지막 날들)으로 모델과 baseline 을 비교한다

1) 분위수별 적중률: 실제 지연 ≤ 예측인 비율. 목표 분위수에 가까울수록 좋다
2) 분위수별 핀볼 손실: 분위수 예측의 오차 (작을수록 좋다). 모델 vs baseline
3) 확률 보정도: 확률 구간마다 '예측 확률 평균'과 '실제 성공률'을 비교한 표와 그래프
4) Brier 점수: (확률 − 실제 성공 여부)² 평균 (작을수록 좋다). 모델 vs baseline

확률 평가용 사건: 실제 환승 기록이 없어서, 시험 기간 열차마다 여러 '환승 여유' 값을 대 보고
  예측 P(지연 ≤ 여유) 와 실제 (지연 ≤ 여유) 를 맞춘다.
  여유 값은 학습 기간 지연 분포에서 뽑는다: app_config ml.quantiles 의 분위수와 그 대칭(1−q) 지점.

결과: ml/reports/<버전>.md 와 <버전>_calibration.png. 가짜 데이터면 맨 위에 크게 표시한다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_pinball_loss

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.probability import leg_success_probability  # noqa: E402
from app.ml.delay_model import qcol  # noqa: E402

REPORTS = ROOT / "ml" / "reports"
CALIBRATION_BINS = 10  # 보정도 표의 확률 구간 수 (0~1 을 똑같이 나눈다. 보기 설정이지 정책값이 아니다)


def _slack_grid(train: pd.DataFrame, quantiles: list[float]) -> list[float]:
    levels = sorted({round(q, 6) for q in quantiles} | {round(1 - q, 6) for q in quantiles})
    return sorted({round(float(train["delay_min"].quantile(lv)), 1) for lv in levels})


def _probs(pred: pd.DataFrame, cols: dict[float, str], slack: float) -> np.ndarray:
    return np.array([
        leg_success_probability(slack, {q: row[c] for q, c in cols.items()})
        for _, row in pred[list(cols.values())].iterrows()
    ], dtype=float)


def evaluate(res) -> dict:
    """TrainResult → 지표 dict (ml_models.metrics 에 그대로 저장된다)"""
    qs = res.policy.quantiles
    ok = res.pred["level"] != "none"
    y = res.test.loc[ok, "delay_min"].to_numpy()
    pm = res.pred.loc[ok]

    per_q = []
    for q in qs:
        m, b = pm[qcol(q)].to_numpy(), pm["base_" + qcol(q)].to_numpy()
        per_q.append({
            "quantile": q,
            "hit_model": float((y <= m).mean()),
            "hit_baseline": float((y <= b).mean()),
            "pinball_model": float(mean_pinball_loss(y, m, alpha=q)),
            "pinball_baseline": float(mean_pinball_loss(y, b, alpha=q)),
        })

    # 확률 평가: (열차, 여유) 쌍마다 예측 확률과 실제 성공
    grid = _slack_grid(res.train, qs)
    model_cols = {q: qcol(q) for q in qs}
    base_cols = {q: "base_" + qcol(q) for q in qs}
    p_model, p_base, hit = [], [], []
    for s in grid:
        p_model.append(_probs(pm, model_cols, s))
        p_base.append(_probs(pm, base_cols, s))
        hit.append((y <= s).astype(float))
    p_model, p_base, hit = np.concatenate(p_model), np.concatenate(p_base), np.concatenate(hit)

    edges = np.linspace(0, 1, CALIBRATION_BINS + 1)

    def calib(p):
        idx = np.clip(np.digitize(p, edges[1:-1]), 0, CALIBRATION_BINS - 1)
        rows = []
        for i in range(CALIBRATION_BINS):
            sel = idx == i
            if sel.any():
                rows.append({"bin": f"{edges[i]:.1f}~{edges[i + 1]:.1f}", "n": int(sel.sum()),
                             "pred_mean": float(p[sel].mean()), "actual_rate": float(hit[sel].mean())})
        return rows

    return {
        "data_source": res.source,
        "train_rows": int(len(res.train)),
        "test_rows": int(len(res.test)),
        "test_rows_predicted": int(ok.sum()),
        "train_period": [f"{res.train.service_date.min():%Y-%m-%d}", f"{res.train.service_date.max():%Y-%m-%d}"],
        "test_period": [f"{res.test.service_date.min():%Y-%m-%d}", f"{res.test.service_date.max():%Y-%m-%d}"],
        "levels": {k: int(v) for k, v in res.pred["level"].value_counts().items()},
        "slack_grid_min": grid,
        "quantiles": per_q,
        "brier_model": float(np.mean((p_model - hit) ** 2)),
        "brier_baseline": float(np.mean((p_base - hit) ** 2)),
        "calibration_model": calib(p_model),
        "calibration_baseline": calib(p_base),
        "probability_events": int(len(hit)),
    }


def _plot(metrics: dict, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    for name in ("Malgun Gothic", "AppleGothic", "NanumGothic"):  # 한글 글꼴이 있으면 쓴다
        if any(f.name == name for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(5.5, 5.5), dpi=120)
    ax.plot([0, 1], [0, 1], ls="--", c="#9aa5b4", label="완벽한 보정")
    for key, label, color in (("calibration_model", "모델", "#0052a4"), ("calibration_baseline", "baseline", "#b86e00")):
        rows = metrics[key]
        ax.plot([r["pred_mean"] for r in rows], [r["actual_rate"] for r in rows], marker="o", c=color, label=label)
    title = "막차 확률 보정도"
    if metrics["data_source"] == "fake":
        title += " (가짜 데이터)"
    ax.set(xlim=(0, 1), ylim=(0, 1), xlabel="예측 확률 (구간 평균)", ylabel="실제 성공률", title=title)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def write(metrics: dict, version: str, policy) -> Path:
    REPORTS.mkdir(parents=True, exist_ok=True)
    md_path = REPORTS / f"{version}.md"
    png_path = REPORTS / f"{version}_calibration.png"
    _plot(metrics, png_path)

    L = []
    if metrics["data_source"] == "fake":
        L += [
            "# [주의] 가짜 데이터로 학습한 모델입니다",
            "",
            "> **이 리포트의 숫자는 실제 지하철 지연이 아니라 `ml/make_fake_data.py` 가 꾸민 데이터에서 나왔습니다.**",
            "> 학습·리포트·서빙 흐름을 확인하는 용도이며, 확률(예: 94%)은 실제 의미가 없습니다. 발표나 화면에 쓰지 마세요.",
            "",
        ]
    L += [
        f"# 지연 예측 검증 리포트 `{version}`",
        "",
        f"- 데이터: **{metrics['data_source']}** · 학습 {metrics['train_rows']:,}줄 ({metrics['train_period'][0]} ~ {metrics['train_period'][1]})"
        f" · 시험 {metrics['test_rows']:,}줄 ({metrics['test_period'][0]} ~ {metrics['test_period'][1]})",
        f"- 정책값(app_config): 분위수 {policy.quantiles}, 최소 기록 {policy.min_samples}, 시험 {policy.test_days}일",
        f"- 예측 단위(시험 기간): {metrics['levels']} · 예측한 줄 {metrics['test_rows_predicted']:,}",
        "",
        "## 1. 분위수별 적중률 (실제 지연 ≤ 예측)",
        "",
        "목표 분위수에 가까울수록 좋습니다.",
        "",
        "| 분위수 | 모델 | baseline |",
        "|---|---|---|",
    ]
    for r in metrics["quantiles"]:
        L.append(f"| {r['quantile']:g} | {r['hit_model']:.3f} | {r['hit_baseline']:.3f} |")
    L += [
        "",
        "## 2. 분위수별 핀볼 손실 (작을수록 좋음)",
        "",
        "| 분위수 | 모델 | baseline | 모델이 나음 |",
        "|---|---|---|---|",
    ]
    for r in metrics["quantiles"]:
        better = "예" if r["pinball_model"] < r["pinball_baseline"] else "아니오"
        L.append(f"| {r['quantile']:g} | {r['pinball_model']:.4f} | {r['pinball_baseline']:.4f} | {better} |")
    L += [
        "",
        "## 3. 확률 보정도",
        "",
        f"시험 기간 열차마다 환승 여유 {metrics['slack_grid_min']}분을 대 보고 "
        f"예측 P(지연 ≤ 여유)와 실제 성공을 비교했습니다 (사건 {metrics['probability_events']:,}개). "
        "예측 평균과 실제 성공률이 가까울수록 확률을 믿을 수 있습니다.",
        "",
        f"![보정도]({png_path.name})",
        "",
        "| 확률 구간 | 모델: 사건 수 | 모델: 예측 평균 | 모델: 실제 성공률 | baseline: 예측 평균 | baseline: 실제 성공률 |",
        "|---|---|---|---|---|---|",
    ]
    base = {r["bin"]: r for r in metrics["calibration_baseline"]}
    for r in metrics["calibration_model"]:
        b = base.get(r["bin"])
        bt = f"{b['pred_mean']:.3f} | {b['actual_rate']:.3f}" if b else "- | -"
        L.append(f"| {r['bin']} | {r['n']:,} | {r['pred_mean']:.3f} | {r['actual_rate']:.3f} | {bt} |")
    L += [
        "",
        "## 4. Brier 점수 (작을수록 좋음)",
        "",
        "| 모델 | baseline |",
        "|---|---|",
        f"| {metrics['brier_model']:.4f} | {metrics['brier_baseline']:.4f} |",
        "",
        "## 읽을 때 주의",
        "",
        "- 경로 확률은 구간 확률의 곱입니다(구간 독립 가정). 비 오는 밤처럼 여러 구간이 함께 늦으면 실제보다 높게 나올 수 있습니다.",
        "- 가장 높은 분위수보다 높은 확률은 말하지 않습니다(그 위 꼬리는 모름).",
        "- 강수량과 공휴일은 아직 특징에 없습니다.",
    ]
    md_path.write_text("\n".join(L) + "\n", encoding="utf-8")
    return md_path

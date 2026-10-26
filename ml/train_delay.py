"""2단계: 지연 예측 모델 학습

- 목표값: 열차 지연(분)
- 모델  : Gradient Boosting 분위수 회귀
          q50(보통 이 정도 늦음) + q90(10번 중 9번은 이것보다 덜 늦음)
- 서비스에서는 q90을 쓴다. 막차는 평균적으로 맞추는 게 아니라 '놓치지 않는 것'이 목표라서.

실행: python train_delay.py  (data/delays.csv -> models/delay_model.joblib)
"""
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_pinball_loss

TEST_DAYS = 14  # 마지막 2주는 시험용으로 떼어둠


# ※ backend/app/ml/features.py 의 make_features 와 반드시 같게 유지할 것
def make_features(df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    X = pd.DataFrame({
        "hour": df["hour"].where(df["hour"] >= 4, df["hour"] + 24),  # 0시 -> 24, 1시 -> 25
        "weekday": df["weekday"],
        "next_day_off": df["weekday"].isin([4, 5]).astype(int),       # 금/토 밤
        "rain_mm": df["rain_mm"],
    })
    X = pd.concat([X, pd.get_dummies(df["line"], prefix="line", dtype=int)], axis=1)
    if columns is not None:  # 예측 시 학습 때와 같은 컬럼 순서/구성 보장
        X = X.reindex(columns=columns, fill_value=0)
    return X


def main() -> None:
    df = pd.read_csv("data/delays.csv", parse_dates=["date"]).sort_values("date")

    # 무작위로 나누면 미래 데이터로 과거를 맞히는 '누수'가 생김 -> 날짜 기준으로 분할
    cut = df["date"].max() - pd.Timedelta(days=TEST_DAYS)
    train, test = df[df["date"] <= cut], df[df["date"] > cut]
    X_tr, y_tr = make_features(train), train["delay_min"]
    X_te, y_te = make_features(test, list(X_tr.columns)), test["delay_min"]

    # 비교 기준(baseline): 노선 x 시간대별 과거 90분위수를 그대로 쓰는 단순 통계
    base_q90 = train.groupby(["line", "hour"])["delay_min"].quantile(0.9)
    base_pred = test.set_index(["line", "hour"]).index.map(base_q90).to_numpy(dtype=float)
    base_pred = np.nan_to_num(base_pred, nan=float(y_tr.quantile(0.9)))

    params = dict(n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)
    q50 = GradientBoostingRegressor(loss="quantile", alpha=0.5, **params).fit(X_tr, y_tr)
    q90 = GradientBoostingRegressor(loss="quantile", alpha=0.9, **params).fit(X_tr, y_tr)
    p50, p90 = q50.predict(X_te), q90.predict(X_te)

    print(f"학습 {len(train)}건 / 시험 {len(test)}건\n")
    print("[q50] 평균 절대 오차(MAE)")
    print(f"  모델   {mean_absolute_error(y_te, p50):.2f}분")
    print(f"  전체평균 {mean_absolute_error(y_te, np.full(len(y_te), y_tr.median())):.2f}분\n")
    print("[q90] 실제 지연이 예측 이하인 비율(목표 90%) / 핀볼 손실(낮을수록 좋음)")
    print(f"  모델     {np.mean(y_te <= p90):.1%} / {mean_pinball_loss(y_te, p90, alpha=0.9):.3f}")
    print(f"  baseline {np.mean(y_te <= base_pred):.1%} / {mean_pinball_loss(y_te, base_pred, alpha=0.9):.3f}\n")

    imp = pd.Series(q90.feature_importances_, index=X_tr.columns).sort_values(ascending=False)
    print("[q90] 중요한 특징 순위")
    for name, v in imp.head(5).items():
        print(f"  {name:<14}{v:.2f}")

    joblib.dump({"q50": q50, "q90": q90, "columns": list(X_tr.columns)}, "models/delay_model.joblib")
    print("\n저장 -> models/delay_model.joblib")


if __name__ == "__main__":
    main()

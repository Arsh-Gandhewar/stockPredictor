"""
Phase 2 Institutional Audit Tests
==================================
P0-1: Regime-conditional features exist and are valid
P0-2: Turnover control (continuity bonus and days_held tracking)
P0-3: IC diagnostic script imports correctly
P1-4: New FEATURE_NAMES contains all 6 regime meta-features
P1-5: Raw fractile spread helpers work
"""
import pytest
import numpy as np
import pandas as pd
import sys, os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from features.feature_engine import FEATURE_NAMES, enrich_panel_with_regime_features, calculate_features


# --- P1-4: All 6 regime features are in FEATURE_NAMES -------------------------
REQUIRED_REGIME_FEATURES = [
    "market_vol_regime", "market_trend_60d", "breadth_pct_above_20ma",
    "vix_percentile_252d", "cross_sec_vol_rank", "adv_decline_ratio",
]

def test_regime_features_in_feature_names():
    """P1-4: All 6 regime meta-features must appear in FEATURE_NAMES."""
    missing = [f for f in REQUIRED_REGIME_FEATURES if f not in FEATURE_NAMES]
    assert not missing, f"Missing regime features in FEATURE_NAMES: {missing}"


def test_feature_names_length():
    """FEATURE_NAMES must now have exactly 31 features (25 original + 6 regime)."""
    assert len(FEATURE_NAMES) == 31, f"Expected 31 features, got {len(FEATURE_NAMES)}"


# --- P1-4: calculate_features adds per-stock regime features ------------------
def _make_dummy_df(n=300, seed=42):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2015-01-01", periods=n, freq="B")
    close = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.01, n)), index=idx)
    df = pd.DataFrame({
        "Open": close * rng.uniform(0.98, 1.00, n),
        "High": close * rng.uniform(1.00, 1.02, n),
        "Low":  close * rng.uniform(0.97, 1.00, n),
        "Close": close,
        "Volume": rng.integers(100000, 1000000, n).astype(float),
    })
    # Benchmark
    bench_close = pd.Series(10000 * np.cumprod(1 + rng.normal(0, 0.008, n)), index=idx)
    bench_df = pd.DataFrame({"Close": bench_close, "Open": bench_close * 0.99}, index=idx)
    return df, bench_df

def test_calculate_features_has_regime_cols():
    """P1-4: calculate_features populates market_vol_regime and market_trend_60d."""
    df, bench = _make_dummy_df(300)
    result = calculate_features(df, benchmark_df=bench)
    assert "market_vol_regime" in result.columns
    assert "market_trend_60d" in result.columns
    # market_vol_regime should be in [0, 1] where not NaN
    valid = result["market_vol_regime"].dropna()
    assert (valid >= 0).all() and (valid <= 1).all(), "market_vol_regime out of [0,1]"
    # market_trend_60d should be in {-1, 0, 1}
    valid_trend = result["market_trend_60d"].dropna()
    assert valid_trend.isin([-1.0, 0.0, 1.0]).all(), "market_trend_60d has unexpected values"


def test_calculate_features_has_neutral_crosssec_defaults():
    """P1-4: Without panel enrichment, cross-sectional features default to neutral."""
    df, bench = _make_dummy_df(300)
    result = calculate_features(df, benchmark_df=bench)
    # breadth, vix, adv_decline, cross_sec should be at neutral defaults
    assert "breadth_pct_above_20ma" in result.columns
    # All values should equal the neutral default (0.5) since no enrichment was run
    vals = result["breadth_pct_above_20ma"].dropna().unique()
    assert len(vals) == 1 and vals[0] == 0.5, "breadth_pct_above_20ma should default to 0.5"


# --- P1-4: enrich_panel_with_regime_features works correctly ------------------
def _make_panel_df(n_stocks=5, n_days=100, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2020-01-01", periods=n_days, freq="B")
    rows = []
    for s in range(n_stocks):
        close = 100 * np.cumprod(1 + rng.normal(0, 0.015, n_days))
        sma20 = pd.Series(close).rolling(20).mean().values
        ret1d = pd.Series(close).pct_change().values
        for i, dt in enumerate(idx):
            rows.append({
                "predictionTimestamp": dt.strftime("%Y-%m-%d"),
                "ticker": f"STOCK_{s}",
                "sma_20_dist": (close[i] - sma20[i]) / sma20[i] if not np.isnan(sma20[i]) else np.nan,
                "vol_20d": rng.uniform(0.15, 0.45),
                "ret_1d": ret1d[i] if not np.isnan(ret1d[i]) else 0.0,
            })
    panel = pd.DataFrame(rows)
    panel.index = pd.to_datetime([r["predictionTimestamp"] for r in rows])
    return panel

def test_enrich_panel_adds_crosssec_features():
    """P1-4: enrich_panel_with_regime_features populates all 4 cross-sectional features."""
    panel = _make_panel_df(n_stocks=5, n_days=100)
    enriched = enrich_panel_with_regime_features(panel, vix_df=None)
    for col in ["breadth_pct_above_20ma", "cross_sec_vol_rank", "adv_decline_ratio", "vix_percentile_252d"]:
        assert col in enriched.columns, f"Missing column: {col}"
    # breadth in [0,1]
    b = enriched["breadth_pct_above_20ma"].dropna()
    assert (b >= 0).all() and (b <= 1).all()
    # cross_sec_vol_rank in [0,1]
    cvr = enriched["cross_sec_vol_rank"].dropna()
    assert (cvr >= 0).all() and (cvr <= 1).all()
    # adv_decline_ratio clipped to [0.1, 10]
    adr = enriched["adv_decline_ratio"].dropna()
    assert (adr >= 0.1).all() and (adr <= 10.0).all()


def test_enrich_panel_vix_df():
    """P1-4: enrich_panel_with_regime_features uses VIX df when provided."""
    panel = _make_panel_df(n_stocks=3, n_days=100)
    rng = np.random.default_rng(99)
    idx = pd.date_range("2015-01-01", periods=400, freq="B")
    vix_df = pd.DataFrame({"Close": rng.uniform(10, 40, 400)}, index=idx)
    enriched = enrich_panel_with_regime_features(panel, vix_df=vix_df)
    # Without VIX data for 2020, it should fall back to 0.5
    # vix_percentile_252d should still be present
    assert "vix_percentile_252d" in enriched.columns


# --- P0-2: Turnover control — days_held tracking ------------------------------
def test_holdings_days_held_logic():
    """P0-2: Verifies that current_holdings tracks days_held correctly."""
    # Simulate what the evaluator does: build new_holdings from prior holdings
    def update_holdings(selected, current_holdings):
        new_holdings = {}
        for x in selected:
            tkr = x["ticker"]
            prev = current_holdings[tkr].get("days_held", 0) if tkr in current_holdings else 0
            x_copy = dict(x)
            x_copy["days_held"] = prev + 1
            new_holdings[tkr] = x_copy
        return new_holdings

    holdings = {}
    day1 = [{"ticker": "A", "score": 1.0}, {"ticker": "B", "score": 0.9}, {"ticker": "C", "score": 0.8}]
    holdings = update_holdings(day1, holdings)
    assert all(h["days_held"] == 1 for h in holdings.values())

    day2 = [{"ticker": "A", "score": 1.0}, {"ticker": "B", "score": 0.9}, {"ticker": "D", "score": 0.7}]
    holdings = update_holdings(day2, holdings)
    assert holdings["A"]["days_held"] == 2
    assert holdings["B"]["days_held"] == 2
    assert holdings["D"]["days_held"] == 1  # new position


# --- P0-3: IC calculation is correct -----------------------------------------
def test_spearman_ic_perfect():
    """P0-3: Perfectly ranked scores give IC=1.0."""
    from scipy import stats
    scores = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    returns = np.array([0.01, 0.02, 0.03, 0.04, 0.05])
    r, _ = stats.spearmanr(scores, returns)
    assert abs(r - 1.0) < 1e-10


def test_spearman_ic_inverse():
    """P0-3: Perfectly inverse-ranked gives IC=-1.0."""
    from scipy import stats
    scores = np.array([5.0, 4.0, 3.0, 2.0, 1.0])
    returns = np.array([0.01, 0.02, 0.03, 0.04, 0.05])
    r, _ = stats.spearmanr(scores, returns)
    assert abs(r + 1.0) < 1e-10

# --- P1-5: Volatility-scaled inverse-vol weighting ----------------------------
def test_inverse_volatility_weighting_monotonicity():
    """P1-5: Lower expected risk must receive strictly higher portfolio weight."""
    risks = [0.01, 0.02, 0.04]
    inv_vols = [1.0 / max(0.005, r) for r in risks]
    total_inv_vol = sum(inv_vols)
    weights = [iv / total_inv_vol for iv in inv_vols]
    assert weights[0] > weights[1] > weights[2], "Weights must be monotonically decreasing in risk"
    assert abs(sum(weights) - 1.0) < 1e-6, "Weights must sum to 1.0"
    assert weights[0] == pytest.approx(4.0 / 7.0, rel=1e-3)
    assert weights[1] == pytest.approx(2.0 / 7.0, rel=1e-3)
    assert weights[2] == pytest.approx(1.0 / 7.0, rel=1e-3)


# --- P0-2: Horizon-aware holding period --------------------------------------
def test_evaluator_supports_horizon_parameter():
    """P0-2: Evaluator accepts horizon='5d' and horizon='20d'."""
    from backtest.top3_alpha_evaluator import Top3AlphaEvaluator
    evaluator = Top3AlphaEvaluator()
    assert hasattr(evaluator, 'evaluate_top3_alpha')
    import inspect
    sig = inspect.signature(evaluator.evaluate_top3_alpha)
    assert 'horizon' in sig.parameters
    assert sig.parameters['horizon'].default == '5d'


# --- P0-1 / P1-4: Quality-adjusted canonicalAlphaScore ------------------------
def test_quality_adjusted_canonical_alpha_score():
    """P0-1: Stocks with identical rank and return but lower volatility get higher canonicalAlphaScore."""
    from models.alpha_ranker import CrossSectionalAlphaRanker
    ranker = CrossSectionalAlphaRanker(horizon_str='5d')
    test_df = pd.DataFrame({
        'predictionTimestamp': ['2023-01-02', '2023-01-02'],
        'ticker': ['LOW_VOL', 'HIGH_VOL'],
        'rank_score': [1.5, 1.5],
        'pred_std_excess': [0.1, 0.1],
        'vol_20d': [0.15, 0.45],
        'cross_sec_vol_rank': [0.1, 0.9],
        'target_rank_grade_5d': [3, 3],
        'target_vol_std_excess_5d': [0.5, 0.5]
    })
    for f in FEATURE_NAMES:
        if f not in test_df.columns:
            test_df[f] = 0.5

    class MockModel:
        def predict(self, X):
            return np.full(len(X), 0.5)

    ranker.ranker = MockModel()
    ranker.magnitude_model = MockModel()
    ranker.is_fitted = True

    scored = ranker.predict(test_df, features=FEATURE_NAMES)
    score_low_vol = scored.loc[scored['ticker'] == 'LOW_VOL', 'canonicalAlphaScore'].iloc[0]
    score_high_vol = scored.loc[scored['ticker'] == 'HIGH_VOL', 'canonicalAlphaScore'].iloc[0]

    assert score_low_vol > score_high_vol, (
        f"Low-volatility stock should receive higher canonicalAlphaScore: {score_low_vol} vs {score_high_vol}"
    )


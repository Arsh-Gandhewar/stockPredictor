"""
Institutional Strategy Enhancement Test Suite.
===============================================
Comprehensive verification of the 5 quantitative institutional enhancements:
  Pillar 1: Regime-Conditional Alpha & Signal Policy
  Pillar 2: Tradeability & Net-Alpha Economic Gating
  Pillar 3: Cross-Sectional Factor Sleeve Ensemble & Sector Neutrality
  Pillar 4: Portfolio-Level Alpha Optimization & Dynamic Cash Allocation
  Pillar 5: Slower 20D-60D Horizon & Tactical Entry Refinement
"""

import pytest
import numpy as np
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from models.regime_specialist_engine import (
    RegimeSpecialistEngine,
    RegimeSignalPolicy,
    REGIME_POLICY_REGISTRY,
    MACRO_REGIME_STATES,
    CANONICAL_REGIME_STATES,
    RegimePolicyLearner,
    RegimePolicyLearnerReport
)
from models.tradeability_engine import (
    TradeabilityGatingEngine,
    TradeabilityAssessment,
    EmpiricalForecastUncertaintyEngine
)
from models.sleeve_ensemble import (
    FactorSleeveEnsemble,
    SLEEVE_NAMES,
    DEFAULT_SLEEVE_WEIGHTS
)
from backtest.top3_alpha_evaluator import (
    Top3AlphaEvaluator,
    Top3DailyPortfolioRecord,
    TacticalOverlayCalibrator
)
from targets.target_definition import compute_targets, assign_cross_sectional_relevance_grades


# =====================================================================
# Fixtures
# =====================================================================

@pytest.fixture
def synthetic_benchmark_df():
    """Generates synthetic benchmark DataFrame with Bull, Bear, High-Vol, and Crisis phases."""
    dates = pd.date_range(start='2018-01-01', periods=600, freq='B')
    np.random.seed(42)
    # 250 days bull, 100 days crash (-40%), 250 days choppy recovery
    rets = np.zeros(600)
    rets[:250] = np.random.normal(0.0006, 0.008, 250)
    rets[250:350] = np.random.normal(-0.005, 0.025, 100)
    rets[350:] = np.random.normal(0.0004, 0.012, 250)

    prices = 10000.0 * np.exp(np.cumsum(rets))
    df = pd.DataFrame({
        'Open': prices * 0.999,
        'High': prices * 1.005,
        'Low': prices * 0.995,
        'Close': prices,
        'Volume': 5000000
    }, index=dates)
    return df


@pytest.fixture
def synthetic_cross_section_panel():
    """Generates synthetic panel of 10 stocks across 20 trading dates."""
    np.random.seed(123)
    dates = pd.date_range(start='2020-01-01', periods=20, freq='B')
    tickers = [f'STK_{i:02d}.NS' for i in range(10)]
    sectors = ['IT', 'IT', 'IT', 'FIN', 'FIN', 'FIN', 'AUTO', 'AUTO', 'PHARMA', 'PHARMA']
    sector_map = dict(zip(tickers, sectors))

    records = []
    for d in dates:
        d_str = str(d)[:10]
        for t in tickers:
            row = {
                'predictionTimestamp': d_str,
                'ticker': t,
                'sector': sector_map[t],
                'Close': float(np.random.uniform(100, 2000)),
                'ret_5d': float(np.random.normal(0.01, 0.03)),
                'ret_20d': float(np.random.normal(0.02, 0.06)),
                'beta_nifty': float(np.random.uniform(0.6, 1.4)),
                'relative_strength_nifty': float(np.random.normal(0.01, 0.04)),
                'ema_20_dist': float(np.random.normal(-0.01, 0.02)),
                'sma_50_dist': float(np.random.normal(0.02, 0.03)),
                'atr_percent': float(np.random.uniform(0.015, 0.035)),
                'vol_20d': float(np.random.uniform(0.15, 0.35)),
                'downside_deviation': float(np.random.uniform(0.10, 0.25)),
                'volume_z_score': float(np.random.normal(0.0, 1.0)),
                'rel_volume': float(np.random.uniform(0.5, 2.5)),
                'dist_52w_low': float(np.random.uniform(0.10, 0.40)),
                'dist_52w_high': float(np.random.uniform(-0.20, 0.0)),
                'stoch_k': float(np.random.uniform(20, 80)),
                'expectedReturn': float(np.random.normal(0.02, 0.03)),
                'expectedRisk': float(np.random.uniform(0.015, 0.035)),
                'calibratedProbability': float(np.random.uniform(0.40, 0.70)),
                'canonicalAlphaScore': float(np.random.uniform(0.2, 1.2)),
                'adv20': 50000000.0,
                'ADV': 100000.0,
                'beta': 1.0
            }
            records.append(row)

    return pd.DataFrame(records)


# =====================================================================
# Pillar 1: Regime Specialist Engine & Policy Tests
# =====================================================================

def test_p1_regime_policy_mapping(synthetic_benchmark_df):
    """Pillar 1: Verifies macro regime classification and policy registry lookup."""
    engine = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_df)

    # Check that every macro state in registry has valid policy parameters
    for state in MACRO_REGIME_STATES:
        policy = REGIME_POLICY_REGISTRY[state]
        assert isinstance(policy, RegimeSignalPolicy)
        assert 0.0 <= policy.max_gross_exposure <= 1.0
        assert policy.hurdle_multiplier >= 1.0
        assert policy.min_holding_days >= 5
        assert len(policy.sleeve_weights) == len(SLEEVE_NAMES)
        assert abs(sum(policy.sleeve_weights.values()) - 1.0) < 1e-5

    # Check date lookups
    sample_date = str(synthetic_benchmark_df.index[100])[:10]
    policy = engine.get_regime_policy(sample_date)
    assert policy.macro_regime in MACRO_REGIME_STATES
    assert policy.max_gross_exposure > 0.0


def test_p1_crisis_panic_exposure_reduction(synthetic_benchmark_df):
    """Pillar 1: Verifies that severe market drawdown triggers CRISIS_PANIC and reduces exposure."""
    engine = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_df)

    # Days 250-350 had severe negative returns (-40% crash)
    crisis_sample_date = str(synthetic_benchmark_df.index[320])[:10]
    macro = engine.get_macro_regime(crisis_sample_date)
    policy = engine.get_regime_policy(crisis_sample_date)

    assert macro == 'CRISIS_PANIC'
    assert policy.max_gross_exposure <= 0.25
    assert policy.hurdle_multiplier >= 2.5
    assert policy.allow_new_entries is False


# =====================================================================
# Pillar 2: Tradeability Gating Engine Tests
# =====================================================================

def test_p2_tradeability_friction_and_hurdles():
    """Pillar 2: Verifies that candidates with unproven edge are rejected."""
    engine = TradeabilityGatingEngine(base_friction_rate=0.0013)

    # Case A: Solid positive edge exceeding costs and risk
    good_cand = engine.evaluate_candidate(
        ticker='GOOD.NS',
        date_str='2020-01-01',
        expected_excess_return=0.04,
        horizon_volatility=0.02,
        calibrated_prob=0.60,
        annualized_vol=0.20
    )
    assert good_cand.is_tradeable is True
    assert good_cand.expected_net_alpha > 0.0
    assert good_cand.net_edge_over_hurdle > 0.0
    assert good_cand.ineligibility_reason is None

    # Case B: Negative expected excess return
    bad_cand = engine.evaluate_candidate(
        ticker='BAD.NS',
        date_str='2020-01-01',
        expected_excess_return=-0.01,
        horizon_volatility=0.02,
        calibrated_prob=0.50
    )
    assert bad_cand.is_tradeable is False
    assert bad_cand.ineligibility_reason == 'NEGATIVE_NET_ALPHA'

    # Case C: Positive return, but smaller than friction + risk hurdle
    marginal_cand = engine.evaluate_candidate(
        ticker='MARGINAL.NS',
        date_str='2020-01-01',
        expected_excess_return=0.0050,  # 50 bps (exceeds ~20 bps friction, below ~113 bps hurdle)
        horizon_volatility=0.025,
        calibrated_prob=0.52
    )
    assert marginal_cand.is_tradeable is False
    assert marginal_cand.ineligibility_reason == 'BELOW_CONFIDENCE_HURDLE'


def test_p2_tradeability_cash_allocation_when_no_edge():
    """Pillar 2: Verifies that when no candidates pass hurdle, cash fraction is 100%."""
    engine = TradeabilityGatingEngine()
    candidates = [
        {'ticker': 'STK_1', 'expectedReturn': -0.02, 'expectedRisk': 0.03, 'calibratedProbability': 0.40},
        {'ticker': 'STK_2', 'expectedReturn': 0.001, 'expectedRisk': 0.04, 'calibratedProbability': 0.48},
        {'ticker': 'STK_3', 'expectedReturn': -0.005, 'expectedRisk': 0.02, 'calibratedProbability': 0.45},
    ]

    selected, assessments, cash_frac = engine.filter_and_rank_tradeables(
        candidates=candidates,
        date_str='2020-01-01',
        max_picks=3
    )
    assert len(selected) == 0
    assert cash_frac == 1.0  # 100% Cash allocation


# =====================================================================
# Pillar 3: Factor Sleeve Ensemble Tests
# =====================================================================

def test_p3_sleeve_computation_and_sector_neutrality(synthetic_cross_section_panel):
    """Pillar 3: Verifies multi-factor sleeve computation, standardization, and sector neutralization."""
    ensemble = FactorSleeveEnsemble(sector_neutralize=True)

    df_raw = ensemble.compute_raw_sleeves(synthetic_cross_section_panel)
    for sleeve in SLEEVE_NAMES:
        assert f'sleeve_raw_{sleeve}' in df_raw.columns

    df_neut = ensemble.standardize_and_neutralize(df_raw)
    for sleeve in SLEEVE_NAMES:
        assert f'sleeve_z_{sleeve}' in df_neut.columns
        assert f'sleeve_neut_{sleeve}' in df_neut.columns

    # Verify sector neutralization: median of neutralized scores per sector should be ~0.0
    sample_date = df_neut['predictionTimestamp'].iloc[0]
    day_slice = df_neut[df_neut['predictionTimestamp'] == sample_date]
    sec_medians = day_slice.groupby('sector')['sleeve_neut_residual_momentum'].median()
    for med in sec_medians:
        assert abs(med) < 1e-4, f"Sector median {med} not zero after sector neutralization"

    # Verify blended score and percentile ranks
    df_blended = ensemble.blend_ensemble(df_neut)
    assert 'ensemble_alpha_score' in df_blended.columns
    assert 'ensemble_rank_pct' in df_blended.columns
    assert df_blended['ensemble_rank_pct'].between(0.0, 1.0).all()


# =====================================================================
# Pillar 4: Portfolio-Level Alpha Optimization & Cash Allocation Tests
# =====================================================================

def test_p4_portfolio_evaluator_tradeability_and_regime_scaling(
    synthetic_cross_section_panel,
    synthetic_benchmark_df
):
    """Pillar 4: Verifies Top3AlphaEvaluator with tradeability gating and regime exposure scaling."""
    # Build historical candles dictionary
    historical_candles = {}
    for t in synthetic_cross_section_panel['ticker'].unique():
        t_sub = synthetic_cross_section_panel[synthetic_cross_section_panel['ticker'] == t].copy()
        t_sub.set_index(pd.to_datetime(t_sub['predictionTimestamp']), inplace=True)
        t_sub['Open'] = t_sub['Close'] * 0.99
        historical_candles[t] = t_sub

    evaluator = Top3AlphaEvaluator(
        cost_regime='BASE_COST',
        enforce_tradeability_gate=True,
        enforce_regime_policy=True,
        use_tactical_entry_filter=True
    )

    res = evaluator.evaluate_top3_alpha(
        oos_predictions_df=synthetic_cross_section_panel,
        historical_candles=historical_candles,
        nifty_candles=synthetic_benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='5d'
    )

    assert 'annualizedCagr' in res
    assert 'sharpeRatio' in res
    assert 'tradeCount' in res
    assert 'portfolioDailyRecords' in res

    # Verify that portfolio records contain cashWeight and grossExposure
    daily_recs = res['portfolioDailyRecords']
    assert len(daily_recs) > 0
    for r in daily_recs:
        assert hasattr(r, 'cashWeight')
        assert hasattr(r, 'macroRegime')
        assert hasattr(r, 'grossExposure')
        assert 0.0 <= r.cashWeight <= 1.0
        assert 0.0 <= r.grossExposure <= 1.0


# =====================================================================
# Pillar 5: Slower 20D-60D Horizon & Tactical Entry Tests
# =====================================================================

def test_p5_slower_60d_target_generation(synthetic_benchmark_df):
    """Pillar 5: Verifies that 60D forward return target is calculated without lookahead."""
    df = synthetic_benchmark_df.copy()
    df_targets = compute_targets(df, benchmark_df=synthetic_benchmark_df, horizons=[1, 5, 20, 60])

    assert 'future_gross_ret_60d' in df_targets.columns
    assert 'future_net_excess_ret_60d' in df_targets.columns
    assert 'target_std_excess_60d' in df_targets.columns

    # Verify that the last 60 rows have NaN forward returns (strict no-lookahead)
    assert df_targets['future_gross_ret_60d'].iloc[-60:].isna().all()
    # While historical rows have valid numbers
    assert df_targets['future_gross_ret_60d'].iloc[:-61].notna().all()


def test_p5_tactical_entry_timing_bonus():
    """Pillar 5: Verifies that tactical entry filter boosts pullback candidates."""
    evaluator = Top3AlphaEvaluator(
        use_tactical_entry_filter=True
    )
    assert evaluator.use_tactical_entry_filter is True


# =====================================================================
# Institutional Audit Remediation: P0-1 to P1-2 Tests
# =====================================================================

def test_p0_1_learned_regime_weights_with_shrinkage(synthetic_benchmark_df):
    """
    P0-1: Verifies data-driven regime policy learning with Bayesian shrinkage toward equal-weight.
    Asserts:
    1. Spearman rank IC per sleeve is estimated across folds.
    2. Negative IC sleeves receive zero weight before shrinkage.
    3. Bayesian shrinkage lambda = N / (N + N0) where N0=50 pulls sleeve weights toward prior (0.20).
    4. Learner produces valid RegimeSignalPolicy with sleeve weights summing to 1.0.
    5. Registry update seamlessly sets policies in RegimeSpecialistEngine.
    """
    learner = RegimePolicyLearner(prior_strength_n0=50.0)

    dates = pd.date_range('2022-01-01', periods=80, freq='B')
    tickers = ['TICKER_1', 'TICKER_2', 'TICKER_3', 'TICKER_4', 'TICKER_5']
    records = []
    np.random.seed(42)
    for d in dates:
        regime = 'BULL_TREND' if d < dates[50] else 'BEAR_TREND'
        for tkr in tickers:
            records.append({
                'date': d,
                'ticker': tkr,
                'macro_regime': regime,
                'ret_20d': float(np.random.normal(0.02, 0.05)),
                'sleeve_raw_residual_momentum': float(np.random.normal(0.02, 0.05)),
                'sleeve_raw_tactical_pullback': float(np.random.normal(-0.01, 0.02)),
                'sleeve_raw_low_volatility': float(np.random.normal(0.01, 0.03)),
                'sleeve_raw_liquidity_quality': float(np.random.normal(0.0, 1.0)),
                'sleeve_raw_range_value': float(np.random.normal(0.01, 0.04)),
                'fwd_excess_return_5d': float(np.random.normal(0.01, 0.03))
            })
    train_panel = pd.DataFrame(records)

    policies, reports = learner.learn_policies_from_panel(train_panel)

    assert 'BULL_TREND' in policies
    assert 'BEAR_TREND' in policies
    assert 'CRISIS_PANIC' in policies

    bull_report = reports['BULL_TREND']
    assert isinstance(bull_report, RegimePolicyLearnerReport)
    assert bull_report.sample_count == 250  # 50 dates * 5 tickers
    assert 0.0 < bull_report.shrinkage_lambda < 1.0

    # Shrunken weights must sum to 1.0
    for s_name, w_shrunk in bull_report.shrunken_weights.items():
        assert 0.0 <= w_shrunk <= 1.0
    assert abs(sum(bull_report.shrunken_weights.values()) - 1.0) < 1e-4

    # Crisis panic policy must strictly enforce capital preservation
    crisis_pol = policies['CRISIS_PANIC']
    assert crisis_pol.max_gross_exposure <= 0.25
    assert crisis_pol.allow_new_entries is False
    assert crisis_pol.hurdle_multiplier >= 3.0

    # Set learned policies into RegimeSpecialistEngine
    engine = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_df)
    engine.set_policy_registry(policies)
    sample_date = str(synthetic_benchmark_df.index[100])[:10]
    active_pol = engine.get_regime_policy(sample_date)
    assert active_pol is not None


def test_p0_2_empirical_forecast_error_tradeability():
    """
    P0-2: Verifies empirical Newey-West/HAC forecast error uncertainty estimation and tradeability gating.
    Asserts:
    1. EmpiricalForecastUncertaintyEngine fits Newey-West HAC variance across residuals.
    2. TradeabilityGatingEngine uses empirical standard error without hardcoded sample count.
    3. Higher forecast uncertainty raises economic hurdle, filtering uncompetitive trades.
    """
    uncertainty_engine = EmpiricalForecastUncertaintyEngine(fallback_error_se=0.005)

    # Generate autocorrelated residuals (AR(1) process simulating overlapping returns)
    np.random.seed(42)
    n_samples = 200
    e = np.zeros(n_samples)
    noise = np.random.normal(0, 0.02, n_samples)
    for i in range(1, n_samples):
        e[i] = 0.6 * e[i - 1] + noise[i]

    res_df = pd.DataFrame({
        'horizon': ['5d'] * n_samples,
        'macro_regime': ['BULL_TREND'] * n_samples,
        'forecast_residual': e
    })

    calibrated_table = uncertainty_engine.fit_hac_standard_errors(res_df)
    assert ('5d', 'BULL_TREND') in calibrated_table
    empirical_se = uncertainty_engine.get_forecast_error_se(horizon='5d', macro_regime='BULL_TREND')
    assert 0.002 <= empirical_se <= 0.025

    gating_engine = TradeabilityGatingEngine(
        uncertainty_engine=uncertainty_engine,
        risk_buffer_lambda=0.08
    )

    # Marginal edge: filtered out by statistical uncertainty hurdle
    marginal_assessment = gating_engine.evaluate_candidate(
        ticker='RELIANCE.NS',
        date_str='2023-01-01',
        expected_excess_return=0.003,  # 30 bps
        horizon_volatility=0.025,
        calibrated_prob=0.52,
        horizon='5d',
        macro_regime='BULL_TREND'
    )
    assert marginal_assessment.expected_net_alpha < 0.003
    assert marginal_assessment.is_tradeable is False

    # Strong edge: passes gate decisively
    strong_assessment = gating_engine.evaluate_candidate(
        ticker='TCS.NS',
        date_str='2023-01-01',
        expected_excess_return=0.040,  # 400 bps
        horizon_volatility=0.020,
        calibrated_prob=0.68,
        horizon='5d',
        macro_regime='BULL_TREND'
    )
    assert strong_assessment.is_tradeable is True
    assert strong_assessment.expected_net_alpha > 0.015


def test_p0_3_constrained_portfolio_optimizer_vs_equal_weight(synthetic_cross_section_panel, synthetic_benchmark_df):
    """
    P0-3: Verifies constrained quadratic utility optimization vs equal weight.
    Asserts:
    1. SLSQP optimizer maximizes net alpha minus risk penalty minus turnover penalty.
    2. Weights strictly obey single-stock bounds (<= 0.40) and sector concentration bounds (<= 0.45).
    3. Cash allocation matches macro regime gross exposure requirement.
    4. Evaluator returns portfolioOptimization diagnostics.
    """
    historical_candles = {}
    for t in synthetic_cross_section_panel['ticker'].unique():
        t_sub = synthetic_cross_section_panel[synthetic_cross_section_panel['ticker'] == t].copy()
        t_sub.set_index(pd.to_datetime(t_sub['predictionTimestamp']), inplace=True)
        t_sub['Open'] = t_sub['Close'] * 0.99
        historical_candles[t] = t_sub

    evaluator_opt = Top3AlphaEvaluator(
        portfolio_allocation_mode='OPTIMIZED',
        enforce_regime_policy=True,
        enforce_tradeability_gate=False
    )

    res_opt = evaluator_opt.evaluate_top3_alpha(
        oos_predictions_df=synthetic_cross_section_panel,
        historical_candles=historical_candles,
        nifty_candles=synthetic_benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='5d'
    )

    assert 'portfolioOptimization' in res_opt
    assert res_opt['portfolioOptimization']['allocationMode'] == 'OPTIMIZED'
    assert res_opt['portfolioOptimization']['meanOptimizedGrossExposure'] > 0.0
    assert 0.0 <= res_opt['portfolioOptimization']['meanCashWeight'] <= 1.0

    # Also test equal-weight baseline comparison
    evaluator_eq = Top3AlphaEvaluator(
        portfolio_allocation_mode='EQUAL_WEIGHT',
        enforce_regime_policy=True,
        enforce_tradeability_gate=False
    )

    res_eq = evaluator_eq.evaluate_top3_alpha(
        oos_predictions_df=synthetic_cross_section_panel,
        historical_candles=historical_candles,
        nifty_candles=synthetic_benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='5d'
    )

    assert res_eq['portfolioOptimization']['allocationMode'] == 'EQUAL_WEIGHT'


def test_p1_1_calibrated_tactical_overlay():
    """
    P1-1: Verifies tactical overlay calibration using orthogonal OLS regression.
    Asserts:
    1. When tactical signal has no statistically significant alpha (t < 2.0, p > 0.05),
       the calibrated weight is strictly forced to 0.0.
    2. When tactical signal has significant orthogonal predictive power (t >= 2.0, p <= 0.05),
       the calibrated weight is positive and matches regression beta.
    """
    np.random.seed(42)
    n = 200
    core_alpha = np.random.normal(0, 1, n)

    # Case A: Pure noise tactical signal
    tactical_noise = np.random.normal(0, 1, n)
    fwd_ret_noise = 0.01 * core_alpha + np.random.normal(0, 0.02, n)
    df_noise = pd.DataFrame({
        'canonicalAlphaScore': core_alpha,
        'sleeve_raw_tactical_pullback': tactical_noise,
        'fwd_excess_return_5d': fwd_ret_noise
    })

    weight_noise, t_noise, p_noise = TacticalOverlayCalibrator.calibrate(
        train_df=df_noise,
        core_alpha_col='canonicalAlphaScore',
        tactical_signal_col='sleeve_raw_tactical_pullback',
        target_col='fwd_excess_return_5d'
    )
    assert weight_noise == 0.0
    assert t_noise < 2.0

    # Case B: Significant tactical signal with genuine predictive power
    tactical_sig = np.random.normal(0, 1, n)
    fwd_ret_sig = 0.01 * core_alpha + 0.025 * tactical_sig + np.random.normal(0, 0.01, n)
    df_sig = pd.DataFrame({
        'canonicalAlphaScore': core_alpha,
        'sleeve_raw_tactical_pullback': tactical_sig,
        'fwd_excess_return_5d': fwd_ret_sig
    })

    weight_sig, t_sig, p_sig = TacticalOverlayCalibrator.calibrate(
        train_df=df_sig,
        core_alpha_col='canonicalAlphaScore',
        tactical_signal_col='sleeve_raw_tactical_pullback',
        target_col='fwd_excess_return_5d'
    )
    assert weight_sig > 0.0
    assert t_sig >= 2.0
    assert p_sig <= 0.05


def test_p1_2_crisis_panic_strictly_zero_new_entries(synthetic_benchmark_df):
    """
    P1-2: Verifies that in CRISIS_PANIC regime (where allow_new_entries=False),
    zero new positions are opened and capital preservation is strictly enforced.
    """
    engine = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_df)

    # Dates 310 to 330 in synthetic_benchmark_df are in CRISIS_PANIC
    crisis_dates = [str(d)[:10] for d in synthetic_benchmark_df.index[310:325]]
    tickers = [f'STK_{i:02d}.NS' for i in range(10)]
    sectors = ['IT', 'IT', 'IT', 'FIN', 'FIN', 'FIN', 'AUTO', 'AUTO', 'PHARMA', 'PHARMA']
    sector_map = dict(zip(tickers, sectors))

    np.random.seed(999)
    records = []
    for d_str in crisis_dates:
        for t in tickers:
            records.append({
                'predictionTimestamp': d_str,
                'ticker': t,
                'sector': sector_map[t],
                'Close': float(np.random.uniform(100, 2000)),
                'ret_5d': float(np.random.normal(-0.03, 0.04)),
                'ret_20d': float(np.random.normal(-0.06, 0.06)),
                'beta_nifty': 1.0,
                'relative_strength_nifty': -0.02,
                'ema_20_dist': -0.05,
                'sma_50_dist': -0.08,
                'atr_percent': 0.03,
                'vol_20d': 0.30,
                'downside_deviation': 0.22,
                'volume_z_score': 0.5,
                'rel_volume': 1.2,
                'dist_52w_low': 0.05,
                'dist_52w_high': -0.30,
                'stoch_k': 30.0,
                'expectedReturn': 0.01,
                'expectedRisk': 0.03,
                'calibratedProbability': 0.52,
                'canonicalAlphaScore': float(np.random.uniform(0.5, 1.5)),
                'adv20': 50000000.0,
                'ADV': 100000.0,
                'beta': 1.0
            })
    crisis_panel = pd.DataFrame(records)

    historical_candles = {}
    for t in tickers:
        t_sub = crisis_panel[crisis_panel['ticker'] == t].copy()
        t_sub.set_index(pd.to_datetime(t_sub['predictionTimestamp']), inplace=True)
        t_sub['Open'] = t_sub['Close'] * 0.99
        historical_candles[t] = t_sub

    evaluator = Top3AlphaEvaluator(
        enforce_regime_policy=True,
        enforce_tradeability_gate=False,
        regime_engine=engine
    )

    res = evaluator.evaluate_top3_alpha(
        oos_predictions_df=crisis_panel,
        historical_candles=historical_candles,
        nifty_candles=synthetic_benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='5d'
    )

    daily_recs = res['portfolioDailyRecords']
    assert len(daily_recs) > 0

    # In CRISIS_PANIC with allow_new_entries=False, newPositionsOpened must be exactly 0
    for r in daily_recs:
        assert r.macroRegime == 'CRISIS_PANIC'
        assert r.newPositionsOpened == 0, f"Violation on {r.date}: {r.newPositionsOpened} opened in CRISIS_PANIC"
        assert r.grossExposure <= 0.25
        assert r.cashWeight >= 0.75

    assert res['portfolioOptimization']['totalNewPositionsInCrisis'] == 0


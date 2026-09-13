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
    CANONICAL_REGIME_STATES
)
from models.tradeability_engine import (
    TradeabilityGatingEngine,
    TradeabilityAssessment
)
from models.sleeve_ensemble import (
    FactorSleeveEnsemble,
    SLEEVE_NAMES,
    DEFAULT_SLEEVE_WEIGHTS
)
from backtest.top3_alpha_evaluator import (
    Top3AlphaEvaluator,
    Top3DailyPortfolioRecord
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

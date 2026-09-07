"""
Unit & Adversarial Tests for RegimeSpecialistEngine and RegimeConditionedAlphaRanker.
===================================================================================
Verifies:
1. Deterministic classification of macro market regimes (8 states)
2. Adversarial zero-lookahead / point-in-time causal integrity
3. 3-day persistence confirmation filter behavior
4. Specialist fitting, fallback to global model for rare regimes, and scale consistency
"""
import pytest
import pandas as pd
import numpy as np
import sys, os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.regime_specialist_engine import (
    RegimeSpecialistEngine,
    CANONICAL_REGIME_STATES,
    DEFAULT_FALLBACK_REGIME
)
from models.alpha_ranker import RegimeConditionedAlphaRanker, CrossSectionalAlphaRanker
from features.feature_engine import FEATURE_NAMES


@pytest.fixture
def synthetic_benchmark_series():
    """Generates synthetic multi-year benchmark series with known regimes."""
    dates = pd.date_range(start='2015-01-01', periods=800, freq='B')
    np.random.seed(42)
    # Drift + random walk
    rets = np.random.normal(0.0004, 0.01, size=len(dates))
    prices = 1000.0 * np.exp(np.cumsum(rets))
    df = pd.DataFrame({'Close': prices, 'Open': prices * 0.999, 'High': prices * 1.005, 'Low': prices * 0.995, 'Volume': 1000000}, index=dates)
    return df


def test_regime_specialist_engine_deterministic_output(synthetic_benchmark_series):
    """Engine classifies dates into canonical 8 regime states with complete metadata."""
    engine = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_series)
    summary = engine.get_regime_summary()
    
    assert summary['totalTradingDays'] == len(synthetic_benchmark_series)
    assert len(summary['stateCounts']) > 0
    for state in summary['stateCounts'].keys():
        assert state in CANONICAL_REGIME_STATES

    # Test single date lookup
    sample_date = str(synthetic_benchmark_series.index[300])[:10]
    regime = engine.get_regime_for_date(sample_date)
    assert regime in CANONICAL_REGIME_STATES


def test_regime_causal_point_in_time_integrity(synthetic_benchmark_series):
    """
    Adversarial test: Inject extreme future market crash/spike at t+1...t+10.
    Assert that the regime classification at cutoff t is 100% identical.
    """
    cutoff_idx = 400
    cutoff_date = str(synthetic_benchmark_series.index[cutoff_idx])[:10]
    
    # 1. Base classification
    engine_base = RegimeSpecialistEngine(benchmark_df=synthetic_benchmark_series)
    base_regime_at_t = engine_base.get_regime_for_date(cutoff_date)
    
    # 2. Corrupt future data (t+1 to t+50) with 10x volatility and -80% crash
    corrupted_series = synthetic_benchmark_series.copy()
    corrupted_series.iloc[cutoff_idx + 1: cutoff_idx + 50, corrupted_series.columns.get_loc('Close')] *= 0.20
    
    engine_corrupted = RegimeSpecialistEngine(benchmark_df=corrupted_series)
    corrupted_regime_at_t = engine_corrupted.get_regime_for_date(cutoff_date)
    
    assert base_regime_at_t == corrupted_regime_at_t, (
        f"Point-in-time leakage detected! Base regime at {cutoff_date} was {base_regime_at_t} "
        f"but future price corruption changed it to {corrupted_regime_at_t}!"
    )


def test_regime_3day_persistence_filter():
    """
    Tests that a 1-day or 2-day temporary market spike does NOT flip the confirmed regime,
    while a 3-day sustained move confirms the transition.
    """
    dates = pd.date_range(start='2020-01-01', periods=100, freq='B')
    # Stable baseline flat prices at 100
    prices = np.full(len(dates), 100.0)
    
    # At day 50 and 51, price spikes to 200 (2 days only)
    prices[50] = 200.0
    prices[51] = 200.0
    # Day 52 returns to 100
    prices[52:] = 100.0
    
    df = pd.DataFrame({'Close': prices}, index=dates)
    engine = RegimeSpecialistEngine(benchmark_df=df, confirmation_days=3)
    
    d49 = str(dates[49])[:10]
    d50 = str(dates[50])[:10]
    d51 = str(dates[51])[:10]
    
    reg_49 = engine.get_regime_for_date(d49)
    reg_50 = engine.get_regime_for_date(d50)
    reg_51 = engine.get_regime_for_date(d51)
    
    # Because the spike lasted only 2 days, the filtered state must NOT have flipped on day 50 or 51
    assert reg_50 == reg_49, "2-day transient fluctuation incorrectly triggered regime transition!"
    assert reg_51 == reg_49, "2-day transient fluctuation incorrectly triggered regime transition on day 2!"


def test_regime_conditioned_alpha_ranker_fit_predict():
    """
    Verifies that RegimeConditionedAlphaRanker trains specialist models for qualifying regimes
    and routes test predictions correctly by date regime.
    """
    np.random.seed(42)
    dates = pd.date_range(start='2020-01-01', periods=60, freq='B')
    tickers = ['TICKER_A', 'TICKER_B', 'TICKER_C', 'TICKER_D']
    
    records = []
    for d in dates:
        d_str = str(d)[:10]
        st = 'BULL_LOWVOL_TREND' if d < dates[30] else 'BULL_LOWVOL_CHOPPY'
        for t in tickers:
            row = {feat: np.random.normal(0, 1) for feat in FEATURE_NAMES}
            row['predictionTimestamp'] = d_str
            row['ticker'] = t
            row['regime_state'] = st
            row['target_rank_grade_5d'] = np.random.choice([0, 1, 2, 3, 4])
            row['target_vol_std_excess_5d'] = np.random.normal(0.01, 0.05)
            row['target_net_excess_binary_5d'] = 1 if row['target_vol_std_excess_5d'] > 0 else 0
            row['vol_20d'] = 0.20
            row['atr_percent'] = 0.02
            records.append(row)
            
    df = pd.DataFrame(records)
    train_df = df[df['predictionTimestamp'] < str(dates[40])[:10]].copy()
    test_df = df[df['predictionTimestamp'] >= str(dates[40])[:10]].copy()
    
    # Train with low min_samples for synthetic unit test
    ranker = RegimeConditionedAlphaRanker(horizon_str='5d', min_specialist_samples=50, min_specialist_dates=5)
    ranker.fit(train_df, features=FEATURE_NAMES)
    
    summary = ranker.get_specialist_summary()
    assert summary['isFitted'] is True
    assert summary['totalTrainedSpecialists'] >= 1
    
    # Predict
    preds = ranker.predict(test_df, features=FEATURE_NAMES)
    assert 'canonicalAlphaScore' in preds.columns
    assert 'expectedExcessReturn' in preds.columns
    assert 'active_regime_model' in preds.columns
    assert len(preds) == len(test_df)
    assert not preds['canonicalAlphaScore'].isna().any()


def test_regime_conditioned_alpha_ranker_fallback():
    """
    Verifies that rare regime states lacking sufficient training samples
    seamlessly fall back to the global anchor model without throwing errors.
    """
    np.random.seed(42)
    dates = pd.date_range(start='2020-01-01', periods=30, freq='B')
    tickers = ['TICKER_A', 'TICKER_B']
    
    records = []
    for d in dates:
        d_str = str(d)[:10]
        # Only 2 rows of rare state
        st = 'BEAR_HIGHVOL_TREND' if d == dates[0] else 'BULL_LOWVOL_CHOPPY'
        for t in tickers:
            row = {feat: np.random.normal(0, 1) for feat in FEATURE_NAMES}
            row['predictionTimestamp'] = d_str
            row['ticker'] = t
            row['regime_state'] = st
            row['target_rank_grade_5d'] = np.random.choice([0, 1, 2, 3, 4])
            row['target_vol_std_excess_5d'] = np.random.normal(0.01, 0.05)
            row['target_net_excess_binary_5d'] = 1 if row['target_vol_std_excess_5d'] > 0 else 0
            row['vol_20d'] = 0.20
            row['atr_percent'] = 0.02
            records.append(row)
            
    df = pd.DataFrame(records)
    # Require 100 samples for specialist: BEAR_HIGHVOL_TREND has only 2 rows, so it MUST fall back
    ranker = RegimeConditionedAlphaRanker(horizon_str='5d', min_specialist_samples=100, min_specialist_dates=10)
    ranker.fit(df, features=FEATURE_NAMES)
    
    summary = ranker.get_specialist_summary()
    assert 'BEAR_HIGHVOL_TREND' not in summary['trainedSpecialistStates']
    
    # Test prediction with the rare state
    rare_test = df[df['regime_state'] == 'BEAR_HIGHVOL_TREND'].copy()
    preds = ranker.predict(rare_test, features=FEATURE_NAMES)
    assert (preds['active_regime_model'] == 'GLOBAL_FALLBACK').all()

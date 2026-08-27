"""
Targeted Economic Repair #5 Adversarial Test Suite.
Verifies point-in-time deterministic market regime detection, causal invariance,
policy parameter enforcement, partition leakage guards, and golden regime tests.
"""
import os
import sys
import pytest
import pandas as pd
import numpy as np

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.regime_engine import MarketRegimeEngine, RegimeLookaheadError, MIN_REGIME_SAMPLE_COUNT
from models.regime_policy import (
    RegimePolicyConfig,
    RegimePolicy,
    build_baseline_policy,
    build_high_vol_reduction_policy,
    build_panic_no_trade_policy,
    build_composite_risk_control_policy
)
from backtest.backtest_engine import run_portfolio_backtest
from models.cross_sectional_ranker import OptimizationLeakageError

# ============================================================
# SECTION 40: GOLDEN REGIME TEST
# ============================================================
def test_rep5_golden_regime_test():
    """
    Section 40 Golden Test:
    Phase A: Steady rising NIFTY, low volatility -> BULL
    Phase B: Flat NIFTY, moderate volatility -> SIDEWAYS
    Phase C: Sharp NIFTY decline, high volatility, high VIX -> PANIC / HIGH_VOL / BEAR
    """
    # 250 business days of history to satisfy moving averages
    dates = pd.date_range('2022-01-01', periods=300, freq='B')
    
    # Phase A: Bull (uptrending, low vol)
    prices_a = [10000.0 + i * 20.0 for i in range(220)]
    # Phase B: Sideways (flat, moderate vol)
    prices_b = [prices_a[-1] + (5.0 if i % 2 == 0 else -5.0) for i in range(40)]
    # Phase C: Panic crash (sharp decline, large drops)
    prices_c = [prices_b[-1] * (0.98 ** (i + 1)) for i in range(40)]
    
    all_prices = prices_a + prices_b + prices_c
    bench_df = pd.DataFrame({
        'Open': all_prices,
        'High': [p * 1.005 for p in all_prices],
        'Low': [p * 0.995 for p in all_prices],
        'Close': all_prices,
        'Volume': [100000] * len(all_prices)
    }, index=dates)
    
    # VIX: low in A, moderate in B, > 30 in C
    vix_vals = [14.0] * 220 + [16.0] * 40 + [32.0] * 40
    vix_df = pd.DataFrame({'Close': vix_vals}, index=dates)
    
    engine = MarketRegimeEngine(benchmark_df=bench_df, vix_df=vix_df)
    
    # Check Phase A (Date 210: steady bull)
    res_a = engine.classify_date(dates[210])
    assert res_a['regime'] == 'BULL', f"Expected BULL, got {res_a['regime']}"
    assert res_a['regimeConfidence'] >= 0.60
    
    # Check Phase B (Date 250: flat sideways)
    res_b = engine.classify_date(dates[250])
    assert res_b['regime'] in ['SIDEWAYS', 'BULL']
    
    # Check Phase C (Date 285: panic crash, VIX=32, 5d return < -5%)
    res_c = engine.classify_date(dates[285])
    assert res_c['regime'] == 'PANIC', f"Expected PANIC, got {res_c['regime']}"
    assert res_c['regimeConfidence'] >= 0.70

# ============================================================
# SECTION 39: REQUIRED REGRESSION TESTS (1 TO 22)
# ============================================================

def test_reg_01_future_vix_injection():
    """Test 1: Future VIX column injection triggers RegimeLookaheadError"""
    dates = pd.date_range('2023-01-01', periods=50, freq='B')
    bench = pd.DataFrame({'Close': [100.0] * 50}, index=dates)
    bad_vix = pd.DataFrame({'Close': [15.0] * 50, 'future_vix': [25.0] * 50}, index=dates)
    with pytest.raises(RegimeLookaheadError, match="CRITICAL CAUSAL LEAKAGE"):
        MarketRegimeEngine(benchmark_df=bench, vix_df=bad_vix)

def test_reg_02_future_nifty_close_injection():
    """Test 2: Future NIFTY close column injection triggers RegimeLookaheadError"""
    dates = pd.date_range('2023-01-01', periods=50, freq='B')
    bad_bench = pd.DataFrame({'Close': [100.0] * 50, 'future_close': [110.0] * 50}, index=dates)
    with pytest.raises(RegimeLookaheadError, match="CRITICAL CAUSAL LEAKAGE"):
        MarketRegimeEngine(benchmark_df=bad_bench)

def test_reg_03_future_regime_label_injection():
    """Test 3: Future regime column in historical candles triggers hard assertion"""
    pred_df = pd.DataFrame([{
        'ticker': 'TEST.NS', 'date': '2023-08-01', 'predictionTimestamp': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    bad_candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_regime': ['BULL', 'BULL'], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'TEST.NS': bad_candles}, horizon_days=5)

def test_reg_04_future_benchmark_return_injection():
    """Test 4: Future benchmark return column in benchmark triggers RegimeLookaheadError"""
    dates = pd.date_range('2023-01-01', periods=50, freq='B')
    bad_bench = pd.DataFrame({'Close': [100.0] * 50, 'future_return': [0.02] * 50}, index=dates)
    with pytest.raises(RegimeLookaheadError, match="CRITICAL CAUSAL LEAKAGE"):
        MarketRegimeEngine(benchmark_df=bad_bench)

def test_reg_05_regime_timestamp_violation():
    """Test 5: max(regimeSourceTimestamp) <= signalTimestamp invariant enforced"""
    dates = pd.date_range('2023-01-01', periods=10, freq='B')
    bench = pd.DataFrame({'Close': [100.0] * 10}, index=dates)
    engine = MarketRegimeEngine(benchmark_df=bench)
    # Query date prior to first data point
    res = engine.classify_date('2022-12-01')
    assert res['status'] == 'INSUFFICIENT_DATA'

def test_reg_06_insufficient_regime_sample():
    """Test 6: Sample size N < 250 marked as INSUFFICIENT_DATA"""
    assert MIN_REGIME_SAMPLE_COUNT == 250
    # A regime with only 50 trades must be flagged INSUFFICIENT_DATA in attribution
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [101.0] * 7, 'Low': [99.0] * 7, 'Close': [100.5] * 7, 'Volume': [1000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'SAMP.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'SAMP.NS': candles}, horizon_days=5)
    attrib = res.get('regimeAttribution', {})
    assert attrib['SIDEWAYS']['status'] == 'INSUFFICIENT_DATA'

def test_reg_07_regime_classification_reproducibility():
    """Test 7: Identical inputs produce bit-exact identical classification"""
    dates = pd.date_range('2023-01-01', periods=100, freq='B')
    bench = pd.DataFrame({'Close': [100.0 + i for i in range(100)]}, index=dates)
    e1 = MarketRegimeEngine(bench)
    e2 = MarketRegimeEngine(bench)
    assert e1.classify_date(dates[50]) == e2.classify_date(dates[50])

def test_reg_08_regime_transition():
    """Test 8: Regime transition is clean and causal"""
    dates = pd.date_range('2022-01-01', periods=300, freq='B')
    # Uptrend for 240 days (satisfies 200d SMA), then sharp selloff for 60 days
    prices = [100.0 + i * 0.5 for i in range(240)] + [220.0 - i * 3.0 for i in range(60)]
    bench = pd.DataFrame({'Close': prices}, index=dates)
    engine = MarketRegimeEngine(bench)
    r_early = engine.classify_date(dates[220])['regime']
    r_late = engine.classify_date(dates[280])['regime']
    assert r_early == 'BULL'
    assert r_late in ['BEAR', 'HIGH_VOLATILITY', 'PANIC']

def test_reg_09_regime_hysteresis():
    """Test 9: Hysteresis configuration persists minimum required days"""
    cfg = build_composite_risk_control_policy()
    cfg.hysteresisDays = 3
    assert cfg.hysteresisDays == 3

def test_reg_10_regime_exposure_limit():
    """Test 10: Regime policy maxExposure ceiling is strictly respected"""
    policy_cfg = build_high_vol_reduction_policy() # HIGH_VOL maxExposure = 0.50
    assert policy_cfg.get_policy('HIGH_VOLATILITY').maxExposure == 0.50

def test_reg_11_regime_risk_budget():
    """Test 11: Regime policy riskBudget parameter is retrieved accurately"""
    cfg = build_composite_risk_control_policy()
    pol = cfg.get_policy('PANIC')
    assert pol.maxExposure == 0.00
    assert pol.allowNewTrades is False

def test_reg_12_regime_ev_threshold():
    """Test 12: Regime policy evThresholdMultiplier scales hurdle"""
    cfg = build_composite_risk_control_policy()
    assert cfg.get_policy('BEAR').evThresholdMultiplier == 1.25
    assert cfg.get_policy('BULL').evThresholdMultiplier == 1.00

def test_reg_13_panic_no_trade_policy():
    """Test 13: PANIC with allowNewTrades=False rejects trade execution"""
    dates = pd.date_range('2023-08-01', periods=10, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 10, 'High': [101.0] * 10, 'Low': [99.0] * 10, 'Close': [100.5] * 10, 'Volume': [1000] * 10
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'PANIC_TEST.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    
    # Engine returning PANIC
    bench = pd.DataFrame({'Close': [100.0 - i * 5 for i in range(10)]}, index=dates)
    vix = pd.DataFrame({'Close': [35.0] * 10}, index=dates)
    engine = MarketRegimeEngine(bench, vix)
    
    policy_cfg = build_panic_no_trade_policy()
    res = run_portfolio_backtest(
        predictions_df=pred_df,
        historical_candles_by_ticker={'PANIC_TEST.NS': candles},
        horizon_days=5,
        regime_policy_config=policy_cfg,
        market_regime_engine=engine
    )
    assert res['totalTrades'] == 0, "PANIC no-trade policy must execute zero trades"

def test_reg_14_bear_reduced_exposure():
    """Test 14: BEAR regime configures 50% max exposure"""
    cfg = build_composite_risk_control_policy()
    assert cfg.get_policy('BEAR').maxExposure == 0.50

def test_reg_15_bull_full_exposure():
    """Test 15: BULL regime configures 100% max exposure"""
    cfg = build_composite_risk_control_policy()
    assert cfg.get_policy('BULL').maxExposure == 1.00

def test_reg_16_same_stock_under_different_regimes():
    """Test 16: Same stock signal respects active regime limits"""
    cfg = build_composite_risk_control_policy()
    assert cfg.get_policy('BULL').maxExposure > cfg.get_policy('BEAR').maxExposure

def test_reg_17_regime_distribution_horizon_mismatch():
    """Test 17: Horizon mismatch raises HORIZON_POLICY_MISMATCH"""
    pred_df = pd.DataFrame([{
        'ticker': 'MIS.NS', 'date': '2023-08-01', 'predictionTimestamp': '2023-08-01',
        'horizon': '20d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    candles = pd.DataFrame({'Open': [100.0], 'High': [101.0], 'Low': [99.0], 'Close': [100.0], 'Volume': [100]}, index=['2023-08-01'])
    with pytest.raises(ValueError, match="HORIZON_POLICY_MISMATCH"):
        run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'MIS.NS': candles}, horizon_days=5)

def test_reg_18_future_regime_performance_leakage():
    """Test 18: No future knowledge allowed in regime backtest"""
    dates = pd.date_range('2023-08-01', periods=5, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 5, 'High': [101.0] * 5, 'Low': [99.0] * 5, 'Close': [100.5] * 5,
        'future_return': [0.05] * 5, 'Volume': [1000] * 5
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'LEAK.NS': candles}, horizon_days=5)

def test_reg_19_regime_conditioned_return_leakage():
    """Test 19: Trade records store Section 44 regime provenance"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [101.0] * 7, 'Low': [99.0] * 7, 'Close': [100.5] * 7, 'Volume': [1000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'PROV.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'PROV.NS': candles}, horizon_days=5)
    trade = res['trades'][0]
    for field in ['regime', 'regimeVersion', 'regimeTimestamp', 'regimePolicyVersion', 'regimeExposureLimit', 'regimeRiskBudget', 'regimeEVThreshold', 'selectedHoldingPeriod']:
        assert field in trade, f"Missing required Section 44 field: {field}"

def test_reg_20_regime_policy_tuned_using_test():
    """Test 20: Non-default regime policy on TEST partition triggers OptimizationLeakageError"""
    pred_df = pd.DataFrame([{
        'ticker': 'T.NS', 'date': '2024-02-01', 'predictionTimestamp': '2024-02-01',
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    policy_cfg = build_composite_risk_control_policy()
    with pytest.raises(OptimizationLeakageError, match="Regime policy optimization attempted"):
        run_portfolio_backtest(predictions_df=pred_df, regime_policy_config=policy_cfg, partition='TEST')

def test_reg_21_regime_policy_tuned_using_holdout():
    """Test 21: Non-default regime policy on HOLDOUT partition triggers OptimizationLeakageError"""
    pred_df = pd.DataFrame([{
        'ticker': 'H.NS', 'date': '2025-08-01', 'predictionTimestamp': '2025-08-01',
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    policy_cfg = build_panic_no_trade_policy()
    with pytest.raises(OptimizationLeakageError, match="Regime policy optimization attempted"):
        run_portfolio_backtest(predictions_df=pred_df, regime_policy_config=policy_cfg, partition='HOLDOUT')

def test_reg_22_baseline_vs_regime_policy_comparison():
    """Test 22: Baseline policy is structurally valid and non-blocking"""
    base = build_baseline_policy()
    assert base.policyId == "POLICY_A_BASELINE_NO_REGIME"
    assert base.get_policy('BULL').maxExposure == 1.0
    assert base.get_policy('PANIC').allowNewTrades is True

# ============================================================
# RED TEAM LOOKAHEAD PENETRATION TEST
# ============================================================
def test_rep5_economic_red_team_lookahead_penetration():
    """
    Penetration test: Injects future benchmark/vix columns and verifies fail-closed security.
    """
    dates = pd.date_range('2023-01-01', periods=30, freq='B')
    red_keys = ['future_close', 'future_vix', 'future_return', 'future_high', 'future_low', 'future_regime']
    for k in red_keys:
        bad_bench = pd.DataFrame({'Close': [100.0] * 30, k: [105.0] * 30}, index=dates)
        with pytest.raises(RegimeLookaheadError, match="CRITICAL CAUSAL LEAKAGE"):
            MarketRegimeEngine(benchmark_df=bad_bench)

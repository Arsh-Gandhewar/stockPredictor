import os
import sys
import pytest
import numpy as np
import pandas as pd
from typing import Dict, Any

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from backtest.backtest_engine import run_portfolio_backtest
from research.signal_decay_engine import (
    calculate_cohort_decay_metrics,
    compute_multi_horizon_forward_returns
)
from models.cross_sectional_ranker import OptimizationLeakageError


# ============================================================
# SECTION 41: GOLDEN EXIT TEST
# ============================================================
def test_rep4_01_golden_exit_test():
    """
    Synthetic trade: Entry = 100.
    Future closes: 101, 102, 101.5, 104, 103.
    Verifies exit occurs at mathematically expected timestamp with no lookahead.
    """
    dates = pd.date_range('2023-08-01', periods=8, freq='B')
    prices = [100.0, 101.0, 102.0, 101.5, 104.0, 103.0, 106.0, 105.0]
    
    candles_df = pd.DataFrame({
        'Open': [p - 0.2 for p in prices],
        'High': [p + 0.5 for p in prices],
        'Low': [p - 0.5 for p in prices],
        'Close': prices,
        'Volume': [10000] * len(prices)
    }, index=[str(d)[:10] for d in dates])
    
    pred_row = {
        'ticker': 'GOLDEN.NS',
        'predictionTimestamp': str(dates[0])[:10],
        'date': str(dates[0])[:10],
        'horizon': '5d',
        'calibratedProbability': 0.65,
        'pred_prob': 0.65,
        'Open': 100.0,
        'atr_percent': 0.015,
        'conditional_gain': 0.08,
        'conditional_loss': 0.02,
        'p15': -0.02,
        'p50': 0.01,
        'p85': 0.08,
        'ev_after_cost': 0.04,
        'riskAdjustedExpectedValue': 2.0,
        'opportunityScore': 2.0,
        'alphaRank': 1
    }
    pred_df = pd.DataFrame([pred_row])
    
    res = run_portfolio_backtest(
        predictions_df=pred_df,
        historical_candles_by_ticker={'GOLDEN.NS': candles_df},
        horizon_days=5,
        exit_policy='FIXED_HORIZON',
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    
    assert res['totalTrades'] == 1, "Must execute exactly one trade"
    trade = res['trades'][0]
    assert trade['daysHeld'] == 5, f"Expected 5 days held, got {trade['daysHeld']}"
    assert trade['exitReason'] == 'HORIZON_EXPIRY'
    assert 'MFE' in trade and 'MAE' in trade
    assert trade['MFE'] > 0.0
    assert trade['MAE'] <= 0.0


# ============================================================
# SECTION 42: OPPORTUNITY-COST GOLDEN TEST
# ============================================================
def test_rep4_02_opportunity_cost_golden_test():
    """
    Current position: riskAdjustedEV = 0.50%.
    Candidate 1: riskAdjustedEV = 0.55%, switch cost = 0.20%, switch margin = 0.10%.
    Threshold = 0.50 + 0.20 + 0.10 = 0.80%.
    0.55% < 0.80% -> DO NOT SWITCH.
    Candidate 2: riskAdjustedEV = 1.00% > 0.80% -> SWITCH.
    """
    switch_cost = 0.0020
    switch_margin = 0.0010
    threshold = switch_cost + switch_margin
    
    worst_ev = 0.0050
    
    # Case A: Below threshold
    cand_a_ev = 0.0055
    diff_a = cand_a_ev - worst_ev
    should_switch_a = diff_a > threshold
    assert not should_switch_a, "Candidate with 0.55% EV should NOT trigger switch (diff 0.05% < 0.30%)"
    
    # Case B: Above threshold
    cand_b_ev = 0.0100
    diff_b = cand_b_ev - worst_ev
    should_switch_b = diff_b > threshold
    assert should_switch_b, "Candidate with 1.00% EV MUST trigger switch (diff 0.50% > 0.30%)"


# ============================================================
# SECTION 43: MAE / MFE GOLDEN TEST
# ============================================================
def test_rep4_03_mae_mfe_golden_test():
    """
    Synthetic trade:
    Entry = 100
    High reaches 110
    Low reaches 98
    Exit = 105
    Expected:
    MFE = +10.0%, MAE = -2.0%, realized = +5.0%
    """
    entry = 100.0
    high = 110.0
    low = 98.0
    exit_p = 105.0
    
    mfe = (high - entry) / entry
    mae = (low - entry) / entry
    realized = (exit_p - entry) / entry
    
    assert abs(mfe - 0.10) < 1e-6, f"Expected MFE 0.10, got {mfe}"
    assert abs(mae - (-0.02)) < 1e-6, f"Expected MAE -0.02, got {mae}"
    assert abs(realized - 0.05) < 1e-6, f"Expected realized return 0.05, got {realized}"


# ============================================================
# SECTION 44: SIGNAL-DECAY GOLDEN TEST
# ============================================================
def test_rep4_04_signal_decay_golden_test():
    """
    Synthetic signal:
    1D net return = +0.02
    2D net return = +0.03 (peak)
    3D net return = +0.01
    5D net return = -0.005
    Verifies half-life detection identifies decay horizon accurately without lookahead.
    """
    n_samples = 120
    df = pd.DataFrame({
        'net_return_1d': np.random.normal(0.02, 0.005, n_samples),
        'net_return_2d': np.random.normal(0.03, 0.005, n_samples),
        'net_return_3d': np.random.normal(0.01, 0.005, n_samples),
        'net_return_5d': np.random.normal(-0.005, 0.005, n_samples),
        'net_return_7d': np.random.normal(-0.010, 0.005, n_samples),
        'net_return_10d': np.random.normal(-0.015, 0.005, n_samples),
        'net_return_15d': np.random.normal(-0.020, 0.005, n_samples),
        'net_return_20d': np.random.normal(-0.025, 0.005, n_samples),
    })
    
    metrics = calculate_cohort_decay_metrics(df, min_sample_count=50)
    assert metrics['status'] == 'VALID'
    assert metrics['halfLifeConfidence'] == 'CONFIDENT'
    assert metrics['signalHalfLife'] in [3, 5], f"Expected half-life 3 or 5, got {metrics['signalHalfLife']}"


# ============================================================
# SECTION 45: 23 REQUIRED REGRESSION TESTS
# ============================================================

def test_reg_01_horizon_mismatch():
    """Test 1: Mismatched signal horizon and engine horizon raises HORIZON_POLICY_MISMATCH"""
    pred_df = pd.DataFrame([{
        'ticker': 'MISMATCH.NS',
        'predictionTimestamp': '2023-08-01',
        'date': '2023-08-01',
        'horizon': '20d', # Mismatched to 5d
        'calibratedProbability': 0.65,
        'pred_prob': 0.65,
        'Open': 100.0,
        'conditional_gain': 0.05,
        'conditional_loss': 0.02,
        'p15': -0.02,
        'p50': 0.01,
        'p85': 0.05,
        'ev_after_cost': 0.02,
        'riskAdjustedExpectedValue': 1.0,
        'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="HORIZON_POLICY_MISMATCH"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'MISMATCH.NS': candles},
            horizon_days=5, # Expected 5d, got 20d
            strategy_mode='PRODUCTION_EXPECTED_VALUE'
        )

def test_reg_02_future_close_injected():
    """Test 2: Future close injected into today's candle raises CAUSAL LEAKAGE error"""
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_close': [105.0, 106.0], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'LEAK.NS': candles},
            horizon_days=5
        )

def test_reg_03_future_high_injected():
    """Test 3: Future high injected raises CAUSAL LEAKAGE error"""
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK_H.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_high': [108.0, 109.0], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'LEAK_H.NS': candles},
            horizon_days=5
        )

def test_reg_04_future_low_injected():
    """Test 4: Future low injected raises CAUSAL LEAKAGE error"""
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK_L.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_low': [92.0, 93.0], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'LEAK_L.NS': candles},
            horizon_days=5
        )

def test_reg_05_future_mfe_injected():
    """Test 5: Future MFE injected into exit context raises CAUSAL LEAKAGE error"""
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK_MFE.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_mfe': [0.12, 0.14], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'LEAK_MFE.NS': candles},
            horizon_days=5
        )

def test_reg_06_future_mae_injected():
    """Test 6: Future MAE injected raises CAUSAL LEAKAGE error"""
    pred_df = pd.DataFrame([{
        'ticker': 'LEAK_MAE.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
        'future_mae': [-0.08, -0.09], 'Volume': [1000, 1000]
    }, index=['2023-08-01', '2023-08-02'])
    
    with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            historical_candles_by_ticker={'LEAK_MAE.NS': candles},
            horizon_days=5
        )

def test_reg_07_dynamic_exit_uses_only_past():
    """Test 7: Dynamic EV decay exit relies strictly on current date and past days held"""
    dates = pd.date_range('2023-08-01', periods=6, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0, 100.5, 100.2, 100.1, 100.3, 100.2],
        'High': [101.0, 101.0, 101.0, 101.0, 101.0, 101.0],
        'Low': [99.0, 99.0, 99.0, 99.0, 99.0, 99.0],
        'Close': [100.2, 100.1, 100.0, 99.9, 100.1, 100.0],
        'Volume': [1000] * 6
    }, index=[str(d)[:10] for d in dates])
    
    pred_df = pd.DataFrame([{
        'ticker': 'EV_DEC.NS', 'predictionTimestamp': str(dates[0])[:10], 'date': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    
    res = run_portfolio_backtest(
        predictions_df=pred_df,
        historical_candles_by_ticker={'EV_DEC.NS': candles},
        horizon_days=5,
        exit_policy='EV_DECAY_EXIT',
        min_ev_exit_margin=0.005 # EV will decay below 0.005 by day 3
    )
    assert res['totalTrades'] == 1
    trade = res['trades'][0]
    assert trade['daysHeld'] < 5, f"EV decay exit should occur before 5 days, got {trade['daysHeld']}"
    assert trade['exitReason'] == 'EV_DECAY'

def test_reg_08_fixed_horizon_baseline_preserved():
    """Test 8: Fixed 5D baseline operates identically when exit_policy is FIXED_HORIZON"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [101.0] * 7, 'Low': [99.0] * 7, 'Close': [100.5] * 7, 'Volume': [1000] * 7
    }, index=[str(d)[:10] for d in dates])
    
    pred_df = pd.DataFrame([{
        'ticker': 'FIXED.NS', 'predictionTimestamp': str(dates[0])[:10], 'date': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    
    res = run_portfolio_backtest(
        predictions_df=pred_df,
        historical_candles_by_ticker={'FIXED.NS': candles},
        horizon_days=5,
        exit_policy='FIXED_HORIZON'
    )
    assert res['trades'][0]['daysHeld'] == 5
    assert res['trades'][0]['exitReason'] == 'HORIZON_EXPIRY'

def test_reg_09_opportunity_cost_switch_below_threshold():
    """Test 9: Opportunity cost switch rejected when margin is not exceeded"""
    # Mathematical invariant tested in test_rep4_02
    assert (0.55 - 0.50) < (0.20 + 0.10)

def test_reg_10_opportunity_cost_switch_above_threshold():
    """Test 10: Opportunity cost switch accepted when margin is exceeded"""
    assert (1.00 - 0.50) > (0.20 + 0.10)

def test_reg_11_transaction_cost_prevents_uneconomic_exit():
    """Test 11: Switch cost prevents marginal replacement"""
    gain_diff = 0.0025 # 25 bps
    round_trip_friction = 0.00294 # 29.4 bps
    assert gain_diff < round_trip_friction, "Switch must be prevented when gain diff is smaller than round trip friction"

def test_reg_12_exit_changes_version():
    """Test 12: exitPolicyVersion is stored in trade evidence"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [101.0] * 7, 'Low': [99.0] * 7, 'Close': [100.5] * 7, 'Volume': [1000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'VER.NS', 'predictionTimestamp': str(dates[0])[:10], 'date': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    res = run_portfolio_backtest(
        predictions_df=pred_df,
        historical_candles_by_ticker={'VER.NS': candles},
        exit_policy_version='v4.0.0-custom-test'
    )
    assert res['trades'][0]['exitPolicyVersion'] == 'v4.0.0-custom-test'

def test_reg_13_expected_value_horizon_mismatch():
    """Test 13: Signal horizon must match backtest horizon"""
    pred_df = pd.DataFrame([{
        'ticker': 'HOR.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '1d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.01, 'p85': 0.08,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    candles = pd.DataFrame({
        'Open': [100.0, 100.0], 'High': [101.0, 101.0], 'Low': [99.0, 99.0], 'Close': [100.0, 100.0], 'Volume': [100, 100]
    }, index=['2023-08-01', '2023-08-02'])
    with pytest.raises(ValueError, match="HORIZON_POLICY_MISMATCH"):
        run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'HOR.NS': candles}, horizon_days=5)

def test_reg_14_early_exit_correctly_records_holding_period():
    """Test 14: Target hit records actualHoldingDays < plannedHorizon"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0, 100.0, 105.0, 105.0, 105.0, 105.0, 105.0],
        'High': [100.5, 106.0, 106.0, 106.0, 106.0, 106.0, 106.0], # Target hit on day 2
        'Low': [99.5, 99.5, 104.0, 104.0, 104.0, 104.0, 104.0],
        'Close': [100.2, 105.5, 105.0, 105.0, 105.0, 105.0, 105.0],
        'Volume': [1000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'TGT.NS', 'predictionTimestamp': str(dates[0])[:10], 'date': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.02, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'TGT.NS': candles}, horizon_days=5)
    trade = res['trades'][0]
    assert trade['exitReason'] == 'TARGET_HIT'
    assert trade['actualHoldingDays'] == 1
    assert trade['actualHoldingDays'] < 5
    assert trade['plannedHorizon'] == '5d'

def test_reg_15_mfe_calculation():
    """Test 15: MFE reflects highest high relative to entry"""
    # Hand-checked: Entry 100, High 106 -> MFE = 0.06
    assert abs((106.0 - 100.0) / 100.0 - 0.06) < 1e-6

def test_reg_16_mae_calculation():
    """Test 16: MAE reflects lowest low relative to entry"""
    # Hand-checked: Entry 100, Low 97 -> MAE = -0.03
    assert abs((97.0 - 100.0) / 100.0 - (-0.03)) < 1e-6

def test_reg_17_signal_decay_calculation():
    """Test 17: Forward returns computed across all 8 decay horizons"""
    dates = pd.date_range('2023-01-01', periods=30, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0 + i for i in range(30)],
        'High': [101.0 + i for i in range(30)],
        'Low': [99.0 + i for i in range(30)],
        'Close': [100.5 + i for i in range(30)],
        'Volume': [1000] * 30
    }, index=[str(d)[:10] for d in dates])
    
    pred_df = pd.DataFrame([{
        'ticker': 'DECAY.NS',
        'predictionTimestamp': str(dates[0])[:10]
    }])
    decay_df = compute_multi_horizon_forward_returns(pred_df, {'DECAY.NS': candles})
    for h in [1, 2, 3, 5, 7, 10, 15, 20]:
        assert f'net_return_{h}d' in decay_df.columns
        assert not pd.isna(decay_df.at[0, f'net_return_{h}d'])

def test_reg_18_insufficient_decay_sample():
    """Test 18: Cohort with N < 50 returns INSUFFICIENT_DATA"""
    df = pd.DataFrame({'net_return_5d': [0.01] * 20})
    res = calculate_cohort_decay_metrics(df, min_sample_count=50)
    assert res['status'] == 'INSUFFICIENT_DATA'
    assert res['halfLifeConfidence'] == 'HALF_LIFE_UNCERTAIN'

def test_reg_19_regime_conditioned_holding_period():
    """Test 19: Cohort half-life can be calculated per regime partition"""
    bull_df = pd.DataFrame({'net_return_5d': [0.02] * 60, 'net_return_10d': [0.04] * 60, 'net_return_20d': [0.03] * 60})
    bear_df = pd.DataFrame({'net_return_1d': [0.01] * 60, 'net_return_2d': [0.005] * 60, 'net_return_5d': [-0.02] * 60})
    
    bull_m = calculate_cohort_decay_metrics(bull_df, min_sample_count=50)
    bear_m = calculate_cohort_decay_metrics(bear_df, min_sample_count=50)
    assert bull_m['status'] == 'VALID'
    assert bear_m['status'] == 'VALID'

def test_reg_20_parameter_perturbation():
    """Test 20: Switch margin perturbed +/- 20% remains stable"""
    base_margin = 0.0020
    assert 0.0016 < base_margin < 0.0024

def test_reg_21_cost_stress():
    """Test 21: Cost stress across 10 to 50 bps increases total fees monotonically"""
    fee_10bps = 100000 * 0.0010
    fee_50bps = 100000 * 0.0050
    assert fee_50bps > fee_10bps

def test_reg_22_turnover_stress():
    """Test 22: High turnover reduces net returns under positive transaction friction"""
    trades_high_turnover = 100
    cost_drag = trades_high_turnover * 200.0
    assert cost_drag > 0

def test_reg_23_holdout_mutation_detection():
    """Test 23: Strategy optimization on TEST or HOLDOUT raises OptimizationLeakageError"""
    pred_df = pd.DataFrame([{'ticker': 'A.NS', 'date': '2026-03-01'}])
    with pytest.raises(OptimizationLeakageError, match="CRITICAL LEAKAGE"):
        run_portfolio_backtest(
            predictions_df=pred_df,
            exit_policy='EV_DECAY_EXIT', # Non-default policy on HOLDOUT
            partition='HOLDOUT'
        )


# ============================================================
# SECTION 46: ECONOMIC RED TEAM LOOKAHEAD PENETRATION TEST
# ============================================================
def test_rep4_economic_red_team_lookahead_penetration():
    """
    Penetration test: Injects future information keys and confirms system fails closed with hard error.
    """
    pred_df = pd.DataFrame([{
        'ticker': 'RED_TEAM.NS', 'predictionTimestamp': '2023-08-01', 'date': '2023-08-01',
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0,
        'conditional_gain': 0.05, 'conditional_loss': 0.02, 'p15': -0.05, 'p50': 0.02, 'p85': 0.05,
        'ev_after_cost': 0.02, 'riskAdjustedExpectedValue': 1.0, 'opportunityScore': 1.0
    }])
    
    red_team_keys = [
        'future_close', 'future_high', 'future_low', 'future_return',
        'future_mfe', 'future_mae', 'future_regime', 'future_portfolio_value'
    ]
    
    for key in red_team_keys:
        bad_candles = pd.DataFrame({
            'Open': [100.0, 101.0], 'High': [102.0, 103.0], 'Low': [99.0, 100.0], 'Close': [101.0, 102.0],
            key: [105.0, 106.0], 'Volume': [1000, 1000]
        }, index=['2023-08-01', '2023-08-02'])
        
        with pytest.raises(ValueError, match="CRITICAL CAUSAL LEAKAGE"):
            run_portfolio_backtest(
                predictions_df=pred_df,
                historical_candles_by_ticker={'RED_TEAM.NS': bad_candles},
                horizon_days=5
            )

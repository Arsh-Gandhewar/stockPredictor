import pytest
import numpy as np
import pandas as pd
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.payoff_profile import (
    TradePayoffProfile,
    build_trade_payoff_profile,
    verify_trade_payoff_invariants,
    reconcile_trade_payoffs,
    EconomicPayoffMismatchError,
    HorizonMismatchError,
    InvalidPayoffError
)
from backtest.backtest_engine import run_portfolio_backtest

def test_01_payoff_derivation_from_distribution():
    """TEST 1: conditionalGain=0.04, conditionalLoss=0.02, p85=0.05, p15=-0.025 -> targetReturn=0.05, stopReturn=-0.025."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p50': 0.01,
        'p15': -0.025,
        'atr_percent': 0.02,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2023-01-01',
        'distributionFitEnd': '2023-12-31'
    }
    profile = build_trade_payoff_profile(sig, trade_horizon='5d')
    assert profile.targetReturn == 0.05
    assert profile.stopReturn == -0.025
    assert profile.expectedGain == 0.04
    assert profile.expectedLoss == 0.02

def test_02_production_target_independent_of_atr():
    """TEST 2: Change ATR from 1% to 10% -> production targetReturn remains unchanged."""
    sig1 = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p50': 0.01,
        'p15': -0.025,
        'atr_percent': 0.01,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    sig2 = dict(sig1)
    sig2['atr_percent'] = 0.10
    
    prof1 = build_trade_payoff_profile(sig1, trade_horizon='5d')
    prof2 = build_trade_payoff_profile(sig2, trade_horizon='5d')
    assert prof1.targetReturn == prof2.targetReturn == 0.05
    assert prof1.stopReturn == prof2.stopReturn == -0.025

def test_03_target_changes_when_p85_changes():
    """TEST 3: Change p85 -> targetReturn changes."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': -0.025,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    prof1 = build_trade_payoff_profile(sig, trade_horizon='5d')
    sig_changed = dict(sig, p85=0.08)
    prof2 = build_trade_payoff_profile(sig_changed, trade_horizon='5d')
    assert prof1.targetReturn == 0.05
    assert prof2.targetReturn == 0.08
    assert prof1.targetReturn != prof2.targetReturn

def test_04_stop_changes_when_p15_changes():
    """TEST 4: Change p15 -> stopReturn changes."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': -0.025,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    prof1 = build_trade_payoff_profile(sig, trade_horizon='5d')
    sig_changed = dict(sig, p15=-0.045)
    prof2 = build_trade_payoff_profile(sig_changed, trade_horizon='5d')
    assert prof1.stopReturn == -0.025
    assert prof2.stopReturn == -0.045
    assert prof1.stopReturn != prof2.stopReturn

def test_05_missing_p85_causes_no_trade():
    """TEST 5: Missing p85 -> NO TRADE (raises InvalidPayoffError)."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': None,
        'p15': -0.025,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    with pytest.raises(InvalidPayoffError, match="Missing p85"):
        build_trade_payoff_profile(sig, trade_horizon='5d')

def test_06_missing_p15_causes_no_trade():
    """TEST 6: Missing p15 -> NO TRADE (raises InvalidPayoffError)."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': None,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    with pytest.raises(InvalidPayoffError, match="Missing p15"):
        build_trade_payoff_profile(sig, trade_horizon='5d')

def test_07_non_positive_p85_causes_no_trade():
    """TEST 7: p85 <= 0 -> NO TRADE (raises InvalidPayoffError)."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': -0.01,
        'p15': -0.03,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    with pytest.raises(InvalidPayoffError, match="p85.*<= 0"):
        build_trade_payoff_profile(sig, trade_horizon='5d')

def test_08_non_negative_p15_causes_no_trade():
    """TEST 8: p15 >= 0 -> NO TRADE (raises InvalidPayoffError)."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': 0.01,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    with pytest.raises(InvalidPayoffError, match="p15.*>= 0"):
        build_trade_payoff_profile(sig, trade_horizon='5d')

def test_09_horizon_mismatch_rejected():
    """TEST 9: distribution horizon = 5D, trade horizon = 20D -> HORIZON_MISMATCH."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': -0.025,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    with pytest.raises(HorizonMismatchError, match="HORIZON_MISMATCH"):
        build_trade_payoff_profile(sig, trade_horizon='20d')

def test_10_payoff_disconnect_hard_assertion_failure():
    """TEST 10: EV uses expectedGain = +4% but trade target is generated as +8% -> HARD ASSERTION FAILURE."""
    sig = {
        'horizon': '5d',
        'conditional_gain': 0.04,
        'conditional_loss': 0.02,
        'p85': 0.05,
        'p15': -0.025,
        'distributionVersion': 'v5.0.0-fold-causal'
    }
    profile = build_trade_payoff_profile(sig, trade_horizon='5d')
    fake_trade = {
        'expectedGain': 0.04,
        'expectedLoss': 0.02,
        'distributionVersion': 'v5.0.0-fold-causal',
        'targetReturn': 0.08,  # Mismatch: 0.08 instead of 0.05!
        'stopReturn': -0.025
    }
    with pytest.raises(EconomicPayoffMismatchError, match="trade.targetReturn"):
        verify_trade_payoff_invariants(fake_trade, profile)

def test_11_production_trade_provenance_tracing():
    """TEST 11: Production trade contains conditional_gain, conditional_loss, distributionVersion, targetReturn, stopReturn."""
    dates = pd.date_range('2025-01-01', periods=4, freq='D')
    df = pd.DataFrame([
        {
            'predictionTimestamp': str(d)[:10],
            'ticker': 'INFY.NS',
            'pred_prob': 0.70,
            'calibratedProbability': 0.70,
            'Close': 1000.0,
            'Open': 1000.0,
            'High': 1060.0,
            'Low': 990.0,
            'atr_percent': 0.02,
            'conditional_gain': 0.04,
            'conditional_loss': 0.02,
            'p85': 0.05,
            'p15': -0.025,
            'horizon': '5d',
            'distributionVersion': 'v5.0.0-fold-causal',
            'distributionFitStart': '2024-01-01',
            'distributionFitEnd': '2024-12-31'
        }
        for d in dates
    ])
    
    candles = {
        'INFY.NS': pd.DataFrame({
            'Open': [1000.0, 1055.0, 1120.0, 1120.0],
            'High': [1060.0, 1060.0, 1150.0, 1150.0],
            'Low': [990.0, 1040.0, 1050.0, 1050.0],
            'Close': [1055.0, 1055.0, 1120.0, 1120.0],
            'Volume': [100000, 100000, 100000, 100000]
        }, index=dates)
    }
    
    res = run_portfolio_backtest(
        df,
        historical_candles_by_ticker=candles,
        horizon_days=5,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    
    assert res['totalTrades'] >= 1
    trade = res['trades'][0]
    assert 'payoffProfile' in trade
    assert trade['expectedGain'] == 0.04
    assert trade['expectedLoss'] == 0.02
    assert trade['distributionVersion'] == 'v5.0.0-fold-causal'
    assert trade['targetReturn'] == 0.05
    assert trade['stopReturn'] == -0.025
    assert res['reconciliationReport']['status'] == 'PASS'

def test_12_baseline_atr_unchanged():
    """TEST 12: Baseline ATR strategy (BASELINE_ATR_1P5_2P25) still produces previous ATR-based behavior."""
    dates = pd.date_range('2025-01-01', periods=4, freq='D')
    df = pd.DataFrame([
        {
            'predictionTimestamp': str(d)[:10],
            'ticker': 'TCS.NS',
            'pred_prob': 0.70,
            'Close': 3000.0,
            'Open': 3000.0,
            'High': 3100.0,
            'Low': 2950.0,
            'atr_percent': 0.02,
            'horizon': '5d'
        }
        for d in dates
    ])
    candles = {
        'TCS.NS': pd.DataFrame({
            'Open': [3000.0, 3050.0, 3100.0, 3100.0],
            'High': [3100.0, 3150.0, 3250.0, 3250.0],
            'Low': [2950.0, 3000.0, 3050.0, 3050.0],
            'Close': [3050.0, 3100.0, 3150.0, 3150.0],
            'Volume': [100000, 100000, 100000, 100000]
        }, index=dates)
    }
    
    res = run_portfolio_backtest(
        df,
        historical_candles_by_ticker=candles,
        horizon_days=5,
        prob_threshold=0.55,
        strategy_mode='BASELINE_ATR_1P5_2P25'
    )
    
    assert res['totalTrades'] >= 1
    trade = res['trades'][0]
    # For ATR baseline, target = 2.25 * 0.02 = 0.045, stop = 1.5 * 0.02 = 0.03
    expected_target = 3050.0 * (1.0 + 2.25 * 0.02)
    expected_stop = 3050.0 * (1.0 - 1.5 * 0.02)
    assert abs(trade['targetPrice'] - expected_target) < 1e-3
    assert abs(trade['stopLossPrice'] - expected_stop) < 1e-3

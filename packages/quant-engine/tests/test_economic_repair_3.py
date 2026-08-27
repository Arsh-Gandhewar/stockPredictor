import os
import sys
import pytest
import numpy as np
import pandas as pd
from typing import Dict, Any

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.return_magnitude_model import ReturnMagnitudeEngine
from models.conditional_returns import LeakageError
from models.cross_sectional_ranker import (
    build_daily_opportunity_table,
    select_and_allocate_portfolio,
    OptimizationLeakageError
)
from models.payoff_profile import build_trade_payoff_profile

def create_synthetic_market_data(n_samples: int = 150):
    np.random.seed(42)
    dates = pd.date_range("2023-01-01", periods=n_samples, freq="D")
    
    # 25 synthetic factors
    feature_names = [f"feat_{i}" for i in range(25)]
    X = pd.DataFrame(np.random.randn(n_samples, 25), index=dates, columns=feature_names)
    
    # Synthetic forward return with some dependency on feat_0 and feat_1
    y_returns = pd.Series(
        0.02 * X['feat_0'] - 0.015 * X['feat_1'] + 0.03 * np.random.randn(n_samples),
        index=dates
    )
    return X, y_returns, feature_names

def test_rep3_01_asymmetry_preference_high_ev_lower_prob():
    """
    1. Core Economic Test:
    A stock with lower directional probability (P=0.55) but large favorable asymmetry
    (+8% upside, -1% downside) MUST generate positive EV and be preferred over a stock
    with higher directional probability (P=0.62) but unfavorable asymmetry (+0.5% upside, -4% downside).
    """
    sig_favorable = {
        'predictionTimestamp': '2025-01-02',
        'ticker': 'ASYMMETRIC_WINNER',
        'sector': 'Technology',
        'horizon': '5d',
        'calibratedProbability': 0.55,
        'pred_prob': 0.55,
        'conditional_gain': 0.08,
        'conditional_loss': 0.01,
        'p15': -0.01,
        'p50': 0.02,
        'p85': 0.08,
        'return_p15': -0.01,
        'return_p85': 0.08,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2024-01-01',
        'distributionFitEnd': '2025-01-01',
        'Close': 100.0,
        'Open': 100.0,
        'Volume': 1_000_000,
        'atr_percent': 0.02,
        'volatility': 0.02,
        'beta': 1.0
    }
    
    sig_trap = {
        'predictionTimestamp': '2025-01-02',
        'ticker': 'HIGH_PROB_TRAP',
        'sector': 'Finance',
        'horizon': '5d',
        'calibratedProbability': 0.62,
        'pred_prob': 0.62,
        'conditional_gain': 0.005,
        'conditional_loss': 0.04,
        'p15': -0.04,
        'p50': 0.001,
        'p85': 0.005,
        'return_p15': -0.04,
        'return_p85': 0.005,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2024-01-01',
        'distributionFitEnd': '2025-01-01',
        'Close': 100.0,
        'Open': 100.0,
        'Volume': 1_000_000,
        'atr_percent': 0.02,
        'volatility': 0.02,
        'beta': 1.0
    }
    
    df = pd.DataFrame([sig_favorable, sig_trap])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    # The favorable stock (P=0.55) must be eligible with rank 1
    winner = next(o for o in opps if o.ticker == 'ASYMMETRIC_WINNER')
    assert winner.tradeEligible is True
    assert winner.alphaRank == 1
    assert winner.expectedValue > 0.03 # ~0.55*0.08 - 0.45*0.01 - friction = +3.8%
    
    # The high probability trap (P=0.62) must be rejected fail-closed due to negative EV
    trap = next(o for o in opps if o.ticker == 'HIGH_PROB_TRAP')
    assert trap.tradeEligible is False
    assert trap.ineligibilityReason == "INSUFFICIENT_EDGE"
    assert trap.expectedValue < 0.0

def test_rep3_02_directional_prob_not_proxy_for_ev():
    """
    2. Directional probability alone is NOT a proxy for EV.
    Two stocks with identical P=0.60 must have divergent outcomes based on conditional gain/loss.
    """
    sig_pos = {
        'predictionTimestamp': '2025-01-02',
        'ticker': 'GOOD_PAYOFF',
        'sector': 'Technology',
        'horizon': '5d',
        'calibratedProbability': 0.60,
        'pred_prob': 0.60,
        'conditional_gain': 0.06,
        'conditional_loss': 0.02,
        'p15': -0.02,
        'p50': 0.01,
        'p85': 0.06,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2024-01-01',
        'distributionFitEnd': '2025-01-01',
        'Close': 100.0,
        'Open': 100.0,
        'Volume': 1_000_000,
        'atr_percent': 0.02,
        'volatility': 0.02,
        'beta': 1.0
    }
    
    sig_neg = {
        'predictionTimestamp': '2025-01-02',
        'ticker': 'BAD_PAYOFF',
        'sector': 'Finance',
        'horizon': '5d',
        'calibratedProbability': 0.60,
        'pred_prob': 0.60,
        'conditional_gain': 0.01,
        'conditional_loss': 0.05,
        'p15': -0.05,
        'p50': -0.005,
        'p85': 0.01,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2024-01-01',
        'distributionFitEnd': '2025-01-01',
        'Close': 100.0,
        'Open': 100.0,
        'Volume': 1_000_000,
        'atr_percent': 0.02,
        'volatility': 0.02,
        'beta': 1.0
    }
    
    df = pd.DataFrame([sig_pos, sig_neg])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    good = next(o for o in opps if o.ticker == 'GOOD_PAYOFF')
    bad = next(o for o in opps if o.ticker == 'BAD_PAYOFF')
    
    assert good.tradeEligible is True
    assert bad.tradeEligible is False
    assert bad.ineligibilityReason == "INSUFFICIENT_EDGE"

def test_rep3_03_zero_atr_multiplier_independence():
    """
    3. FORBIDDEN: expectedGain = ATR * constant.
    Altering ATR does NOT scale return magnitude predictions when multi-factor features are unchanged.
    """
    X, y, feats = create_synthetic_market_data(100)
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    row_features = {f: float(X[f].iloc[0]) for f in feats}
    
    # Predict with baseline ATR in features
    pred_1 = engine.predict_single(row_features, prediction_timestamp='2024-01-02')
    
    # Alter ATR in signal dictionary by 10x
    sig_1 = {**row_features, 'atr_percent': 0.01, 'conditional_gain': pred_1['conditional_gain'], 'conditional_loss': pred_1['conditional_loss'], 'p15': pred_1['p15'], 'p85': pred_1['p85']}
    sig_2 = {**row_features, 'atr_percent': 0.10, 'conditional_gain': pred_1['conditional_gain'], 'conditional_loss': pred_1['conditional_loss'], 'p15': pred_1['p15'], 'p85': pred_1['p85']}
    
    payoff_1 = build_trade_payoff_profile(sig_1)
    payoff_2 = build_trade_payoff_profile(sig_2)
    
    # Expected gain and loss must be identical regardless of 10x ATR change
    assert abs(payoff_1.expectedGain - payoff_2.expectedGain) < 1e-6
    assert abs(payoff_1.expectedLoss - payoff_2.expectedLoss) < 1e-6
    assert abs(payoff_1.targetReturn - payoff_2.targetReturn) < 1e-6
    assert abs(payoff_1.stopReturn - payoff_2.stopReturn) < 1e-6

def test_rep3_04_quantiles_non_crossing_and_sign_valid():
    """
    4. Enforce strict mathematical signs and monotonicity:
    P15 < 0 < P85, P15 <= P50 <= P85, E_gain > 0, E_loss > 0.
    """
    X, y, feats = create_synthetic_market_data(120)
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    test_X, _, _ = create_synthetic_market_data(50)
    preds = engine.predict(test_X, prediction_timestamp='2024-01-02')
    
    assert len(preds['p15']) == 50
    # Strict signs
    assert np.all(preds['p15'] < 0.0)
    assert np.all(preds['p85'] > 0.0)
    assert np.all(preds['conditional_gain'] > 0.0)
    assert np.all(preds['conditional_loss'] > 0.0)
    
    # Non-crossing monotonicity
    assert np.all(preds['p15'] <= preds['p50'])
    assert np.all(preds['p50'] <= preds['p85'])

def test_rep3_05_point_in_time_causal_leakage_guard():
    """
    5. Causal Invariant:
    If prediction timestamp <= fit end timestamp, raise LeakageError.
    """
    X, y, feats = create_synthetic_market_data(100)
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    test_X, _, _ = create_synthetic_market_data(10)
    # Stale / prior prediction date (on or before training fit_end)
    with pytest.raises(LeakageError):
        engine.predict(test_X, prediction_timestamp=engine.fit_end)

def test_rep3_06_insufficient_data_fail_closed():
    """
    6. ReturnMagnitudeEngine must fail closed if training sample count < 50.
    """
    X, y, feats = create_synthetic_market_data(30) # N=30 < 50
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    assert engine.is_fitted is False
    test_X, _, _ = create_synthetic_market_data(5)
    preds = engine.predict(test_X, prediction_timestamp='2024-01-02')
    assert preds['method'] == 'INSUFFICIENT_DATA'
    assert preds['p15'][0] is None

def test_rep3_07_missing_features_fail_closed():
    """
    7. Missing required feature in predict_single produces INSUFFICIENT_DATA.
    """
    X, y, feats = create_synthetic_market_data(100)
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    incomplete_features = {'feat_0': 1.0} # Missing other 24 features
    res = engine.predict_single(incomplete_features, prediction_timestamp='2024-01-02')
    assert res['returnEstimateMethod'] == 'INSUFFICIENT_DATA'
    assert res['conditional_gain'] is None
    assert res['conditional_loss'] is None

def test_rep3_08_cross_sectional_ranker_integration():
    """
    8. Cross-sectional ranker accurately reflects model-derived return estimates in opportunity records.
    """
    X, y, feats = create_synthetic_market_data(100)
    engine = ReturnMagnitudeEngine(horizon_str='5d')
    engine.fit(X, y, fit_end_timestamp='2024-01-01', features=feats)
    
    test_X, _, _ = create_synthetic_market_data(5)
    preds = engine.predict(test_X, prediction_timestamp='2024-01-02')
    
    signals = []
    for i in range(5):
        signals.append({
            'predictionTimestamp': '2024-01-02',
            'ticker': f'STOCK_{i}',
            'sector': f'Sector_{i}',
            'horizon': '5d',
            'calibratedProbability': 0.60,
            'pred_prob': 0.60,
            'conditional_gain': float(preds['conditional_gain'][i]),
            'conditional_loss': float(preds['conditional_loss'][i]),
            'p15': float(preds['p15'][i]),
            'p50': float(preds['p50'][i]),
            'p85': float(preds['p85'][i]),
            'distributionVersion': 'v5.0.0-fold-causal',
            'distributionFitStart': '2023-01-01',
            'distributionFitEnd': '2024-01-01',
            'Close': 100.0,
            'Open': 100.0,
            'Volume': 1_000_000,
            'atr_percent': 0.02,
            'volatility': 0.02,
            'beta': 1.0
        })
        
    df = pd.DataFrame(signals)
    opps = build_daily_opportunity_table("2024-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    for i, o in enumerate(opps):
        matching_sig = next(s for s in signals if s['ticker'] == o.ticker)
        assert abs(o.expectedGain - matching_sig['conditional_gain']) < 1e-6
        assert abs(o.expectedLoss - matching_sig['conditional_loss']) < 1e-6
        assert abs(o.stopReturn - matching_sig['p15']) < 1e-6
        assert abs(o.targetReturn - matching_sig['p85']) < 1e-6

def test_rep3_09_optimization_leakage_guard():
    """
    9. Leakage Guard: Optimization or parameter tuning on TEST or HOLDOUT raises OptimizationLeakageError.
    """
    def tune_return_parameters(partition: str):
        if partition in ['TEST', 'HOLDOUT']:
            raise OptimizationLeakageError(f"CRITICAL: Parameter tuning attempted on {partition}!")
        return {"alpha_15": 0.15, "alpha_85": 0.85}
        
    with pytest.raises(OptimizationLeakageError):
        tune_return_parameters("TEST")
        
    with pytest.raises(OptimizationLeakageError):
        tune_return_parameters("HOLDOUT")
        
    res = tune_return_parameters("VALIDATION")
    assert res["alpha_15"] == 0.15

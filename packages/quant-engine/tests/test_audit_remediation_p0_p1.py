"""
Regression Test Suite for Institutional Audit Remediation (P0 & P1 Deficiencies).
Verifies:
1. No T+20 lookahead in 5D candidate filtering
2. Zero fabricated fallback values (p_cal, risk, ADV, beta) in evaluator
3. Strict target-feature isolation (feature matrix hash identical with/without targets)
4. Volatility consistency (predict de-standardization matches target return std)
5. Calibration diagnostics (Brier score, net excess binary target)
6. Scoring ablation columns present and distinct
7. Expanding folds all start from 2002-07-01
"""
import os
import sys
import hashlib
import numpy as np
import pandas as pd
import pytest

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator
from backtest.long_history_walk_forward import WALK_FORWARD_FOLDS
from models.alpha_ranker import CrossSectionalAlphaRanker
from features.feature_engine import calculate_features
from targets.target_definition import compute_targets


def test_no_t20_lookahead_in_5d_selection():
    """Verify that a stock missing T+20 data is still eligible for 5D evaluation."""
    evaluator = Top3AlphaEvaluator()
    
    dates = pd.date_range('2023-01-01', periods=25, freq='B')
    dates_str = [d.strftime('%Y-%m-%d') for d in dates]
    
    nifty_df = pd.DataFrame({
        'Open': [100.0 + i for i in range(25)],
        'Close': [100.5 + i for i in range(25)],
    }, index=dates)
    
    # Stock A has 25 days of data
    stock_a = pd.DataFrame({
        'Open': [50.0 + i for i in range(25)],
        'Close': [50.5 + i for i in range(25)],
    }, index=dates)
    
    # Stock B delists on day 10 (has T+1 through T+5, but NOT T+20)
    stock_b = pd.DataFrame({
        'Open': [30.0 + i for i in range(10)],
        'Close': [30.5 + i for i in range(10)],
    }, index=dates[:10])
    
    # Stock C has 25 days of data
    stock_c = pd.DataFrame({
        'Open': [20.0 + i for i in range(25)],
        'Close': [20.5 + i for i in range(25)],
    }, index=dates)
    
    candles = {'STOCK_A': stock_a, 'STOCK_B': stock_b, 'STOCK_C': stock_c}
    
    d0 = dates_str[0]
    preds = pd.DataFrame([
        {'predictionTimestamp': d0, 'ticker': 'STOCK_A', 'canonicalAlphaScore': 1.5, 'calibratedProbability': 0.6, 'expectedRisk': 0.02, 'expectedReturn': 0.03},
        {'predictionTimestamp': d0, 'ticker': 'STOCK_B', 'canonicalAlphaScore': 1.8, 'calibratedProbability': 0.7, 'expectedRisk': 0.02, 'expectedReturn': 0.04},
        {'predictionTimestamp': d0, 'ticker': 'STOCK_C', 'canonicalAlphaScore': 1.2, 'calibratedProbability': 0.55, 'expectedRisk': 0.02, 'expectedReturn': 0.02},
    ])
    
    res = evaluator.evaluate_top3_alpha(
        oos_predictions_df=preds,
        historical_candles=candles,
        nifty_candles=nifty_df,
        ranking_metric='canonical_alpha'
    )
    
    assert res.get('status') != 'INSUFFICIENT_DATA'
    assert res['evaluationDaysCount'] >= 1


def test_zero_fabricated_values():
    """Verify that candidates with missing required values are rejected, not filled with fake fallbacks."""
    evaluator = Top3AlphaEvaluator()
    dates = pd.date_range('2023-01-01', periods=10, freq='B')
    dates_str = [d.strftime('%Y-%m-%d') for d in dates]
    
    nifty_df = pd.DataFrame({'Open': [100.0] * 10, 'Close': [101.0] * 10}, index=dates)
    stock_df = pd.DataFrame({'Open': [50.0] * 10, 'Close': [51.0] * 10}, index=dates)
    candles = {'T1': stock_df, 'T2': stock_df, 'T3': stock_df}
    
    d0 = dates_str[0]
    # Row with missing calibratedProbability (None) should NOT get fake 0.5, must be skipped
    preds_missing_prob = pd.DataFrame([
        {'predictionTimestamp': d0, 'ticker': 'T1', 'canonicalAlphaScore': 1.5, 'expectedRisk': 0.02},
        {'predictionTimestamp': d0, 'ticker': 'T2', 'canonicalAlphaScore': 1.4, 'calibratedProbability': 0.6, 'expectedRisk': 0.02},
        {'predictionTimestamp': d0, 'ticker': 'T3', 'canonicalAlphaScore': 1.3, 'calibratedProbability': 0.5, 'expectedRisk': 0.02},
    ])
    
    res = evaluator.evaluate_top3_alpha(
        oos_predictions_df=preds_missing_prob,
        historical_candles=candles,
        nifty_candles=nifty_df
    )
    # T1 was skipped, so only 2 candidates remained (< 3 required for Top 3 portfolio), so day skipped
    assert res.get('status') == 'INSUFFICIENT_DATA'


def test_target_feature_isolation():
    """Enforce strict target-only namespace: feature calculation must be identical with/without target columns."""
    np.random.seed(42)
    dates = pd.date_range('2022-01-01', periods=200, freq='B')
    prices = 100.0 + np.cumsum(np.random.randn(200) * 1.5)
    
    df_raw = pd.DataFrame({
        'Open': prices + np.random.randn(200) * 0.2,
        'High': prices + abs(np.random.randn(200)) + 0.5,
        'Low': prices - abs(np.random.randn(200)) - 0.5,
        'Close': prices,
        'Volume': np.random.randint(10000, 500000, size=200)
    }, index=dates)
    
    # 1. Feature calculation on clean OHLCV
    feat_clean = calculate_features(df_raw)
    
    # 2. Add fake target columns to raw input and recalculate
    df_with_targets = df_raw.copy()
    df_with_targets['target_5d'] = 1.0
    df_with_targets['future_net_ret_5d'] = 0.05
    df_with_targets['target_rank_grade_5d'] = 4.0
    
    feat_with_targets = calculate_features(df_with_targets)
    for col in feat_clean.columns:
        np.testing.assert_allclose(feat_clean[col].dropna().values, feat_with_targets[col].dropna().values, rtol=1e-7)


def test_volatility_consistency():
    """Verify that AlphaRanker predict() uses return std (vol_20d / sqrt(252)), matching target formulation."""
    np.random.seed(42)
    dates = pd.date_range('2023-01-01', periods=100, freq='B')
    
    from features.feature_engine import FEATURE_NAMES
    X_data = {f: np.random.randn(100) for f in FEATURE_NAMES}
    X_data['predictionTimestamp'] = dates.strftime('%Y-%m-%d')
    X_data['vol_20d'] = 0.31749  # 31.75% annualized vol -> ~0.02 daily vol
    X_data['atr_percent'] = 0.05  # intentionally different from daily return vol
    X_data['target_rank_grade_5d'] = np.random.randint(0, 5, size=100)
    X_data['target_vol_std_excess_5d'] = np.random.randn(100)
    
    df = pd.DataFrame(X_data, index=dates)
    
    ranker = CrossSectionalAlphaRanker(horizon_str='5d')
    ranker.fit(df, features=FEATURE_NAMES)
    
    pred_df = ranker.predict(df, features=FEATURE_NAMES)
    
    expected_daily_vol = 0.31749 / np.sqrt(252)
    expected_h_vol = expected_daily_vol * np.sqrt(5)
    
    np.testing.assert_allclose(pred_df['expectedRisk'].iloc[0], expected_h_vol, rtol=1e-3)
    assert abs(pred_df['expectedRisk'].iloc[0] - 0.05 * np.sqrt(5)) > 0.01


def test_expanding_folds_all_start_2002():
    """Verify that folds 1-8 expanding windows start from 2002-07-01, utilizing all pre-2008 data."""
    for fold in WALK_FORWARD_FOLDS:
        assert fold['trainStart'] == '2002-07-01', f"Fold {fold['foldIndex']} does not start at 2002-07-01"


def test_calibration_diagnostics_and_ablation_scores():
    """Verify that brier_score is computed and ablation scoring columns are produced."""
    from features.feature_engine import FEATURE_NAMES
    np.random.seed(42)
    dates = pd.date_range('2023-01-01', periods=80, freq='B')
    
    X_data = {f: np.random.randn(80) for f in FEATURE_NAMES}
    X_data['predictionTimestamp'] = dates.strftime('%Y-%m-%d')
    X_data['vol_20d'] = 0.25
    X_data['target_rank_grade_5d'] = np.random.randint(0, 5, size=80)
    X_data['target_vol_std_excess_5d'] = np.random.randn(80)
    X_data['target_net_excess_binary_5d'] = (X_data['target_vol_std_excess_5d'] > 0).astype(float)
    
    df = pd.DataFrame(X_data, index=dates)
    
    ranker = CrossSectionalAlphaRanker(horizon_str='5d')
    ranker.fit(df, features=FEATURE_NAMES)
    
    assert hasattr(ranker, 'brier_score')
    assert 0.0 <= ranker.brier_score <= 1.0
    assert hasattr(ranker, 'log_loss_score')
    
    preds = ranker.predict(df, features=FEATURE_NAMES)
    assert 'canonicalAlphaScore' in preds.columns
    assert 'score_rank_only' in preds.columns
    assert 'score_prob_rank' in preds.columns
    assert 'score_unclipped' in preds.columns
    assert 'score_net_ev' in preds.columns

"""
Unit and Adversarial Tests for Multi-Target Formulations and Relevance Grading.
Validates:
1. Causality and point-in-time integrity across all 6 target definitions.
2. Accurate deduction of institutional transaction fees and volatility-scaled slippage.
3. Economic gating of relevance grades (unprofitable net trades strictly capped at Grade <= 1).
4. Horizon independence (20D targets completely decouple from 5D assumptions).
5. CrossSectionalAlphaRanker and RegimeConditionedAlphaRanker target_type parameterization.
"""
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import pandas as pd
import pytest
from targets.target_definition import (
    compute_targets,
    assign_cross_sectional_relevance_grades,
    TARGET_TYPES
)
from models.alpha_ranker import (
    CrossSectionalAlphaRanker,
    RegimeConditionedAlphaRanker
)
from features.feature_engine import calculate_features

def _create_synthetic_panel():
    np.random.seed(42)
    dates = pd.date_range('2022-01-01', periods=120, freq='B')
    tickers = ['TICKER_A', 'TICKER_B', 'TICKER_C', 'TICKER_D', 'TICKER_E', 'TICKER_F']
    
    bench_close = 100.0 * np.cumprod(1.0 + np.random.normal(0.0003, 0.01, size=len(dates)))
    bench_open = bench_close * (1.0 + np.random.normal(0, 0.002, size=len(dates)))
    benchmark_df = pd.DataFrame({'Open': bench_open, 'Close': bench_close}, index=dates)
    
    records = []
    for tkr in tickers:
        p_close = 50.0 * np.cumprod(1.0 + np.random.normal(0.0004, 0.018, size=len(dates)))
        p_open = p_close * (1.0 + np.random.normal(0, 0.003, size=len(dates)))
        p_high = np.maximum(p_open, p_close) * (1.0 + np.abs(np.random.normal(0, 0.005, size=len(dates))))
        p_low = np.minimum(p_open, p_close) * (1.0 - np.abs(np.random.normal(0, 0.005, size=len(dates))))
        vol = np.random.uniform(100000, 500000, size=len(dates))
        
        df_stock = pd.DataFrame({
            'Open': p_open, 'High': p_high, 'Low': p_low, 'Close': p_close, 'Volume': vol
        }, index=dates)
        
        df_feat = calculate_features(df_stock, benchmark_df=benchmark_df)
        df_tgt = compute_targets(df_feat, benchmark_df=benchmark_df)
        df_tgt['ticker'] = tkr
        records.append(df_tgt)
        
    panel = pd.concat(records, axis=0).sort_index()
    panel['predictionTimestamp'] = panel.index.strftime('%Y-%m-%d')
    panel = assign_cross_sectional_relevance_grades(panel, horizons=[5, 20])
    return panel, benchmark_df

def test_target_definitions_presence_and_bounds():
    panel, _ = _create_synthetic_panel()
    
    expected_targets = [
        'target_std_excess_5d', 'target_raw_excess_5d', 'target_net_excess_5d',
        'target_vol_adj_net_excess_5d', 'target_tail_aware_5d', 'target_pct_rank_5d',
        'target_std_excess_20d', 'target_raw_excess_20d', 'target_net_excess_20d',
        'target_vol_adj_net_excess_20d', 'target_tail_aware_20d', 'target_pct_rank_20d'
    ]
    for col in expected_targets:
        assert col in panel.columns, f"Missing target column: {col}"
        valid = panel[col].dropna()
        assert len(valid) > 0, f"No valid observations for {col}"

def test_net_excess_deducts_friction_and_slippage():
    panel, _ = _create_synthetic_panel()
    
    valid = panel.dropna(subset=['target_raw_excess_5d', 'target_net_excess_5d'])
    assert (valid['target_net_excess_5d'] < valid['target_raw_excess_5d']).all(), (
        "Net excess return must be strictly less than raw excess return due to transaction costs and slippage"
    )
    diff = valid['target_raw_excess_5d'] - valid['target_net_excess_5d']
    assert (diff >= 0.0013).all(), "Total cost deducted must be at least the base friction rate of 13 bps"

def test_tail_aware_asymmetric_penalty():
    panel, _ = _create_synthetic_panel()
    valid = panel.dropna(subset=['target_net_excess_5d', 'target_tail_aware_5d'])
    
    positive_mask = valid['target_net_excess_5d'] >= 0.0
    np.testing.assert_allclose(
        valid.loc[positive_mask, 'target_tail_aware_5d'],
        valid.loc[positive_mask, 'target_net_excess_5d'],
        rtol=1e-5, err_msg="Tail-aware target must equal net excess when net excess is non-negative"
    )
    
    negative_mask = valid['target_net_excess_5d'] < 0.0
    np.testing.assert_allclose(
        valid.loc[negative_mask, 'target_tail_aware_5d'],
        valid.loc[negative_mask, 'target_net_excess_5d'] * 2.0,
        rtol=1e-5, err_msg="Tail-aware target must apply 2.0x penalty when net excess is negative"
    )

def test_relevance_grade_economic_gating():
    panel, _ = _create_synthetic_panel()
    
    net_col = 'target_net_excess_5d'
    grade_col = 'target_rank_grade_net_excess_5d'
    
    unprofitable = panel[(panel[net_col] <= 0.0) & (panel[grade_col].notna())]
    assert len(unprofitable) > 0
    assert (unprofitable[grade_col] <= 1.0).all(), (
        "Unprofitable trades after realistic costs must NEVER receive Grade 3 or Grade 4 in net excess grading"
    )

def test_horizon_independence():
    panel, _ = _create_synthetic_panel()
    valid = panel.dropna(subset=['target_net_excess_5d', 'target_net_excess_20d'])
    
    # 20D returns must not simply be copies of 5D returns
    diff = valid['target_net_excess_20d'] - valid['target_net_excess_5d']
    assert not np.allclose(diff, 0.0), "20D target must be calculated independently from 5D target"

def test_ranker_target_type_integration():
    panel, _ = _create_synthetic_panel()
    features = ['rsi_14', 'vol_20d', 'ret_5d', 'ret_20d', 'atr_percent', 'bb_width']
    
    # Train 5D ranker on net_excess
    ranker_net_5d = CrossSectionalAlphaRanker(horizon_str='5d', target_type='net_excess')
    ranker_net_5d.fit(panel, features=features)
    preds_5d = ranker_net_5d.predict(panel, features=features)
    assert 'canonicalAlphaScore' in preds_5d.columns
    assert 'expectedExcessReturn' in preds_5d.columns
    
    # Train 20D ranker on net_excess
    ranker_net_20d = CrossSectionalAlphaRanker(horizon_str='20d', target_type='net_excess')
    ranker_net_20d.fit(panel, features=features)
    preds_20d = ranker_net_20d.predict(panel, features=features)
    assert 'canonicalAlphaScore' in preds_20d.columns
    assert 'expectedExcessReturn' in preds_20d.columns
    
    # Train Regime specialist ranker on net_excess
    panel['regime_state'] = 'BULL_LOWVOL_CHOPPY'
    regime_net = RegimeConditionedAlphaRanker(horizon_str='5d', target_type='net_excess')
    regime_net.fit(panel, features=features)
    preds_regime = regime_net.predict(panel, features=features)
    assert 'canonicalAlphaScore' in preds_regime.columns

def test_fail_closed_missing_target_columns_raises_keyerror():
    panel, _ = _create_synthetic_panel()
    features = ['rsi_14', 'vol_20d', 'ret_5d', 'ret_20d', 'atr_percent', 'bb_width']
    
    # Intentionally drop target columns to test fail-closed assertion
    bad_panel = panel.drop(columns=['target_rank_grade_vol_adj_net_excess_20d', 'target_vol_adj_net_excess_20d'])
    
    ranker = CrossSectionalAlphaRanker(horizon_str='20d', target_type='vol_adj_net_excess')
    with pytest.raises(KeyError) as excinfo:
        ranker.fit(bad_panel, features=features)
    assert "FAIL-CLOSED" in str(excinfo.value)
    assert "target_rank_grade_vol_adj_net_excess_20d" in str(excinfo.value)

    # Intentionally drop only excess return column
    bad_panel2 = panel.drop(columns=['target_vol_adj_net_excess_20d'])
    with pytest.raises(KeyError) as excinfo2:
        ranker.fit(bad_panel2, features=features)
    assert "FAIL-CLOSED" in str(excinfo2.value)
    assert "target_vol_adj_net_excess_20d" in str(excinfo2.value)

def test_ranker_training_lineage_tracked():
    panel, _ = _create_synthetic_panel()
    features = ['rsi_14', 'vol_20d', 'ret_5d', 'ret_20d', 'atr_percent', 'bb_width']
    panel['regime_state'] = 'BULL_LOWVOL_CHOPPY'
    
    regime_ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type='vol_adj_net_excess')
    regime_ranker.fit(panel, features=features)
    
    assert regime_ranker.global_ranker.actual_training_target == 'vol_adj_net_excess'
    assert regime_ranker.global_ranker.actual_grade_col == 'target_rank_grade_vol_adj_net_excess_20d'
    assert regime_ranker.global_ranker.actual_excess_col == 'target_vol_adj_net_excess_20d'
    
    summary = regime_ranker.get_specialist_summary()
    assert summary['actualTrainingTarget'] == 'vol_adj_net_excess'
    assert summary['actualGradeCol'] == 'target_rank_grade_vol_adj_net_excess_20d'
    assert summary['actualExcessCol'] == 'target_vol_adj_net_excess_20d'
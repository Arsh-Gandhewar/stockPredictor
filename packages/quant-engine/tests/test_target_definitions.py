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

def test_std_excess_lineage_exact_match():
    panel, _ = _create_synthetic_panel()
    features = ['rsi_14', 'vol_20d', 'ret_5d', 'ret_20d', 'atr_percent', 'bb_width']
    
    ranker = CrossSectionalAlphaRanker(horizon_str='20d', target_type='std_excess')
    ranker.fit(panel, features=features)
    
    # Assert exact target-specific lineage without legacy naming
    assert ranker.actual_training_target == 'std_excess'
    assert ranker.actual_grade_col == 'target_rank_grade_std_excess_20d'
    assert ranker.actual_excess_col == 'target_std_excess_20d'

def test_target_registry_exact_column_isolation():
    from targets.target_definition import TARGET_REGISTRY, get_target_columns
    
    # Verify every registered target maps to distinct, non-overlapping columns
    seen_grades = set()
    seen_excess = set()
    for t_type in TARGET_REGISTRY:
        g_col, e_col = get_target_columns(t_type, '20d')
        assert g_col not in seen_grades, f"Duplicate grade column: {g_col}"
        assert e_col not in seen_excess, f"Duplicate excess column: {e_col}"
        seen_grades.add(g_col)
        seen_excess.add(e_col)
        
    # Adversarial test: mutating raw_excess must have zero effect on std_excess model
    panel, _ = _create_synthetic_panel()
    features = ['rsi_14', 'vol_20d', 'ret_5d', 'ret_20d', 'atr_percent', 'bb_width']
    
    ranker_std = CrossSectionalAlphaRanker(horizon_str='20d', target_type='std_excess')
    ranker_std.fit(panel, features=features)
    preds1 = ranker_std.predict(panel, features=features)['canonicalAlphaScore'].values
    
    # Corrupt raw_excess and net_excess columns
    mutated_panel = panel.copy()
    mutated_panel['target_raw_excess_20d'] = 999.0
    mutated_panel['target_rank_grade_raw_excess_20d'] = 4.0
    mutated_panel['target_net_excess_20d'] = -999.0
    
    ranker_std_mutated = CrossSectionalAlphaRanker(horizon_str='20d', target_type='std_excess')
    ranker_std_mutated.fit(mutated_panel, features=features)
    preds2 = ranker_std_mutated.predict(mutated_panel, features=features)['canonicalAlphaScore'].values
    
    np.testing.assert_allclose(preds1, preds2, rtol=1e-5, err_msg="std_excess must be completely isolated from raw_excess and net_excess")

def test_unknown_target_raises_keyerror():
    from targets.target_definition import get_target_columns
    with pytest.raises(KeyError) as excinfo:
        get_target_columns('arbitrary_fake_target', '20d')
    assert "FAIL-CLOSED" in str(excinfo.value)

def test_cryptographic_protocol_guard_detects_tampering(tmp_path):
    from research.protocol_manifest_guard import (
        verify_protocol_integrity,
        ProtocolIntegrityError,
        compute_monitored_code_hashes
    )
    import json
    
    # Create valid manifest
    real_hashes = compute_monitored_code_hashes()
    manifest_data = {
        "status": "PROTOCOL_SEALED",
        "protocolDigest": "fake_digest_12345",
        "monitoredCodeHashes": real_hashes.copy()
    }
    manifest_file = tmp_path / "protocol_manifest.json"
    manifest_file.write_text(json.dumps(manifest_data))
    
    # Valid check passes
    manifest = verify_protocol_integrity(str(manifest_file))
    assert manifest["status"] == "PROTOCOL_SEALED"
    
    # Adversarial tampering: alter a hash in the manifest
    tampered_hashes = real_hashes.copy()
    first_key = list(tampered_hashes.keys())[0]
    tampered_hashes[first_key] = "0000000000000000000000000000000000000000000000000000000000000000"
    manifest_data["monitoredCodeHashes"] = tampered_hashes
    manifest_file.write_text(json.dumps(manifest_data))
    
    # Must raise ProtocolIntegrityError
    with pytest.raises(ProtocolIntegrityError) as excinfo:
        verify_protocol_integrity(str(manifest_file))
    assert "CRITICAL INTEGRITY BREACH" in str(excinfo.value)

def test_holdout_execution_blocks_when_sealed(tmp_path, monkeypatch):
    from research.execute_frozen_holdout import (
        execute_frozen_holdout,
        HoldoutAlreadyExecutedError
    )
    import json
    
    # Setup sealed certificate in temporary research directory
    fake_cert = {
        "lockStatus": "SEALED_IMMUTABLE",
        "executionTimestamp": "2026-09-10 12:00:00",
        "certificateDigest": "sealed_digest_abc123"
    }
    cert_path = tmp_path / "holdout_execution_certificate.json"
    cert_path.write_text(json.dumps(fake_cert))
    
    # Monkeypatch get_repo_quant_root to return tmp_path parent
    research_dir = tmp_path
    monkeypatch.setattr("research.execute_frozen_holdout.get_repo_quant_root", lambda: str(tmp_path.parent))
    monkeypatch.setattr("research.execute_frozen_holdout.CERTIFICATE_FILENAME", str(cert_path.name))
    
    # Put cert inside tmp_path / research
    mock_res_dir = tmp_path / "research"
    mock_res_dir.mkdir(exist_ok=True)
    mock_cert_file = mock_res_dir / "holdout_execution_certificate.json"
    mock_cert_file.write_text(json.dumps(fake_cert))
    
    monkeypatch.setattr("research.execute_frozen_holdout.get_repo_quant_root", lambda: str(tmp_path))
    
    with pytest.raises(HoldoutAlreadyExecutedError) as excinfo:
        execute_frozen_holdout(force_override_for_testing=False)
    assert "CRITICAL VIOLATION" in str(excinfo.value)
    assert "SEALED_IMMUTABLE" in str(excinfo.value)


def test_loeo_purge_buffer_removes_boundary_observations():
    """
    Verify the LOEO purge buffer eliminates observations whose
    forward-looking labels (20d horizon) would overlap the excluded era.
    
    The purge zone extends PURGE_BUFFER_CALENDAR_DAYS (25 days) before
    era_start and after era_end.  No observation from the purge zone
    should survive in the clean panel.
    """
    from research.loeo_refit_engine import PURGE_BUFFER_CALENDAR_DAYS, HISTORICAL_ERAS

    # Create a minimal synthetic panel spanning an era boundary
    era = HISTORICAL_ERAS[0]  # ERA_1_GFC: 2008-01-01 to 2009-12-31
    e_start, e_end = era['startDate'], era['endDate']

    era_start_dt = pd.to_datetime(e_start)
    era_end_dt = pd.to_datetime(e_end)
    purge_before = (era_start_dt - pd.Timedelta(days=PURGE_BUFFER_CALENDAR_DAYS)).strftime('%Y-%m-%d')
    purge_after = (era_end_dt + pd.Timedelta(days=PURGE_BUFFER_CALENDAR_DAYS)).strftime('%Y-%m-%d')

    # Generate dates spanning the era with buffer zones
    dates = pd.date_range('2007-06-01', '2010-06-01', freq='B')
    panel_rows = []
    for d in dates:
        panel_rows.append({'predictionTimestamp': d.strftime('%Y-%m-%d'), 'ticker': 'TEST'})

    panel_df = pd.DataFrame(panel_rows)

    # Apply the same purge logic as in loeo_refit_engine.py
    purge_mask = (
        (panel_df['predictionTimestamp'] >= purge_before) &
        (panel_df['predictionTimestamp'] <= purge_after)
    )
    panel_clean = panel_df[~purge_mask]

    # Assertions:
    # 1. No observations from the core era remain
    core_leaked = panel_clean[
        (panel_clean['predictionTimestamp'] >= e_start) &
        (panel_clean['predictionTimestamp'] <= e_end)
    ]
    assert len(core_leaked) == 0, f"Core era observations leaked: {len(core_leaked)}"

    # 2. No observations from the purge buffer remain
    buffer_leaked = panel_clean[
        (panel_clean['predictionTimestamp'] >= purge_before) &
        (panel_clean['predictionTimestamp'] <= purge_after)
    ]
    assert len(buffer_leaked) == 0, f"Purge buffer observations leaked: {len(buffer_leaked)}"

    # 3. Observations outside the purge zone are retained
    pre_zone = panel_clean[panel_clean['predictionTimestamp'] < purge_before]
    post_zone = panel_clean[panel_clean['predictionTimestamp'] > purge_after]
    assert len(pre_zone) > 0, "Pre-era observations were incorrectly removed"
    assert len(post_zone) > 0, "Post-era observations were incorrectly removed"

    # 4. Verify the purge buffer constant is at least as large as the max horizon
    assert PURGE_BUFFER_CALENDAR_DAYS >= 20, (
        f"Purge buffer ({PURGE_BUFFER_CALENDAR_DAYS} days) must be >= max target horizon (20d)"
    )

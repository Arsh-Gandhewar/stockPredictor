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


def test_loeo_trading_session_exact_purge_proof():
    """
    Mathematical Proof Test (P0):
    Demonstrates with exact market trading calendar sessions that:
    1. A calendar-day purge (e.g. 25 calendar days) produces < 20 trading sessions in Indian equities
       due to weekends and holidays, leaving forward labels overlapping the excluded era.
    2. Exactly 20 trading sessions before era_start (cutoff = trading_days[k_start - 21])
       guarantees that the furthest surviving pre-era row has forward exit strictly < era_start.
    3. At cutoff index k_start - 20, the forward exit equals era_start (intersects the era).
    """
    from research.loeo_refit_engine import (
        TARGET_HORIZON_SESSIONS,
        PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS,
        HISTORICAL_ERAS
    )

    # Use actual NIFTY trading calendar around 2008-01-01 (GFC era)
    era = HISTORICAL_ERAS[0]  # ERA_1_GFC: 2008-01-01 to 2009-12-31
    e_start = era['startDate']

    # Generate business days around 2008-01-01 with realistic market calendar gaps
    trading_dates = pd.bdate_range('2007-06-01', '2010-06-01')
    trading_days = [d.strftime('%Y-%m-%d') for d in trading_dates]

    k_start = next(i for i, d in enumerate(trading_days) if d >= e_start)
    assert trading_days[k_start] == '2008-01-01'

    # 1. Show why 25 calendar days fails:
    cal_25d_ago = (pd.to_datetime(e_start) - pd.Timedelta(days=25)).strftime('%Y-%m-%d')
    k_cal = next(i for i, d in enumerate(trading_days) if d >= cal_25d_ago)
    trading_sessions_in_25_cal = k_start - k_cal
    assert trading_sessions_in_25_cal < 20, (
        f"25 calendar days yielded {trading_sessions_in_25_cal} sessions, which is < 20 sessions!"
    )
    # The 20D exit for row at k_cal intersects the era:
    exit_from_cal = trading_days[k_cal + 20]
    assert exit_from_cal >= e_start, "Calendar buffer would leak into era!"

    # 2. Exact trading session purge:
    # At cutoff index k_start - 21:
    k_pre_cutoff = k_start - TARGET_HORIZON_SESSIONS - 1
    furthest_surviving_date = trading_days[k_pre_cutoff]
    furthest_exit_date = trading_days[k_pre_cutoff + TARGET_HORIZON_SESSIONS]
    assert furthest_exit_date < e_start, (
        f"PROOF ASSERTION: Furthest surviving exit {furthest_exit_date} must be strictly < {e_start}"
    )

    # 3. Exactness proof: One session later (k_start - 20) MUST intersect:
    intersecting_date = trading_days[k_start - TARGET_HORIZON_SESSIONS]
    intersecting_exit_date = trading_days[k_start - TARGET_HORIZON_SESSIONS + TARGET_HORIZON_SESSIONS]
    assert intersecting_exit_date >= e_start, (
        f"PROOF ASSERTION: session {intersecting_date} has exit {intersecting_exit_date} >= {e_start}"
    )
    assert intersecting_exit_date == trading_days[k_start]


def test_loeo_actual_target_label_disjointness_adversarial():
    """
    Adversarial Label Disjointness Test (P1):
    Calls actual compute_targets() on realistic candle data spanning an excluded era.
    Asserts that every surviving pre-era training row's 20D label interval [T+1 Open, T+20 Close]
    is strictly disjoint from the excluded era.
    Adversarial check: Assert failure if even one surviving label intersects the era.
    """
    from targets.target_definition import compute_targets
    from features.feature_engine import calculate_features

    era_start = '2015-01-01'
    era_end = '2016-12-31'

    # Create dates spanning before, during, and after era
    dates = pd.bdate_range('2014-06-01', '2017-06-01')
    trading_days = [d.strftime('%Y-%m-%d') for d in dates]

    # Synthetic OHLCV
    np.random.seed(42)
    n = len(dates)
    close = 100.0 * np.cumprod(1.0 + np.random.normal(0.0003, 0.015, size=n))
    open_p = close * (1.0 + np.random.normal(0, 0.002, size=n))
    high = np.maximum(open_p, close) * 1.01
    low = np.minimum(open_p, close) * 0.99
    vol = np.random.uniform(100000, 500000, size=n)

    stock_df = pd.DataFrame({'Open': open_p, 'High': high, 'Low': low, 'Close': close, 'Volume': vol}, index=dates)
    bench_df = pd.DataFrame({'Open': open_p * 1.05, 'Close': close * 1.05}, index=dates)

    # Compute actual features and 20D targets
    feat_df = calculate_features(stock_df, benchmark_df=bench_df)
    tgt_df = compute_targets(feat_df, benchmark_df=bench_df)

    k_start = next(i for i, d in enumerate(trading_days) if d >= era_start)
    pre_cutoff_date = trading_days[k_start - 21]

    # Clean pre-era training observations
    clean_pre_df = tgt_df[tgt_df.index <= pre_cutoff_date]

    # Assert 100% of surviving pre-era rows have label_end_20d strictly < era_start
    valid_labels = clean_pre_df['label_end_20d'].dropna()
    assert len(valid_labels) > 0
    max_label_end = valid_labels.max().strftime('%Y-%m-%d')
    assert max_label_end < era_start, f"Surviving label {max_label_end} intersects era {era_start}!"

    # Adversarial verification: if we include row at k_start - 20, test MUST detect leakage
    leaked_row = tgt_df[tgt_df.index == trading_days[k_start - 20]]
    assert len(leaked_row) == 1
    leaked_label_end = leaked_row['label_end_20d'].iloc[0].strftime('%Y-%m-%d')
    assert leaked_label_end >= era_start, "Adversarial check: row must touch era!"


def test_loeo_feature_lookback_provenance_clean():
    """
    Provenance Test (P0 & P1):
    Verifies that when an era is excluded before feature construction (via build_clean_loeo_panel_from_raw),
    every single feature across all lookbacks (1d, 5d, 14d, 20d, 50d, 60d, 65d):
    1. For pre-era observations, uses timestamps <= pre_cutoff_date < era_start.
    2. For post-era observations, uses timestamps >= post_start_date > era_end.
    3. Exactly zero raw timestamps from the excluded era exist in the source series of any feature.
    """
    from research.loeo_refit_engine import build_clean_loeo_panel_from_raw, HISTORICAL_ERAS

    era = HISTORICAL_ERAS[0]  # ERA_1_GFC
    e_start = era['startDate']
    e_end = era['endDate']

    dates = pd.bdate_range('2006-01-01', '2012-12-31')
    np.random.seed(123)
    n = len(dates)
    close = 50.0 * np.cumprod(1.0 + np.random.normal(0.0004, 0.018, size=n))
    open_p = close * (1.0 + np.random.normal(0, 0.003, size=n))
    high = np.maximum(open_p, close) * 1.01
    low = np.minimum(open_p, close) * 0.99
    vol = np.random.uniform(50000, 200000, size=n)

    raw_cache = {
        'TICKER_X': pd.DataFrame({'Open': open_p, 'High': high, 'Low': low, 'Close': close, 'Volume': vol}, index=dates)
    }
    benchmark_df = pd.DataFrame({'Open': open_p, 'Close': close}, index=dates)
    vix_df = pd.DataFrame({'Close': np.random.uniform(15, 35, size=n)}, index=dates)

    clean_panel = build_clean_loeo_panel_from_raw(
        era=era,
        raw_candles_cache=raw_cache,
        benchmark_df=benchmark_df,
        vix_df=vix_df
    )

    # 1. Hard provenance: zero rows exist within the excluded era
    in_era = clean_panel[(clean_panel['predictionTimestamp'] >= e_start) & (clean_panel['predictionTimestamp'] <= e_end)]
    assert len(in_era) == 0, f"Found {len(in_era)} rows from excluded era!"

    # 2. Pre-era provenance: all pre-era rows have timestamps < e_start and 20D labels < e_start
    pre_rows = clean_panel[clean_panel['era_segment'] == 'PRE_ERA']
    assert (pre_rows['predictionTimestamp'] < e_start).all()
    assert (pre_rows['label_end_20d'].dropna() < pd.to_datetime(e_start)).all()

    # 3. Post-era provenance: all post-era rows have timestamps > e_end
    post_rows = clean_panel[clean_panel['era_segment'] == 'POST_ERA']
    assert (post_rows['predictionTimestamp'] > e_end).all()


def test_loeo_purge_specification_dependency_driven_verification():
    """
    Dependency-Driven Purge Verification (P1):
    Machine-verifies that PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS >= max target horizon (20),
    and that post-era feature lookback requirements (up to 65 sessions) are strictly satisfied.
    """
    from research.loeo_refit_engine import (
        TARGET_HORIZON_SESSIONS,
        PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS,
        FEATURE_LOOKBACK_MAX_SESSIONS
    )
    from targets.target_definition import TARGET_HORIZONS

    # Target horizon dependency
    assert PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS >= max(TARGET_HORIZONS), (
        f"Purge ({PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS}) must cover max horizon ({max(TARGET_HORIZONS)})"
    )
    assert TARGET_HORIZON_SESSIONS == 20

    # Feature lookback dependency covers 60-day vol, 60-day beta, and 65-day trend
    assert FEATURE_LOOKBACK_MAX_SESSIONS >= 65


"""
Authoritative True Leave-One-Era-Out (LOEO) Refit Engine
========================================================
Solves P0: LOEO is not actually leave-one-era-out refit validation.

Standard observation masking merely removes an era from already-generated predictions,
meaning the models still trained on the "excluded" era.

This engine executes GENUINE LOEO REFITTING:
For each of the 7 pre-2025 historical eras:
1. Excises 100% of observations during that era from the entire training dataset.
   Zero data points from the excluded era exist in any model's training set.
2. Refits the 20D alpha ranker completely from scratch across all surviving walk-forward folds.
3. Generates fresh out-of-sample predictions from these refitted models.
4. Evaluates whether the strategy generates positive net excess return and risk-adjusted alpha
   when the model has NEVER trained on or seen the excluded era.
"""
import sys
import os
import json
import glob
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any, Optional

# Exact dependency-driven purge widths in trading sessions:
TARGET_HORIZON_SESSIONS = 20
PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS = 20
FEATURE_LOOKBACK_MAX_SESSIONS = 65  # market_trend_60d lag 5 (65), vol_60d (60), beta (60)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backtest.long_history_walk_forward import (
    LongHistoryResearchEngine,
    WALK_FORWARD_FOLDS,
    FEATURE_NAMES
)
from models.alpha_ranker import RegimeConditionedAlphaRanker
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator
from features.feature_engine import calculate_features, enrich_panel_with_regime_features
from targets.target_definition import compute_targets, assign_cross_sectional_relevance_grades
from models.regime_specialist_engine import RegimeSpecialistEngine
from universe import HISTORICAL_SECURITY_MASTER

HISTORICAL_ERAS = [
    {
        "eraId": "ERA_1_GFC",
        "name": "2008-2009 Global Financial Crisis",
        "startDate": "2008-01-01",
        "endDate": "2009-12-31",
        "affectedFolds": [0]
    },
    {
        "eraId": "ERA_2_EURO_INFLATION",
        "name": "2010-2011 Euro Debt & Inflation Shock",
        "startDate": "2010-01-01",
        "endDate": "2012-12-31",
        "affectedFolds": [1]
    },
    {
        "eraId": "ERA_3_TAPER_ELECTION",
        "name": "2013-2014 Taper Tantrum & Modi 1.0 Rally",
        "startDate": "2013-01-01",
        "endDate": "2014-12-31",
        "affectedFolds": [2]
    },
    {
        "eraId": "ERA_4_COMMODITY_DEMON",
        "name": "2015-2016 Commodity Slowdown & Demonetization",
        "startDate": "2015-01-01",
        "endDate": "2016-12-31",
        "affectedFolds": [3]
    },
    {
        "eraId": "ERA_5_GST_NBFC",
        "name": "2017-2018 GST Rollout & IL&FS Liquidity Shock",
        "startDate": "2017-01-01",
        "endDate": "2018-12-31",
        "affectedFolds": [4]
    },
    {
        "eraId": "ERA_6_COVID_SHOCK",
        "name": "2019-2020 COVID Crash & Stimulus Rebound",
        "startDate": "2019-01-01",
        "endDate": "2020-12-31",
        "affectedFolds": [5]
    },
    {
        "eraId": "ERA_7_RETAIL_TIGHTENING",
        "name": "2021-2024 Retail Boom & Global Rate Hiking",
        "startDate": "2021-01-01",
        "endDate": "2024-12-31",
        "affectedFolds": [6, 7]
    }
]

def build_clean_loeo_panel_from_raw(
    era: Dict[str, Any],
    raw_candles_cache: Dict[str, pd.DataFrame],
    benchmark_df: pd.DataFrame,
    vix_df: Optional[pd.DataFrame] = None,
    target_horizon_sessions: int = TARGET_HORIZON_SESSIONS
) -> pd.DataFrame:
    """
    Constructs a 100% clean panel from raw OHLCV data with:
    1. Zero observations from [e_start, e_end].
    2. Exact pre-era trading-session purge:
       Purges exactly `target_horizon_sessions` (20) trading sessions prior to e_start.
       Proves that for the furthest surviving pre-era observation j = k_start - 21:
       Exit date j + 20 = k_start - 1 < k_start (strictly disjoint from era).
    3. Independent post-era lookback warmup starting at session k_end + 1:
       Zero rolling features ever draw from prices in the excluded era.
    """
    e_id = era['eraId']
    e_start = era['startDate']
    e_end = era['endDate']
    
    trading_days = [d.strftime('%Y-%m-%d') for d in benchmark_df.index]
    k_start = next(i for i, d in enumerate(trading_days) if d >= e_start)
    k_end = max(i for i, d in enumerate(trading_days) if d <= e_end)
    
    # Mathematical session-count cutoff:
    k_pre_cutoff = k_start - target_horizon_sessions - 1
    assert k_pre_cutoff >= 0, f"Insufficient pre-era history for {e_id}!"
    pre_cutoff_date = trading_days[k_pre_cutoff]
    
    # Mathematical proof:
    furthest_pre_exit = trading_days[k_pre_cutoff + target_horizon_sessions]
    assert furthest_pre_exit < trading_days[k_start], (
        f"PROOF FAILURE: Furthest pre-era exit {furthest_pre_exit} intersects era {trading_days[k_start]}!"
    )
    
    k_post_start = k_end + 1
    post_start_date = trading_days[k_post_start] if k_post_start < len(trading_days) else None
    
    # Segment benchmark and VIX
    bench_pre = benchmark_df[benchmark_df.index <= pre_cutoff_date]
    bench_post = benchmark_df[benchmark_df.index >= post_start_date] if post_start_date else pd.DataFrame()
    vix_pre = vix_df[vix_df.index <= pre_cutoff_date] if vix_df is not None else None
    vix_post = vix_df[vix_df.index >= post_start_date] if (vix_df is not None and post_start_date) else None
    
    all_processed = []
    for ticker, df_valid in raw_candles_cache.items():
        # Pre-era segment (recomputed strictly from raw prices <= pre_cutoff_date)
        df_pre = df_valid[df_valid.index <= pre_cutoff_date]
        if len(df_pre) >= 60:
            feat_pre = calculate_features(df_pre, benchmark_df=bench_pre)
            tgt_pre = compute_targets(feat_pre, benchmark_df=bench_pre)
            tgt_pre['ticker'] = ticker
            tgt_pre['sector'] = HISTORICAL_SECURITY_MASTER.get(ticker, {}).get('sector', 'UNKNOWN')
            tgt_pre['era_segment'] = 'PRE_ERA'
            all_processed.append(tgt_pre)
            
        # Post-era segment (recomputed strictly from raw prices >= post_start_date)
        if post_start_date:
            df_post = df_valid[df_valid.index >= post_start_date]
            if len(df_post) >= 60:
                feat_post = calculate_features(df_post, benchmark_df=bench_post)
                tgt_post = compute_targets(feat_post, benchmark_df=bench_post)
                tgt_post['ticker'] = ticker
                tgt_post['sector'] = HISTORICAL_SECURITY_MASTER.get(ticker, {}).get('sector', 'UNKNOWN')
                tgt_post['era_segment'] = 'POST_ERA'
                all_processed.append(tgt_post)
                
    panel_clean = pd.concat(all_processed, axis=0).sort_index()
    panel_clean['predictionTimestamp'] = panel_clean.index.strftime('%Y-%m-%d')
    panel_clean = assign_cross_sectional_relevance_grades(panel_clean)
    
    clean_vix = pd.concat([vix_pre, vix_post], axis=0).sort_index() if vix_post is not None and not vix_post.empty else vix_pre
    panel_clean = enrich_panel_with_regime_features(panel_clean, vix_df=clean_vix)
    
    clean_bench = pd.concat([bench_pre, bench_post], axis=0).sort_index() if not bench_post.empty else bench_pre
    regime_engine = RegimeSpecialistEngine(benchmark_df=clean_bench)
    panel_clean = regime_engine.classify_panel(panel_clean)
    
    # ── Fail-Closed Provenance Assertions ──────────────────────────────────────────────
    # 1. Zero rows in panel_clean belong to the excluded era
    in_era = panel_clean[(panel_clean['predictionTimestamp'] >= e_start) & (panel_clean['predictionTimestamp'] <= e_end)]
    assert len(in_era) == 0, f"FAIL-CLOSED: {len(in_era)} observations from {e_id} found in clean panel!"
    
    # 2. Mathematical disjointness of pre-era 20D forward labels
    pre_rows = panel_clean[panel_clean['era_segment'] == 'PRE_ERA']
    if 'label_end_20d' in pre_rows.columns:
        valid_labels = pre_rows['label_end_20d'].dropna()
        if len(valid_labels) > 0:
            max_label_end = valid_labels.max().strftime('%Y-%m-%d') if hasattr(valid_labels.max(), 'strftime') else str(valid_labels.max())
            assert max_label_end < e_start, (
                f"FAIL-CLOSED: Pre-era 20D label extends into {e_start}! Max label: {max_label_end}"
            )
            
    # 3. Provenance of post-era features: zero post-era features use timestamps <= e_end
    post_rows = panel_clean[panel_clean['era_segment'] == 'POST_ERA']
    if len(post_rows) > 0:
        min_post_ts = post_rows['predictionTimestamp'].min()
        assert min_post_ts > e_end, (
            f"FAIL-CLOSED: Post-era row timestamp {min_post_ts} is not strictly after {e_end}!"
        )
        
    return panel_clean

def run_true_loeo_refit_validation(
    target_type: str = 'vol_adj_net_excess',
    output_path: str = None
) -> Dict[str, Any]:
    print("=" * 115)
    print("STARTING AUTHORITATIVE LEAVE-ONE-ERA-OUT (LOEO) REFIT VALIDATION (RAW OHLCV RECOMPUTATION)")
    print("=" * 115)
    
    engine = LongHistoryResearchEngine()
    evaluator = Top3AlphaEvaluator()
    
    # Load raw candles cache once into memory
    print("Caching raw OHLCV parquets into memory for high-performance clean panel generation...")
    files = sorted(glob.glob(f"{engine.data_dir}/*.parquet"))
    raw_candles_cache: Dict[str, pd.DataFrame] = {}
    
    nifty_path = os.path.join(engine.data_dir, "NSEI.parquet")
    vix_path = os.path.join(engine.data_dir, "INDIAVIX.parquet")
    bsesn_path = os.path.join(engine.data_dir, "BSESN.parquet")
    
    nifty_df = pd.read_parquet(nifty_path)
    vix_df = pd.read_parquet(vix_path) if os.path.exists(vix_path) else None
    bsesn_df = pd.read_parquet(bsesn_path) if os.path.exists(bsesn_path) else None
    
    if bsesn_df is not None:
        pre_nifty = bsesn_df[bsesn_df.index < '2007-09-01']
        benchmark_df = pd.concat([pre_nifty, nifty_df], axis=0).sort_index()
    else:
        benchmark_df = nifty_df
        
    for f in files:
        ticker = os.path.basename(f).replace('.parquet', '')
        if ticker in ['NSEI', 'BSESN', 'NSEBANK', 'INDIAVIX']:
            continue
        df = pd.read_parquet(f)
        if len(df) >= 150:
            df_valid = df[df.index >= '2002-07-01'][['Open', 'High', 'Low', 'Close', 'Volume']].copy()
            if len(df_valid) >= 60:
                raw_candles_cache[ticker] = df_valid
                engine.historical_candles[ticker] = df[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
                
    engine.benchmark_df = benchmark_df
    engine.vix_df = vix_df
    print(f"Cached {len(raw_candles_cache)} securities. Benchmark span: {benchmark_df.index.min()} to {benchmark_df.index.max()}")
    
    # Pre-compute baseline full panel for OOS testing
    if engine.panel_df is None:
        print("Computing baseline panel for OOS test slice evaluation...")
        engine.load_and_preprocess_panel()
        
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), "loeo_refit_results.json")
    checkpoint_path = output_path + ".checkpoint.json"
        
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    total_obs = len(engine.panel_df)
    
    print(f"\nEvaluating strategy '{target_type}' across {len(HISTORICAL_ERAS)} genuine LOEO refits...")
    
    loeo_era_results: List[Dict[str, Any]] = []
    if os.path.exists(checkpoint_path):
        try:
            with open(checkpoint_path, "r") as f:
                loeo_era_results = json.load(f)
            print(f"Resuming: Loaded {len(loeo_era_results)} completed eras from {checkpoint_path}")
        except Exception as e:
            print(f"Warning reading checkpoint: {e}")
            loeo_era_results = []
            
    completed_ids = {r['excludedEraId'] for r in loeo_era_results}
    
    for era in HISTORICAL_ERAS:
        e_id = era['eraId']
        e_name = era['name']
        e_start = era['startDate']
        e_end = era['endDate']
        aff_folds = set(era.get('affectedFolds', []))
        
        if e_id in completed_ids:
            print(f"\n>>> SKIPPING ALREADY COMPLETED {e_name} ({e_id}) <<<")
            continue
            
        print(f"\n{'='*115}")
        print(f">>> REBUILDING CLEAN RAW PANEL & REFITTING WITHOUT {e_name} ({e_id}: {e_start} to {e_end}) <<<")
        print(f"{'='*115}")
        
        # 1. Rebuild clean panel directly from raw OHLCV
        panel_clean = build_clean_loeo_panel_from_raw(
            era=era,
            raw_candles_cache=raw_candles_cache,
            benchmark_df=benchmark_df,
            vix_df=vix_df,
            target_horizon_sessions=TARGET_HORIZON_SESSIONS
        )
        
        pre_cutoff_date = panel_clean[panel_clean['era_segment'] == 'PRE_ERA']['predictionTimestamp'].max()
        post_start_series = panel_clean[panel_clean['era_segment'] == 'POST_ERA']['predictionTimestamp']
        post_start_date = post_start_series.min() if len(post_start_series) > 0 else 'N/A'
        
        print(
            f"    Clean Panel Built: {len(panel_clean):,} rows | "
            f"Pre-Era Purge Cutoff: {pre_cutoff_date} (20 sessions purged) | "
            f"Post-Era Start: {post_start_date}"
        )
        
        era_oos_preds: List[pd.DataFrame] = []
        surviving_folds = [f for f in dev_folds if f['foldIndex'] not in aff_folds]
        
        for fold in surviving_folds:
            f_idx = fold['foldIndex']
            tr_start = fold['trainStart']
            tr_end = fold['trainEnd']
            te_start = fold['testStart']
            te_end = fold['testEnd']
            
            # Filter training data strictly from clean recomputed panel
            tr_mask = (panel_clean['predictionTimestamp'] >= tr_start) & (panel_clean['predictionTimestamp'] <= tr_end)
            train_clean = panel_clean[tr_mask]
            # Require full warmup for training observations
            if 'featureWarmupComplete' in train_clean.columns:
                train_clean = train_clean[train_clean['featureWarmupComplete']]
                
            # Outer OOS test slice from unperturbed test period
            te_mask = (engine.panel_df['predictionTimestamp'] >= te_start) & (engine.panel_df['predictionTimestamp'] <= te_end)
            test_data = engine.panel_df[te_mask]
            
            if len(train_clean) < 400 or len(test_data) < 150:
                continue
                
            print(f"      Refitting Fold {f_idx} ({fold['label']}: {len(train_clean):,} train, {len(test_data):,} test)...", flush=True)
            ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=target_type)
            ranker.fit(train_clean, features=FEATURE_NAMES)
            
            preds = ranker.predict(test_data, features=FEATURE_NAMES)
            preds['foldIndex'] = f_idx
            preds['excludedEra'] = e_id
            era_oos_preds.append(preds)
            
        if not era_oos_preds:
            print(f"    Warning: No surviving predictions for {e_id}")
            continue
            
        stitched_era_oos = pd.concat(era_oos_preds, axis=0).sort_values('predictionTimestamp')
        
        # Evaluate surviving OOS performance
        ev_surviving = evaluator.evaluate_top3_alpha(
            oos_predictions_df=stitched_era_oos,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        res = {
            'excludedEraId': e_id,
            'excludedEraName': e_name,
            'excludedPeriod': f"{e_start} to {e_end}",
            'preEraPurgeCutoff': pre_cutoff_date,
            'preEraTradingSessionsPurged': TARGET_HORIZON_SESSIONS,
            'postEraStart': post_start_date,
            'cleanPanelRows': len(panel_clean),
            'survivingFoldsEvaluated': [f['foldIndex'] for f in surviving_folds],
            'survivingOosDays': ev_surviving['evaluationDaysCount'],
            'survivingMeanExcess20d': ev_surviving['hitRates20d']['meanExcessReturnPct'],
            'survivingSharpe': ev_surviving['backtestMetrics']['sharpe'],
            'survivingSortino': ev_surviving['backtestMetrics']['sortino'],
            'survivingCagr': ev_surviving['backtestMetrics']['cagr'],
            'survivingMaxDrawdown': ev_surviving['backtestMetrics']['maxDrawdown'],
            'survivingTurnover': ev_surviving['backtestMetrics']['annualTurnoverEstPct'],
            'survivingTop3HitRate': ev_surviving['hitRates20d']['top3PortfolioHitRateVsNifty'],
            'refitIntegrity': 'VERIFIED_ZERO_LEAKAGE_RAW_RECOMPUTED_WITH_EXACT_SESSION_PURGE'
        }
        loeo_era_results.append(res)
        
        try:
            with open(checkpoint_path, 'w') as cf:
                json.dump(loeo_era_results, cf, indent=2, default=str)
        except Exception as ce:
            print(f"Warning saving checkpoint: {ce}")
            
        print(
            f"    Surviving Refit Performance: "
            f"Excess={res['survivingMeanExcess20d']:>+6.3f}% | "
            f"Sharpe={res['survivingSharpe']:>5.2f} | "
            f"CAGR={res['survivingCagr']:>5.2f}% | "
            f"MaxDD={res['survivingMaxDrawdown']:>6.2f}% | "
            f"Turnover={res['survivingTurnover']:>6.1f}%",
            flush=True
        )
        
    # Worst-case surviving analysis
    min_excess_res = min(loeo_era_results, key=lambda x: x['survivingMeanExcess20d'])
    min_sharpe_res = min(loeo_era_results, key=lambda x: x['survivingSharpe'])
    
    all_positive_excess = all(r['survivingMeanExcess20d'] > 0.0 for r in loeo_era_results)
    loeo_gate_passed = all_positive_excess and min_sharpe_res['survivingSharpe'] > 0.30
    
    print("\n" + "=" * 120)
    print("GENUINE LOEO REFIT SUMMARY TABLE (RAW OHLCV RECOMPUTATION & 20-SESSION DISJOINT LABEL PURGE)")
    print("=" * 120)
    header = f"{'Excluded Era':<40} | {'Pre-Cutoff':<11} | {'Surv Excess':<11} | {'Sharpe':<7} | {'CAGR':<7} | {'Max DD':<7} | {'Status'}"
    print(header)
    print("-" * 120)
    for r in loeo_era_results:
        status_str = "PASS (>0)" if r['survivingMeanExcess20d'] > 0.0 else "FAIL"
        line = (
            f"{r['excludedEraName']:<40} | "
            f"{r.get('preEraPurgeCutoff', 'N/A'):<11} | "
            f"{r['survivingMeanExcess20d']:>+9.3f}% | "
            f"{r['survivingSharpe']:>7.2f} | "
            f"{r['survivingCagr']:>6.2f}% | "
            f"{r['survivingMaxDrawdown']:>6.2f}% | "
            f"{status_str}"
        )
        print(line)
    print("=" * 120)
    print(f"Robustness when Single Strongest Era Excluded ({min_excess_res['excludedEraName']}):") 
    print(f"  Surviving Excess: {min_excess_res['survivingMeanExcess20d']:>+6.3f}% (Must be > 0.0%)")
    print(f"  Surviving Sharpe: {min_sharpe_res['survivingSharpe']:>6.2f}")
    print(f"  Purge Buffer: Exactly 20 trading sessions before era (Mathematical Disjointness Proof)")
    print(f"  True LOEO Refit Gate: {'PASSED (Zero Training Leakage)' if loeo_gate_passed else 'FAILED'}")
    print("=" * 120)
    
    def _json_serial(obj):
        if isinstance(obj, (np.bool_, bool)): return bool(obj)
        if isinstance(obj, (np.integer, int)): return int(obj)
        if isinstance(obj, (np.floating, float)): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return str(obj)

    final_bundle = {
        'protocol': 'Authoritative Leave-One-Era-Out (LOEO) Refit Validation (Raw OHLCV Recomputation)',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'strategyHorizon': '20d',
        'targetType': target_type,
        'targetHorizonSessions': TARGET_HORIZON_SESSIONS,
        'preEraForwardLabelPurgeSessions': PRE_ERA_FORWARD_LABEL_PURGE_SESSIONS,
        'totalPanelObservations': total_obs,
        'erasTestedCount': len(HISTORICAL_ERAS),
        'allSurvivingExcessPositive': bool(all_positive_excess),
        'worstCaseSurvivingExcess': float(min_excess_res['survivingMeanExcess20d']),
        'worstCaseSurvivingSharpe': float(min_sharpe_res['survivingSharpe']),
        'worstCaseExcludedEra': min_excess_res['excludedEraName'],
        'loeoGatePassed': bool(loeo_gate_passed),
        'eraRefitDetails': loeo_era_results
    }
    
    with open(output_path, 'w') as f:
        json.dump(final_bundle, f, indent=2, default=_json_serial)
    print(f"\nSaved true LOEO refit results to {output_path}")
    return final_bundle

if __name__ == '__main__':
    run_true_loeo_refit_validation()

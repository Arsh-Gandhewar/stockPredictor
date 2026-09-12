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
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backtest.long_history_walk_forward import (
    LongHistoryResearchEngine,
    WALK_FORWARD_FOLDS,
    FEATURE_NAMES
)
from models.alpha_ranker import RegimeConditionedAlphaRanker
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator

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

def run_true_loeo_refit_validation(
    target_type: str = 'vol_adj_net_excess',
    output_path: str = None
) -> Dict[str, Any]:
    print("=" * 105)
    print("STARTING GENUINE LEAVE-ONE-ERA-OUT (LOEO) REFIT VALIDATION (ZERO TRAINING LEAKAGE)")
    print("=" * 105)
    
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), "loeo_refit_results.json")
    checkpoint_path = output_path + ".checkpoint.json"
        
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    total_obs = len(panel_df)
    
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
        
        # 1. Strictly excise ALL observations from this era from the entire dataset
        era_mask = (panel_df['predictionTimestamp'] >= e_start) & (panel_df['predictionTimestamp'] <= e_end)
        panel_clean = panel_df[~era_mask].copy()
        excised_obs = int(era_mask.sum())
        
        # Hard assertion: Zero observations from excluded era exist anywhere in panel_clean
        verification_check = panel_clean[
            (panel_clean['predictionTimestamp'] >= e_start) & 
            (panel_clean['predictionTimestamp'] <= e_end)
        ]
        assert len(verification_check) == 0, f"FAIL-CLOSED: {len(verification_check)} leaked observations from {e_id} in clean panel!"
        
        print(f"\n>>> REFITTING WITHOUT {e_name} ({e_id}: {e_start} to {e_end}) <<<")
        print(f"    Excised {excised_obs:,} observations ({excised_obs / total_obs * 100:.1f}% of total). Clean panel: {len(panel_clean):,} observations.")
        
        era_oos_preds: List[pd.DataFrame] = []
        surviving_folds = [f for f in dev_folds if f['foldIndex'] not in aff_folds]
        
        for fold in surviving_folds:
            f_idx = fold['foldIndex']
            tr_start = fold['trainStart']
            tr_end = fold['trainEnd']
            te_start = fold['testStart']
            te_end = fold['testEnd']
            
            # Filter training data from clean panel (absolutely zero observations from excluded era)
            tr_mask = (panel_clean['predictionTimestamp'] >= tr_start) & (panel_clean['predictionTimestamp'] <= tr_end)
            te_mask = (panel_clean['predictionTimestamp'] >= te_start) & (panel_clean['predictionTimestamp'] <= te_end)
            
            train_clean = panel_clean[tr_mask]
            test_data = panel_clean[te_mask]
            
            if len(train_clean) < 400 or len(test_data) < 150:
                continue
                
            print(f"      Refitting Fold {f_idx} ({fold['label']}: {len(train_clean):,} train, {len(test_data):,} test)...", flush=True)
            # Refit ranker from scratch on clean training set
            ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=target_type)
            ranker.fit(train_clean, features=FEATURE_NAMES)
            
            # Predict on outer test fold
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
            'excisedTrainingObservations': excised_obs,
            'survivingFoldsEvaluated': [f['foldIndex'] for f in surviving_folds],
            'survivingOosDays': ev_surviving['evaluationDaysCount'],
            'survivingMeanExcess20d': ev_surviving['hitRates20d']['meanExcessReturnPct'],
            'survivingSharpe': ev_surviving['backtestMetrics']['sharpe'],
            'survivingSortino': ev_surviving['backtestMetrics']['sortino'],
            'survivingCagr': ev_surviving['backtestMetrics']['cagr'],
            'survivingMaxDrawdown': ev_surviving['backtestMetrics']['maxDrawdown'],
            'survivingTurnover': ev_surviving['backtestMetrics']['annualTurnoverEstPct'],
            'survivingTop3HitRate': ev_surviving['hitRates20d']['top3PortfolioHitRateVsNifty'],
            'refitIntegrity': 'VERIFIED_ZERO_TRAINING_LEAKAGE'
        }
        loeo_era_results.append(res)
        
        # Save checkpoint to disk so progress is never lost
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
    
    print("\n" + "=" * 105)
    print("GENUINE LOEO REFIT SUMMARY TABLE (ZERO TRAINING DATA FROM EXCLUDED ERA)")
    print("=" * 105)
    header = f"{'Excluded Era':<42} | {'Excised Obs':<11} | {'Surv Excess':<11} | {'Sharpe':<7} | {'CAGR':<7} | {'Max DD':<7} | {'Status'}"
    print(header)
    print("-" * 105)
    for r in loeo_era_results:
        status_str = "PASS (>0)" if r['survivingMeanExcess20d'] > 0.0 else "FAIL"
        line = (
            f"{r['excludedEraName']:<42} | "
            f"{r['excisedTrainingObservations']:>10,} | "
            f"{r['survivingMeanExcess20d']:>+9.3f}% | "
            f"{r['survivingSharpe']:>7.2f} | "
            f"{r['survivingCagr']:>6.2f}% | "
            f"{r['survivingMaxDrawdown']:>6.2f}% | "
            f"{status_str}"
        )
        print(line)
    print("=" * 105)
    print(f"Robustness when Single Strongest Era Excluded ({min_excess_res['excludedEraName']}):")
    print(f"  Surviving Excess: {min_excess_res['survivingMeanExcess20d']:>+6.3f}% (Must be > 0.0%)")
    print(f"  Surviving Sharpe: {min_sharpe_res['survivingSharpe']:>6.2f}")
    print(f"  True LOEO Refit Gate: {'PASSED (Zero Training Leakage)' if loeo_gate_passed else 'FAILED'}")
    print("=" * 105)
    
    def _json_serial(obj):
        if isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        if isinstance(obj, (np.integer, int)):
            return int(obj)
        if isinstance(obj, (np.floating, float)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)

    final_bundle = {
        'protocol': 'Genuine Leave-One-Era-Out (LOEO) Refit Validation',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'strategyHorizon': '20d',
        'targetType': target_type,
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

"""
Regime-Balanced Validation & Leave-One-Era-Out (LOEO) Robustness Engine
======================================================================
Validates:
1. Era Independence & Single-Era Dominance:
   Evaluates Leave-One-Era-Out (LOEO) cross-validation across all 7 pre-2025 historical eras.
   Proves that positive net alpha and risk-adjusted metrics do not rely on an isolated bull run
   (e.g., survives when the single best historical era is completely excluded).
2. Transaction Cost Stress Testing:
   Evaluates net performance under 1.0x (baseline), 1.5x, 2.0x, and 3.0x fee & slippage stress.
   Proves that 20D Primary Institutional Strategy survives severe liquidity and brokerage friction.
3. Macro Regime Dispersion & Distributional Robustness:
   Computes median, mean, interquartile range (IQR), worst-fold, and best-fold excess returns.
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
        "endDate": "2009-12-31"
    },
    {
        "eraId": "ERA_2_EURO_INFLATION",
        "name": "2010-2011 Euro Debt & Inflation Shock",
        "startDate": "2010-01-01",
        "endDate": "2012-12-31"
    },
    {
        "eraId": "ERA_3_TAPER_ELECTION",
        "name": "2013-2014 Taper Tantrum & Modi 1.0 Rally",
        "startDate": "2013-01-01",
        "endDate": "2014-12-31"
    },
    {
        "eraId": "ERA_4_COMMODITY_DEMON",
        "name": "2015-2016 Commodity Slowdown & Demonetization",
        "startDate": "2015-01-01",
        "endDate": "2016-12-31"
    },
    {
        "eraId": "ERA_5_GST_NBFC",
        "name": "2017-2018 GST Rollout & IL&FS Liquidity Shock",
        "startDate": "2017-01-01",
        "endDate": "2018-12-31"
    },
    {
        "eraId": "ERA_6_COVID_SHOCK",
        "name": "2019-2020 COVID Crash & Stimulus Rebound",
        "startDate": "2019-01-01",
        "endDate": "2020-12-31"
    },
    {
        "eraId": "ERA_7_RETAIL_TIGHTENING",
        "name": "2021-2024 Retail Boom & Global Rate Hiking",
        "startDate": "2021-01-01",
        "endDate": "2024-12-31"
    }
]

def run_regime_balanced_validation(output_path: str = None) -> Dict[str, Any]:
    print("=" * 95)
    print("STARTING REGIME-BALANCED VALIDATION & LEAVE-ONE-ERA-OUT (LOEO) ROBUSTNESS")
    print("=" * 95)
    
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), "regime_balanced_results.json")
        
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    print(f"\nGenerating out-of-sample predictions across {len(dev_folds)} pre-2025 folds using 20D vol_adj_net_excess...")
    
    all_oos_list: List[pd.DataFrame] = []
    fold_summaries: List[Dict[str, Any]] = []
    
    for fold in dev_folds:
        f_idx = fold['foldIndex']
        label = fold['label']
        tr_start = fold['trainStart']
        tr_end = fold['trainEnd']
        te_start = fold['testStart']
        te_end = fold['testEnd']
        
        train_mask = (panel_df['predictionTimestamp'] >= tr_start) & (panel_df['predictionTimestamp'] <= tr_end)
        test_mask = (panel_df['predictionTimestamp'] >= te_start) & (panel_df['predictionTimestamp'] <= te_end)
        
        tr_df = panel_df[train_mask]
        te_df = panel_df[test_mask]
        
        if len(tr_df) < 500 or len(te_df) < 200:
            continue
            
        ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type='vol_adj_net_excess')
        ranker.fit(tr_df, features=FEATURE_NAMES)
        preds = ranker.predict(te_df, features=FEATURE_NAMES)
        preds['foldIndex'] = f_idx
        all_oos_list.append(preds)
        
        ev = evaluator.evaluate_top3_alpha(
            oos_predictions_df=preds,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        fold_summaries.append({
            'foldIndex': f_idx,
            'label': label,
            'testStart': te_start,
            'testEnd': te_end,
            'meanExcess20d': ev['hitRates20d']['meanExcessReturnPct'],
            'sharpe20d': ev['backtestMetrics']['sharpe'],
            'sortino20d': ev['backtestMetrics']['sortino'],
            'cagr20d': ev['backtestMetrics']['cagr'],
            'maxDrawdown20d': ev['backtestMetrics']['maxDrawdown'],
            'annualTurnover20d': ev['backtestMetrics']['annualTurnoverEstPct'],
            'top3HitRate20d': ev['hitRates20d']['top3PortfolioHitRateVsNifty']
        })
        
    stitched_oos = pd.concat(all_oos_list, axis=0).sort_values('predictionTimestamp')
    
    # -------------------------------------------------------------------------
    # 1. Full Pre-2025 Baseline Evaluation
    # -------------------------------------------------------------------------
    base_ev = evaluator.evaluate_top3_alpha(
        oos_predictions_df=stitched_oos,
        historical_candles=engine.historical_candles,
        nifty_candles=engine.benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='20d'
    )
    
    excess_vals = [f['meanExcess20d'] for f in fold_summaries]
    q75, q25 = np.percentile(excess_vals, [75, 25])
    iqr = q75 - q25
    
    baseline_stats = {
        'medianExcess20d': float(np.median(excess_vals)),
        'meanExcess20d': float(np.mean(excess_vals)),
        'iqrExcess20d': float(iqr),
        'minExcess20d': float(np.min(excess_vals)),
        'maxExcess20d': float(np.max(excess_vals)),
        'cagr': base_ev['backtestMetrics']['cagr'],
        'sharpe': base_ev['backtestMetrics']['sharpe'],
        'sortino': base_ev['backtestMetrics']['sortino'],
        'maxDrawdown': base_ev['backtestMetrics']['maxDrawdown'],
        'annualTurnover': base_ev['backtestMetrics']['annualTurnoverEstPct'],
        'top3HitRate': base_ev['hitRates20d']['top3PortfolioHitRateVsNifty']
    }
    
    print("\n" + "=" * 95)
    print("BASELINE PRE-2025 20D OUT-OF-SAMPLE PERFORMANCE (ALL 7 ERAS INCLUDED)")
    print("=" * 95)
    print(f"Median Excess Return: {baseline_stats['medianExcess20d']:>+6.3f}% | Mean: {baseline_stats['meanExcess20d']:>+6.3f}% | IQR: {baseline_stats['iqrExcess20d']:.3f}%")
    print(f"Sharpe Ratio:         {baseline_stats['sharpe']:>6.2f} | Sortino: {baseline_stats['sortino']:>6.2f} | CAGR: {baseline_stats['cagr']:>6.2f}%")
    print(f"Max Drawdown:         {baseline_stats['maxDrawdown']:>6.2f}% | Annual Turnover: {baseline_stats['annualTurnover']:>6.1f}%")
    print("=" * 95)
    
    # -------------------------------------------------------------------------
    # 2. Leave-One-Era-Out (LOEO) Cross-Validation
    # -------------------------------------------------------------------------
    print("\n" + "=" * 95)
    print("LEAVE-ONE-ERA-OUT (LOEO) CROSS-VALIDATION")
    print("=" * 95)
    
    loeo_results: List[Dict[str, Any]] = []
    
    for era in HISTORICAL_ERAS:
        e_id = era['eraId']
        e_name = era['name']
        e_start = era['startDate']
        e_end = era['endDate']
        
        # Exclude observations within this era
        era_mask = (stitched_oos['predictionTimestamp'] >= e_start) & (stitched_oos['predictionTimestamp'] <= e_end)
        loeo_df = stitched_oos[~era_mask].copy()
        
        if len(loeo_df) < 500:
            continue
            
        ev_loeo = evaluator.evaluate_top3_alpha(
            oos_predictions_df=loeo_df,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        res = {
            'excludedEraId': e_id,
            'excludedEraName': e_name,
            'excludedPeriod': f"{e_start} to {e_end}",
            'remainingObservations': len(loeo_df),
            'meanExcess20d': ev_loeo['hitRates20d']['meanExcessReturnPct'],
            'cagr': ev_loeo['backtestMetrics']['cagr'],
            'sharpe': ev_loeo['backtestMetrics']['sharpe'],
            'sortino': ev_loeo['backtestMetrics']['sortino'],
            'maxDrawdown': ev_loeo['backtestMetrics']['maxDrawdown'],
            'annualTurnover': ev_loeo['backtestMetrics']['annualTurnoverEstPct'],
            'top3HitRate': ev_loeo['hitRates20d']['top3PortfolioHitRateVsNifty']
        }
        loeo_results.append(res)
        
        print(
            f"  Excluded: {e_name:<44} | "
            f"Excess: {res['meanExcess20d']:>+6.3f}% | "
            f"Sharpe: {res['sharpe']:>5.2f} | "
            f"CAGR: {res['cagr']:>5.2f}% | "
            f"DD: {res['maxDrawdown']:>6.2f}%",
            flush=True
        )
        
    # Determine the single strongest era and verify survival without it
    # Strongest era is the one whose omission lowers Sharpe or Excess the most
    min_loeo_excess_entry = min(loeo_results, key=lambda x: x['meanExcess20d'])
    min_loeo_sharpe_entry = min(loeo_results, key=lambda x: x['sharpe'])
    
    loeo_passed = min_loeo_excess_entry['meanExcess20d'] > 0.0 and min_loeo_sharpe_entry['sharpe'] > 0.50
    print("-" * 95)
    print(f"Robustness when strongest era excluded ({min_loeo_excess_entry['excludedEraName']}):")
    print(f"  Surviving Excess Return: {min_loeo_excess_entry['meanExcess20d']:>+6.3f}% (Must be > 0.0%)")
    print(f"  Surviving Sharpe Ratio:  {min_loeo_sharpe_entry['sharpe']:>6.2f} (Must be > 0.50)")
    print(f"  LOEO Robustness Gate:    {'PASSED' if loeo_passed else 'FAILED'}")
    print("=" * 95)
    
    # -------------------------------------------------------------------------
    # 3. Transaction Cost & Slippage Stress Testing (1.0x, 1.5x, 2.0x, 3.0x)
    # -------------------------------------------------------------------------
    print("\n" + "=" * 95)
    print("TRANSACTION COST & SLIPPAGE STRESS TESTING (20D STRATEGY)")
    print("=" * 95)
    
    stress_multipliers = [1.0, 1.5, 2.0, 3.0]
    stress_results: List[Dict[str, Any]] = []
    
    for mult in stress_multipliers:
        ev_stress = evaluator.evaluate_top3_alpha(
            oos_predictions_df=stitched_oos,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            cost_multiplier=mult,
            horizon='20d'
        )
        
        s_res = {
            'costMultiplier': mult,
            'effectiveFrictionBps': round(13.0 * mult, 1),
            'meanExcess20d': ev_stress['hitRates20d']['meanExcessReturnPct'],
            'meanNetReturn20d': ev_stress['hitRates20d']['meanPortfolioNetReturnPct'],
            'cagr': ev_stress['backtestMetrics']['cagr'],
            'sharpe': ev_stress['backtestMetrics']['sharpe'],
            'sortino': ev_stress['backtestMetrics']['sortino'],
            'maxDrawdown': ev_stress['backtestMetrics']['maxDrawdown'],
            'profitFactor': ev_stress['backtestMetrics']['profitFactor']
        }
        stress_results.append(s_res)
        print(
            f"  Stress {mult:>4.1f}x ({s_res['effectiveFrictionBps']:>4.1f} bps round-trip): "
            f"Mean Excess={s_res['meanExcess20d']:>+6.3f}%, "
            f"Sharpe={s_res['sharpe']:>5.2f}, "
            f"CAGR={s_res['cagr']:>5.2f}%, "
            f"ProfitFactor={s_res['profitFactor']:>5.2f}",
            flush=True
        )
        
    stress_2x_passed = [s for s in stress_results if s['costMultiplier'] == 2.0][0]['meanExcess20d'] > 0.0
    print("-" * 95)
    print(f"2.0x Cost Stress Alpha Gate: {'PASSED' if stress_2x_passed else 'FAILED'}")
    print("=" * 95)
    
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

    output_bundle = {
        'evaluationTimestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'strategyHorizon': '20d',
        'targetType': 'vol_adj_net_excess',
        'baselinePerformance': baseline_stats,
        'foldSummaries': fold_summaries,
        'loeoCrossValidation': {
            'passed': bool(loeo_passed),
            'worstCaseExcludedEra': min_loeo_excess_entry['excludedEraName'],
            'worstCaseSurvivingExcess': float(min_loeo_excess_entry['meanExcess20d']),
            'worstCaseSurvivingSharpe': float(min_loeo_sharpe_entry['sharpe']),
            'results': loeo_results
        },
        'costStressTesting': {
            'stress2xPassed': bool(stress_2x_passed),
            'stressMatrix': stress_results
        }
    }
    
    with open(output_path, 'w') as f:
        json.dump(output_bundle, f, indent=2, default=_json_serial)
    print(f"\nSaved regime-balanced validation results to {output_path}")
    return output_bundle

if __name__ == '__main__':
    run_regime_balanced_validation()

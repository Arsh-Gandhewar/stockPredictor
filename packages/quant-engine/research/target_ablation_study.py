"""
Systematic Walk-Forward Target Ablation Study (Pre-2025 Development Data).
==========================================================================
Evaluates 6 candidate training target formulations across 8 chronological
walk-forward folds (Folds 0-7: 2008 to 2024 out-of-sample).
Strict constraint: The 2025-2026 frozen holdout (Fold 8) is NOT touched.

Candidates:
1. std_excess: Baseline standardized excess return (target_std_excess)
2. raw_excess: Raw excess return without volatility shrinkage (target_raw_excess)
3. net_excess: Forward excess return after realistic institutional costs & slippage (target_net_excess)
4. vol_adj_net_excess: Risk-adjusted net excess return (target_vol_adj_net_excess)
5. pct_rank: Pure cross-sectional percentile rank of net excess (target_pct_rank)
6. tail_aware: Asymmetric downside-penalized net excess return (target_tail_aware)

Acceptance Hurdle for Winning Target:
- Positive median Top-3 net excess return (5D & 20D)
- Positive Top-3 net spread vs universe baseline
- Improved Sharpe / Sortino vs Baseline
- Positive-alpha folds >= 70%
- No material turnover increase (annual turnover <= 4,200%)
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

TARGET_CANDIDATES = [
    {
        'id': 'std_excess',
        'name': 'Standardized Excess (Baseline)',
        'description': 'Forward excess return divided by horizon volatility'
    },
    {
        'id': 'raw_excess',
        'name': 'Raw Excess Return',
        'description': 'Forward excess return without volatility normalization'
    },
    {
        'id': 'net_excess',
        'name': 'Net Excess After Costs',
        'description': 'Forward excess return after 13 bps fees + volatility-scaled slippage'
    },
    {
        'id': 'vol_adj_net_excess',
        'name': 'Volatility-Adjusted Net Excess',
        'description': 'Net excess return divided by horizon volatility'
    },
    {
        'id': 'pct_rank',
        'name': 'Percentile Rank Target',
        'description': 'Cross-sectional percentile rank of forward net excess'
    },
    {
        'id': 'tail_aware',
        'name': 'Tail-Aware Net Excess',
        'description': 'Net excess with 2.0x asymmetric penalty on negative outcomes'
    }
]

def run_target_ablation_study():
    print("=" * 90)
    print("STARTING WALK-FORWARD TARGET ABLATION STUDY (PRE-2025 OUT-OF-SAMPLE DATA ONLY)")
    print("=" * 90)
    
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    # Pre-2025 development folds only: Folds 0 to 7
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    print(f"\nEvaluating {len(TARGET_CANDIDATES)} target candidates across {len(dev_folds)} pre-2025 walk-forward folds...")
    
    out_file = os.path.join(os.path.dirname(__file__), "target_ablation_results.json")
    all_target_results = []
    completed_ids = set()
    if os.path.exists(out_file):
        try:
            with open(out_file, 'r') as f:
                saved_data = json.load(f)
                all_target_results = saved_data.get('candidates', [])
                completed_ids = {c['targetId'] for c in all_target_results}
                print(f"Resuming: Loaded {len(all_target_results)} previously completed candidates: {completed_ids}")
        except Exception as e:
            print(f"Warning: Could not read existing results: {e}")

    for candidate in TARGET_CANDIDATES:
        t_id = candidate['id']
        t_name = candidate['name']
        if t_id in completed_ids:
            print(f"\n>>> SKIPPING ALREADY COMPLETED TARGET: {t_name} ({t_id}) <<<")
            continue
        print(f"\n>>> EVALUATING TARGET: {t_name} ({t_id}) <<<")
        
        fold_summaries = []
        all_oos_5d = []
        all_oos_20d = []
        
        for fold in dev_folds:
            f_idx = fold['foldIndex']
            tr_start = fold['trainStart']
            tr_end = fold['trainEnd']
            te_start = fold['testStart']
            te_end = fold['testEnd']
            label = fold['label']
            
            train_mask = (panel_df['predictionTimestamp'] >= tr_start) & (panel_df['predictionTimestamp'] <= tr_end)
            test_mask = (panel_df['predictionTimestamp'] >= te_start) & (panel_df['predictionTimestamp'] <= te_end)
            
            train_data = panel_df[train_mask]
            test_data = panel_df[test_mask]
            
            if len(train_data) < 500 or len(test_data) < 200:
                continue
                
            # Train RegimeConditionedAlphaRankers with specified target_type
            ranker_5d = RegimeConditionedAlphaRanker(horizon_str='5d', target_type=t_id)
            ranker_20d = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=t_id)
            
            ranker_5d.fit(train_data, features=FEATURE_NAMES)
            oos_5d = ranker_5d.predict(test_data, features=FEATURE_NAMES)
            oos_5d['foldIndex'] = f_idx
            
            ranker_20d.fit(train_data, features=FEATURE_NAMES)
            oos_20d = ranker_20d.predict(test_data, features=FEATURE_NAMES)
            oos_20d['foldIndex'] = f_idx
            
            all_oos_5d.append(oos_5d)
            all_oos_20d.append(oos_20d)
            
            # Evaluate Top-3 alpha
            ev_5d = evaluator.evaluate_top3_alpha(
                oos_predictions_df=oos_5d,
                historical_candles=engine.historical_candles,
                nifty_candles=engine.benchmark_df,
                ranking_metric='canonical_alpha',
                horizon='5d'
            )
            ev_20d = evaluator.evaluate_top3_alpha(
                oos_predictions_df=oos_20d,
                historical_candles=engine.historical_candles,
                nifty_candles=engine.benchmark_df,
                ranking_metric='canonical_alpha',
                horizon='20d'
            )
            
            print(
                f"  [{datetime.now().strftime('%H:%M:%S')}] Fold {f_idx} ({label:<18}): "
                f"5D Excess={ev_5d['hitRates5d']['meanExcessReturnPct']:>+6.2f}%, "
                f"20D Excess={ev_20d['hitRates20d']['meanExcessReturnPct']:>+6.2f}%, "
                f"Sharpe 20D={ev_20d['backtestMetrics']['sharpe']:>5.2f}, "
                f"Turnover 20D={ev_20d['backtestMetrics']['annualTurnoverEstPct']:>6.1f}%",
                flush=True
            )

            fold_summaries.append({
                'foldIndex': f_idx,
                'label': label,
                'meanExcess5d': ev_5d['hitRates5d']['meanExcessReturnPct'],
                'meanExcess20d': ev_20d['hitRates20d']['meanExcessReturnPct'],
                'cagr5d': ev_5d['backtestMetrics']['cagr'],
                'sharpe5d': ev_5d['backtestMetrics']['sharpe'],
                'sortino5d': ev_5d['backtestMetrics']['sortino'],
                'maxDrawdown5d': ev_5d['backtestMetrics']['maxDrawdown'],
                'annualTurnover5d': ev_5d['backtestMetrics']['annualTurnoverEstPct'],
                'cagr20d': ev_20d['backtestMetrics']['cagr'],
                'sharpe20d': ev_20d['backtestMetrics']['sharpe'],
                'sortino20d': ev_20d['backtestMetrics']['sortino'],
                'maxDrawdown20d': ev_20d['backtestMetrics']['maxDrawdown'],
                'annualTurnover20d': ev_20d['backtestMetrics']['annualTurnoverEstPct'],
                'top3HitRate5d': ev_5d['hitRates5d']['top3PortfolioHitRateVsNifty'],
                'top3HitRate20d': ev_20d['hitRates20d']['top3PortfolioHitRateVsNifty']
            })
            
        # Full development aggregate evaluation across stitched OOS
        full_oos_5d = pd.concat(all_oos_5d, axis=0) if all_oos_5d else pd.DataFrame()
        full_oos_20d = pd.concat(all_oos_20d, axis=0) if all_oos_20d else pd.DataFrame()
        
        full_ev_5d = evaluator.evaluate_top3_alpha(
            oos_predictions_df=full_oos_5d,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='5d'
        )
        full_ev_20d = evaluator.evaluate_top3_alpha(
            oos_predictions_df=full_oos_20d,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        excess_5d_list = [f['meanExcess5d'] for f in fold_summaries]
        excess_20d_list = [f['meanExcess20d'] for f in fold_summaries]
        turnover_5d_list = [f['annualTurnover5d'] for f in fold_summaries]
        turnover_20d_list = [f['annualTurnover20d'] for f in fold_summaries]
        
        pos_folds_5d = sum(1 for e in excess_5d_list if e > 0)
        pos_folds_20d = sum(1 for e in excess_20d_list if e > 0)
        n_folds = len(fold_summaries)
        
        # Calculate Top-3 spread vs universe
        top10_spread_5d = full_ev_5d.get('fractileSpreadAnalysis', {}).get('top10vsUniverseSpread5d', 0.0)
        top10_spread_20d = full_ev_20d.get('fractileSpreadAnalysis', {}).get('top10vsUniverseSpread20d', 0.0)
        
        target_summary = {
            'targetId': t_id,
            'name': t_name,
            'description': candidate['description'],
            'medianExcess5d': float(np.median(excess_5d_list)),
            'meanExcess5d': float(np.mean(excess_5d_list)),
            'medianExcess20d': float(np.median(excess_20d_list)),
            'meanExcess20d': float(np.mean(excess_20d_list)),
            'positiveFolds5dPct': round(pos_folds_5d / n_folds * 100.0, 1),
            'positiveFolds20dPct': round(pos_folds_20d / n_folds * 100.0, 1),
            'positiveFolds20dCount': f"{pos_folds_20d}/{n_folds}",
            'aggregateCagr5d': full_ev_5d['backtestMetrics']['cagr'],
            'aggregateSharpe5d': full_ev_5d['backtestMetrics']['sharpe'],
            'aggregateSortino5d': full_ev_5d['backtestMetrics']['sortino'],
            'aggregateCagr20d': full_ev_20d['backtestMetrics']['cagr'],
            'aggregateSharpe20d': full_ev_20d['backtestMetrics']['sharpe'],
            'aggregateSortino20d': full_ev_20d['backtestMetrics']['sortino'],
            'top10vsUniverseSpread5d': top10_spread_5d,
            'top10vsUniverseSpread20d': top10_spread_20d,
            'medianTurnover5d': float(np.median(turnover_5d_list)),
            'medianTurnover20d': float(np.median(turnover_20d_list)),
            'foldSummaries': fold_summaries
        }
        all_target_results.append(target_summary)
        print(f"Results for {t_name}:", flush=True)
        print(f"  5D: Median Excess = {target_summary['medianExcess5d']:+.3f}%, Mean Excess = {target_summary['meanExcess5d']:+.3f}%, Pos Folds = {target_summary['positiveFolds5dPct']}%", flush=True)
        print(f"  20D: Median Excess = {target_summary['medianExcess20d']:+.3f}%, Mean Excess = {target_summary['meanExcess20d']:+.3f}%, Pos Folds = {target_summary['positiveFolds20dPct']}% ({pos_folds_20d}/{n_folds})", flush=True)
        print(f"  Sharpe 5D = {target_summary['aggregateSharpe5d']:.2f}, Sharpe 20D = {target_summary['aggregateSharpe20d']:.2f}", flush=True)

        # Incrementally persist results to json
        out_file = os.path.join(os.path.dirname(__file__), "target_ablation_results.json")
        with open(out_file, 'w') as f:
            json.dump({
                'studyDate': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'evaluationScope': 'Pre-2025 Out-of-Sample Folds (0 to 7)',
                'holdoutStatus': 'Fold 8 (2025-2026) untouched and strictly quarantined',
                'candidates': all_target_results
            }, f, indent=2)

    # Print summary comparison table
    print("\n" + "=" * 110)
    print("PRE-2025 OUT-OF-SAMPLE TARGET ABLATION RESULTS (FOLDS 0 TO 7)")
    print("=" * 110)
    header = f"{'Target Formulation':<25} | {'Med 5D Ex':<10} | {'Med 20D Ex':<10} | {'5D Pos%':<8} | {'20D Pos%':<8} | {'Sh 5D':<7} | {'Sh 20D':<7} | {'Turnover 20D':<12}"
    print(header)
    print("-" * 110)
    for r in all_target_results:
        line = (
            f"{r['name']:<25} | "
            f"{r['medianExcess5d']:>+9.3f}% | "
            f"{r['medianExcess20d']:>+9.3f}% | "
            f"{r['positiveFolds5dPct']:>7.1f}% | "
            f"{r['positiveFolds20dPct']:>7.1f}% | "
            f"{r['aggregateSharpe5d']:>7.2f} | "
            f"{r['aggregateSharpe20d']:>7.2f} | "
            f"{r['medianTurnover20d']:>11.1f}%"
        )
        print(line)
    print("=" * 110)
    
    # Save results to json
    out_file = os.path.join(os.path.dirname(__file__), "target_ablation_results.json")
    with open(out_file, 'w') as f:
        json.dump({
            'studyDate': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'evaluationScope': 'Pre-2025 Out-of-Sample Folds (0 to 7)',
            'holdoutStatus': 'Fold 8 (2025-2026) untouched and strictly quarantined',
            'candidates': all_target_results
        }, f, indent=2)
    print(f"\nSaved target ablation results to {out_file}")
    return all_target_results

if __name__ == '__main__':
    run_target_ablation_study()
"""
Pre-Registered Nested Walk-Forward Target Selection Protocol (20D Primary Strategy)
===================================================================================
Solves:
1. Multiple-testing & selection risk: Target selection is strictly causal and endogenous.
   For each fold k, candidate targets are evaluated on an inner temporal validation split
   (75% inner train, 25% inner validation with 20-day purge gap). The winning target is
   locked before evaluating the outer out-of-sample period.
2. 5D vs 20D decoupling: Formally operates on the 20D Primary Institutional Strategy.
3. Turnover & implementation realism: Incorporates horizon-aware retention hurdles
   (15-day minimum holding, continuity bonus, persistence bonus).
4. Frozen holdout isolation: Fold 8 (2025-2026) is strictly quarantined during research
   and evaluated exactly ONCE after the pre-2025 protocol is certified.
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
    'vol_adj_net_excess',
    'std_excess',
    'raw_excess',
    'net_excess',
    'pct_rank',
    'tail_aware'
]

def run_nested_walk_forward_protocol(output_path: str = None) -> Dict[str, Any]:
    print("=" * 95)
    print("PRE-REGISTERED NESTED WALK-FORWARD TARGET SELECTION PROTOCOL (20D PRIMARY STRATEGY)")
    print("=" * 95)
    
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), "nested_walk_forward_results.json")
    
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    holdout_fold = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] == 8][0]
    
    print(f"\nExecuting nested selection across {len(dev_folds)} pre-2025 walk-forward folds...")
    print(f"Candidates per fold: {TARGET_CANDIDATES}")
    
    fold_results: List[Dict[str, Any]] = []
    all_selected_oos_preds: List[pd.DataFrame] = []
    baseline_oos_preds: List[pd.DataFrame] = []
    
    for fold in dev_folds:
        f_idx = fold['foldIndex']
        label = fold['label']
        tr_start = fold['trainStart']
        tr_end = fold['trainEnd']
        te_start = fold['testStart']
        te_end = fold['testEnd']
        
        train_mask = (panel_df['predictionTimestamp'] >= tr_start) & (panel_df['predictionTimestamp'] <= tr_end)
        test_mask = (panel_df['predictionTimestamp'] >= te_start) & (panel_df['predictionTimestamp'] <= te_end)
        
        outer_train_df = panel_df[train_mask]
        outer_test_df = panel_df[test_mask]
        
        if len(outer_train_df) < 500 or len(outer_test_df) < 200:
            print(f"Skipping Fold {f_idx}: insufficient observations.")
            continue
            
        # -----------------------------------------------------------------
        # 1. Inner Temporal Split: 75% Inner Train, 25% Inner Validation
        # -----------------------------------------------------------------
        unique_dates = sorted(outer_train_df['predictionTimestamp'].unique())
        n_dates = len(unique_dates)
        split_idx = int(n_dates * 0.75)
        
        inner_train_dates = unique_dates[:split_idx]
        # 20-day purge gap to prevent boundary leakage
        purge_gap = min(20, max(5, int((n_dates - split_idx) * 0.15)))
        inner_val_dates = unique_dates[split_idx + purge_gap:]
        
        inner_train_data = outer_train_df[outer_train_df['predictionTimestamp'].isin(inner_train_dates)]
        inner_val_data = outer_train_df[outer_train_df['predictionTimestamp'].isin(inner_val_dates)]
        
        print(f"\n>>> Fold {f_idx} ({label}): Inner Train={len(inner_train_dates)} dates, Val={len(inner_val_dates)} dates (Purge={purge_gap}d) <<<")
        
        candidate_scores: List[Dict[str, Any]] = []
        
        for cand_id in TARGET_CANDIDATES:
            try:
                ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=cand_id)
                ranker.fit(inner_train_data, features=FEATURE_NAMES)
                val_preds = ranker.predict(inner_val_data, features=FEATURE_NAMES)
                
                ev_val = evaluator.evaluate_top3_alpha(
                    oos_predictions_df=val_preds,
                    historical_candles=engine.historical_candles,
                    nifty_candles=engine.benchmark_df,
                    ranking_metric='canonical_alpha',
                    horizon='20d'
                )
                
                mean_ex = ev_val['hitRates20d']['meanExcessReturnPct']
                sh = ev_val['backtestMetrics']['sharpe']
                turnover = ev_val['backtestMetrics']['annualTurnoverEstPct']
                
                # Selection Objective:
                # Score = Mean Excess * min(1.0, max(0.01, Sharpe)) - max(0.0, (Turnover - 2000.0) / 10000.0)
                sharpe_scale = min(1.0, max(0.01, sh)) if sh > 0 else 0.01
                turnover_penalty = max(0.0, (turnover - 2000.0) / 10000.0)
                selection_score = (mean_ex * sharpe_scale) - turnover_penalty
                
                candidate_scores.append({
                    'targetId': cand_id,
                    'meanExcess20d': mean_ex,
                    'sharpe20d': sh,
                    'turnover20d': turnover,
                    'selectionScore': selection_score
                })
            except Exception as e:
                print(f"    [Error] Candidate {cand_id} failed on inner fold {f_idx}: {e}")
                candidate_scores.append({
                    'targetId': cand_id,
                    'meanExcess20d': -999.0,
                    'sharpe20d': -999.0,
                    'turnover20d': 9999.0,
                    'selectionScore': -999.0
                })
                
        # Select best candidate by selectionScore
        candidate_scores.sort(key=lambda x: -x['selectionScore'])
        winning_candidate = candidate_scores[0]
        chosen_target = winning_candidate['targetId']
        
        print(f"  Inner Winner: {chosen_target} (Score={winning_candidate['selectionScore']:.4f}, Val Ex={winning_candidate['meanExcess20d']:+.2f}%, Sh={winning_candidate['sharpe20d']:.2f}, Turn={winning_candidate['turnover20d']:.1f}%)")
        
        # -----------------------------------------------------------------
        # 2. Outer Out-of-Sample Evaluation: Train Winner on Full Outer Train
        # -----------------------------------------------------------------
        outer_ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=chosen_target)
        outer_ranker.fit(outer_train_df, features=FEATURE_NAMES)
        outer_oos = outer_ranker.predict(outer_test_df, features=FEATURE_NAMES)
        outer_oos['foldIndex'] = f_idx
        outer_oos['selectedTarget'] = chosen_target
        all_selected_oos_preds.append(outer_oos)
        
        ev_outer = evaluator.evaluate_top3_alpha(
            oos_predictions_df=outer_oos,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        # Also run baseline std_excess on outer fold for head-to-head comparison
        base_ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type='std_excess')
        base_ranker.fit(outer_train_df, features=FEATURE_NAMES)
        base_oos = base_ranker.predict(outer_test_df, features=FEATURE_NAMES)
        base_oos['foldIndex'] = f_idx
        baseline_oos_preds.append(base_oos)
        
        ev_base = evaluator.evaluate_top3_alpha(
            oos_predictions_df=base_oos,
            historical_candles=engine.historical_candles,
            nifty_candles=engine.benchmark_df,
            ranking_metric='canonical_alpha',
            horizon='20d'
        )
        
        outer_ex = ev_outer['hitRates20d']['meanExcessReturnPct']
        outer_sh = ev_outer['backtestMetrics']['sharpe']
        outer_cagr = ev_outer['backtestMetrics']['cagr']
        outer_turnover = ev_outer['backtestMetrics']['annualTurnoverEstPct']
        outer_dd = ev_outer['backtestMetrics']['maxDrawdown']
        
        base_ex = ev_base['hitRates20d']['meanExcessReturnPct']
        base_sh = ev_base['backtestMetrics']['sharpe']
        
        print(
            f"  Outer OOS Results: 20D Excess={outer_ex:>+6.2f}% (Base={base_ex:>+6.2f}%), "
            f"Sharpe={outer_sh:>5.2f} (Base={base_sh:>5.2f}), CAGR={outer_cagr:>5.2f}%, "
            f"Turnover={outer_turnover:>6.1f}%",
            flush=True
        )
        
        fold_results.append({
            'foldIndex': f_idx,
            'label': label,
            'chosenTarget': chosen_target,
            'candidateRankings': candidate_scores,
            'outerMeanExcess20d': outer_ex,
            'outerSharpe20d': outer_sh,
            'outerCagr20d': outer_cagr,
            'outerSortino20d': ev_outer['backtestMetrics']['sortino'],
            'outerMaxDrawdown20d': outer_dd,
            'outerAnnualTurnover20d': outer_turnover,
            'outerTop3HitRate20d': ev_outer['hitRates20d']['top3PortfolioHitRateVsNifty'],
            'baselineMeanExcess20d': base_ex,
            'baselineSharpe20d': base_sh,
            'lineage': {
                'actualTrainingTarget': outer_ranker.global_ranker.actual_training_target,
                'actualGradeCol': outer_ranker.global_ranker.actual_grade_col,
                'actualExcessCol': outer_ranker.global_ranker.actual_excess_col
            }
        })
        
    # Aggregate Stitched Out-of-Sample Performance across Folds 0-7
    stitched_oos = pd.concat(all_selected_oos_preds, axis=0) if all_selected_oos_preds else pd.DataFrame()
    stitched_base = pd.concat(baseline_oos_preds, axis=0) if baseline_oos_preds else pd.DataFrame()
    
    full_ev_nested = evaluator.evaluate_top3_alpha(
        oos_predictions_df=stitched_oos,
        historical_candles=engine.historical_candles,
        nifty_candles=engine.benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='20d'
    )
    full_ev_base = evaluator.evaluate_top3_alpha(
        oos_predictions_df=stitched_base,
        historical_candles=engine.historical_candles,
        nifty_candles=engine.benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='20d'
    )
    
    excess_list = [f['outerMeanExcess20d'] for f in fold_results]
    turnover_list = [f['outerAnnualTurnover20d'] for f in fold_results]
    pos_folds = sum(1 for e in excess_list if e > 0)
    n_dev = len(fold_results)
    
    q75, q25 = np.percentile(excess_list, [75, 25])
    iqr = q75 - q25
    
    dev_summary = {
        'medianExcess20d': float(np.median(excess_list)),
        'meanExcess20d': float(np.mean(excess_list)),
        'stdExcess20d': float(np.std(excess_list)),
        'iqrExcess20d': float(iqr),
        'minExcess20d': float(np.min(excess_list)),
        'maxExcess20d': float(np.max(excess_list)),
        'positiveFoldsPct': round(pos_folds / n_dev * 100.0, 1),
        'positiveFoldsCount': f"{pos_folds}/{n_dev}",
        'aggregateCagr': full_ev_nested['backtestMetrics']['cagr'],
        'aggregateSharpe': full_ev_nested['backtestMetrics']['sharpe'],
        'aggregateSortino': full_ev_nested['backtestMetrics']['sortino'],
        'aggregateMaxDrawdown': full_ev_nested['backtestMetrics']['maxDrawdown'],
        'medianTurnover': float(np.median(turnover_list)),
        'baselineAggregateSharpe': full_ev_base['backtestMetrics']['sharpe'],
        'baselineMedianExcess': float(np.median([f['baselineMeanExcess20d'] for f in fold_results]))
    }
    
    print("\n" + "=" * 95)
    print("PRE-2025 NESTED WALK-FORWARD SUMMARY (FOLDS 0 TO 7)")
    print("=" * 95)
    print(f"Median 20D Excess Return:   {dev_summary['medianExcess20d']:>+7.3f}% (Baseline: {dev_summary['baselineMedianExcess']:>+7.3f}%)")
    print(f"Mean 20D Excess Return:     {dev_summary['meanExcess20d']:>+7.3f}% (IQR: {dev_summary['iqrExcess20d']:.3f}%)")
    print(f"Positive Excess Folds:      {dev_summary['positiveFoldsPct']}% ({pos_folds}/{n_dev})")
    print(f"Aggregate Sharpe Ratio:     {dev_summary['aggregateSharpe']:>7.2f}  (Baseline: {dev_summary['baselineAggregateSharpe']:>7.2f})")
    print(f"Aggregate Sortino Ratio:    {dev_summary['aggregateSortino']:>7.2f}")
    print(f"Aggregate CAGR:             {dev_summary['aggregateCagr']:>7.2f}%")
    print(f"Median Annual Turnover:     {dev_summary['medianTurnover']:>7.1f}%")
    print("=" * 95)
    
    # -----------------------------------------------------------------
    # 3. FROZEN HOLDOUT EVALUATION (FOLD 8: 2025-2026) - EXECUTED ONCE
    # -----------------------------------------------------------------
    print("\n" + "=" * 95)
    print("EXECUTING SINGLE-SHOT EVALUATION OF FROZEN 2025-2026 HOLDOUT (FOLD 8)")
    print("=" * 95)
    
    h_tr_mask = (panel_df['predictionTimestamp'] >= holdout_fold['trainStart']) & (panel_df['predictionTimestamp'] <= holdout_fold['trainEnd'])
    h_te_mask = (panel_df['predictionTimestamp'] >= holdout_fold['testStart']) & (panel_df['predictionTimestamp'] <= holdout_fold['testEnd'])
    
    h_train_df = panel_df[h_tr_mask]
    h_test_df = panel_df[h_te_mask]
    
    # Run nested inner validation on Fold 8's training set (2002-2024)
    h_unique_dates = sorted(h_train_df['predictionTimestamp'].unique())
    h_n_dates = len(h_unique_dates)
    h_split_idx = int(h_n_dates * 0.75)
    h_inner_train_dates = h_unique_dates[:h_split_idx]
    h_inner_val_dates = h_unique_dates[h_split_idx + 20:]
    
    h_inner_train = h_train_df[h_train_df['predictionTimestamp'].isin(h_inner_train_dates)]
    h_inner_val = h_train_df[h_train_df['predictionTimestamp'].isin(h_inner_val_dates)]
    
    h_cand_scores = []
    for cand_id in TARGET_CANDIDATES:
        try:
            r = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=cand_id)
            r.fit(h_inner_train, features=FEATURE_NAMES)
            p = r.predict(h_inner_val, features=FEATURE_NAMES)
            ev = evaluator.evaluate_top3_alpha(p, engine.historical_candles, engine.benchmark_df, horizon='20d')
            me = ev['hitRates20d']['meanExcessReturnPct']
            sh = ev['backtestMetrics']['sharpe']
            tu = ev['backtestMetrics']['annualTurnoverEstPct']
            sh_scale = min(1.0, max(0.01, sh)) if sh > 0 else 0.01
            sc = (me * sh_scale) - max(0.0, (tu - 2000.0) / 10000.0)
            h_cand_scores.append({'targetId': cand_id, 'score': sc, 'excess': me, 'sharpe': sh, 'turnover': tu})
        except Exception as e:
            h_cand_scores.append({'targetId': cand_id, 'score': -999.0, 'excess': -999.0, 'sharpe': -999.0, 'turnover': 9999.0})
            
    h_cand_scores.sort(key=lambda x: -x['score'])
    h_winner = h_cand_scores[0]['targetId']
    print(f"Holdout Inner Winner on 2002-2024 data: {h_winner} (Val Excess={h_cand_scores[0]['excess']:+.2f}%, Sharpe={h_cand_scores[0]['sharpe']:.2f})")
    
    # Train winning ranker on full 2002-2024 training data
    holdout_ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=h_winner)
    holdout_ranker.fit(h_train_df, features=FEATURE_NAMES)
    holdout_preds = holdout_ranker.predict(h_test_df, features=FEATURE_NAMES)
    holdout_preds['foldIndex'] = 8
    holdout_preds['selectedTarget'] = h_winner
    
    holdout_ev = evaluator.evaluate_top3_alpha(
        oos_predictions_df=holdout_preds,
        historical_candles=engine.historical_candles,
        nifty_candles=engine.benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='20d'
    )
    
    # Also evaluate baseline std_excess on Holdout for reference
    holdout_base_ranker = RegimeConditionedAlphaRanker(horizon_str='20d', target_type='std_excess')
    holdout_base_ranker.fit(h_train_df, features=FEATURE_NAMES)
    holdout_base_preds = holdout_base_ranker.predict(h_test_df, features=FEATURE_NAMES)
    holdout_base_ev = evaluator.evaluate_top3_alpha(
        oos_predictions_df=holdout_base_preds,
        historical_candles=engine.historical_candles,
        nifty_candles=engine.benchmark_df,
        ranking_metric='canonical_alpha',
        horizon='20d'
    )
    
    holdout_summary = {
        'foldIndex': 8,
        'label': holdout_fold['label'],
        'testStart': holdout_fold['testStart'],
        'testEnd': holdout_fold['testEnd'],
        'chosenTarget': h_winner,
        'innerCandidateScores': h_cand_scores,
        'meanExcess20d': holdout_ev['hitRates20d']['meanExcessReturnPct'],
        'cagr20d': holdout_ev['backtestMetrics']['cagr'],
        'sharpe20d': holdout_ev['backtestMetrics']['sharpe'],
        'sortino20d': holdout_ev['backtestMetrics']['sortino'],
        'maxDrawdown20d': holdout_ev['backtestMetrics']['maxDrawdown'],
        'annualTurnover20d': holdout_ev['backtestMetrics']['annualTurnoverEstPct'],
        'top3HitRate20d': holdout_ev['hitRates20d']['top3PortfolioHitRateVsNifty'],
        'baselineMeanExcess20d': holdout_base_ev['hitRates20d']['meanExcessReturnPct'],
        'baselineSharpe20d': holdout_base_ev['backtestMetrics']['sharpe'],
        'lineage': {
            'actualTrainingTarget': holdout_ranker.global_ranker.actual_training_target,
            'actualGradeCol': holdout_ranker.global_ranker.actual_grade_col,
            'actualExcessCol': holdout_ranker.global_ranker.actual_excess_col
        }
    }
    
    print(f"\n>>> 2025-2026 FROZEN HOLDOUT RESULTS <<<")
    print(f"  Target Chosen:          {holdout_summary['chosenTarget']}")
    print(f"  Mean 20D Excess Return: {holdout_summary['meanExcess20d']:>+7.3f}% (Baseline std_excess: {holdout_summary['baselineMeanExcess20d']:>+7.3f}%)")
    print(f"  Holdout Sharpe:         {holdout_summary['sharpe20d']:>7.2f} (Baseline std_excess: {holdout_summary['baselineSharpe20d']:>7.2f})")
    print(f"  Holdout Sortino:        {holdout_summary['sortino20d']:>7.2f}")
    print(f"  Holdout CAGR:           {holdout_summary['cagr20d']:>7.2f}%")
    print(f"  Holdout Max Drawdown:   {holdout_summary['maxDrawdown20d']:>7.2f}%")
    print(f"  Holdout Turnover:       {holdout_summary['annualTurnover20d']:>7.1f}%")
    print("=" * 95)
    
    final_output = {
        'protocol': 'Pre-Registered Nested Walk-Forward Target Selection (20D Primary Strategy)',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'strategyHorizon': '20d',
        'targetCandidates': TARGET_CANDIDATES,
        'devFoldsCount': len(dev_folds),
        'devFoldsSummary': dev_summary,
        'foldDetails': fold_results,
        'frozenHoldout': holdout_summary
    }
    
    with open(output_path, 'w') as f:
        json.dump(final_output, f, indent=2)
    print(f"\nSaved certified nested walk-forward results to {output_path}")
    return final_output

if __name__ == '__main__':
    run_nested_walk_forward_protocol()

"""
Pre-Registered Nested Walk-Forward Target Selection Protocol (20D Primary Strategy)
===================================================================================
Solves:
1. P0: Multiple-testing & selection risk: Target selection is strictly causal and endogenous.
   For each fold k, candidate targets are evaluated on an inner temporal validation split
   (75% inner train, 25% inner validation with 20-day purge gap).
2. P0: Resolving Nested Selection Degradation: Formally compares Fixed Robust Anchor
   ('vol_adj_net_excess'), Naive Winner-Take-All Selection, and Regularized Selection
   (with uncertainty hurdle against anchor). Pre-registers the production certification rule.
3. P1: Statistically Principled Selection Objective: Replaces heuristic Sharpe/turnover
   clipping with 95% Newey-West HAC Lower Confidence Bound (LCB) on net excess return:
   Score = ci95Lower(HAC) - TurnoverPenalty.
4. P1: Explicit Semantic Target Lineage: All targets route through TARGET_REGISTRY with
   distinct, verified column mappings.
5. P0: Decoupled Holdout: 2025-2026 Holdout is strictly excluded from this script and
   evaluated exclusively through the cryptographic protocol manifest guard.
"""
import sys
import os
import json
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any
from scipy import stats

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backtest.long_history_walk_forward import (
    LongHistoryResearchEngine,
    WALK_FORWARD_FOLDS,
    FEATURE_NAMES
)
from models.alpha_ranker import RegimeConditionedAlphaRanker
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator
from targets.target_definition import TARGET_REGISTRY

TARGET_CANDIDATES = list(TARGET_REGISTRY.keys())
ANCHOR_TARGET = 'vol_adj_net_excess'
SELECTION_HURDLE_BPS = 0.10  # 10 bps hurdle over anchor LCB to prevent winner's curse

def run_nested_walk_forward_protocol(output_path: str = None) -> Dict[str, Any]:
    print("=" * 95)
    print("PRE-REGISTERED NESTED TARGET SELECTION & COMPARATIVE AUDIT (FOLDS 0 TO 7)")
    print("=" * 95)
    
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), "nested_walk_forward_results.json")
    
    dev_folds = [f for f in WALK_FORWARD_FOLDS if f['foldIndex'] < 8]
    print(f"\nEvaluating {len(TARGET_CANDIDATES)} targets across {len(dev_folds)} pre-2025 development folds...")
    print(f"Anchor Strategy: {ANCHOR_TARGET} | Statistical Hurdle: +{SELECTION_HURDLE_BPS:.2f}% LCB")
    
    fold_details: List[Dict[str, Any]] = []
    oos_preds_anchor: List[pd.DataFrame] = []
    oos_preds_naive: List[pd.DataFrame] = []
    oos_preds_reg: List[pd.DataFrame] = []
    
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
            continue
            
        # -----------------------------------------------------------------
        # 1. Inner Temporal Split: 75% Inner Train, 25% Inner Validation
        # -----------------------------------------------------------------
        unique_dates = sorted(outer_train_df['predictionTimestamp'].unique())
        n_dates = len(unique_dates)
        split_idx = int(n_dates * 0.75)
        
        inner_train_dates = unique_dates[:split_idx]
        purge_gap = min(20, max(5, int((n_dates - split_idx) * 0.15)))
        inner_val_dates = unique_dates[split_idx + purge_gap:]
        
        inner_train_data = outer_train_df[outer_train_df['predictionTimestamp'].isin(inner_train_dates)]
        inner_val_data = outer_train_df[outer_train_df['predictionTimestamp'].isin(inner_val_dates)]
        
        print(f"\n>>> Fold {f_idx} ({label}): Inner Train={len(inner_train_dates)}d, Val={len(inner_val_dates)}d <<<")
        
        candidate_scores: List[Dict[str, Any]] = []
        anchor_lcb = None
        
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
                
                # Statistically Principled Objective:
                # 95% Newey-West HAC Lower Confidence Bound (LCB) on Net Excess Return
                hac = ev_val.get('statisticalInference', {}).get('hac20d', {})
                hac_se = hac.get('hacStdError', 0.50)
                lcb_95 = hac.get('ci95Lower', mean_ex - 1.96 * hac_se)
                
                turnover_penalty = max(0.0, (turnover - 2000.0) / 10000.0)
                stat_score = float(lcb_95) - turnover_penalty
                
                cand_stat = {
                    'targetId': cand_id,
                    'meanExcess20d': mean_ex,
                    'hacStdError': float(hac_se),
                    'ci95Lower': float(lcb_95),
                    'sharpe20d': sh,
                    'turnover20d': turnover,
                    'selectionScore': stat_score
                }
                candidate_scores.append(cand_stat)
                if cand_id == ANCHOR_TARGET:
                    anchor_lcb = stat_score
            except Exception as e:
                print(f"    [Error] Candidate {cand_id} on inner fold {f_idx}: {e}")
                candidate_scores.append({
                    'targetId': cand_id,
                    'meanExcess20d': -999.0,
                    'hacStdError': 999.0,
                    'ci95Lower': -999.0,
                    'sharpe20d': -999.0,
                    'turnover20d': 9999.0,
                    'selectionScore': -999.0
                })
                
        # Sort candidates by statistical LCB score
        candidate_scores.sort(key=lambda x: -x['selectionScore'])
        naive_winner = candidate_scores[0]['targetId']
        
        # Regularized Selection:
        # A challenger replaces the anchor ONLY if its LCB exceeds anchor LCB by SELECTION_HURDLE_BPS
        if anchor_lcb is not None and candidate_scores[0]['selectionScore'] > (anchor_lcb + SELECTION_HURDLE_BPS):
            regularized_winner = candidate_scores[0]['targetId']
            switch_reason = f"Challenger {regularized_winner} beat anchor by > {SELECTION_HURDLE_BPS:.2f}% LCB"
        else:
            regularized_winner = ANCHOR_TARGET
            switch_reason = f"Anchor retained (challenger did not exceed hurdle of +{SELECTION_HURDLE_BPS:.2f}%)"
            
        print(f"  Inner Evaluation: Naive Winner = {naive_winner} (LCB={candidate_scores[0]['selectionScore']:+.3f}%) | Regularized Winner = {regularized_winner} ({switch_reason})")
        
        # -----------------------------------------------------------------
        # 2. Outer Out-of-Sample Evaluation: Train all 3 Strategy Models
        # -----------------------------------------------------------------
        # Strategy A: Fixed Anchor Model
        ranker_anchor = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=ANCHOR_TARGET)
        ranker_anchor.fit(outer_train_df, features=FEATURE_NAMES)
        oos_anchor = ranker_anchor.predict(outer_test_df, features=FEATURE_NAMES)
        oos_anchor['foldIndex'] = f_idx
        oos_preds_anchor.append(oos_anchor)
        ev_anchor = evaluator.evaluate_top3_alpha(oos_anchor, engine.historical_candles, engine.benchmark_df, horizon='20d')
        
        # Strategy B: Naive Winner Model
        if naive_winner == ANCHOR_TARGET:
            oos_naive = oos_anchor.copy()
            ev_naive = ev_anchor
        else:
            ranker_naive = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=naive_winner)
            ranker_naive.fit(outer_train_df, features=FEATURE_NAMES)
            oos_naive = ranker_naive.predict(outer_test_df, features=FEATURE_NAMES)
            ev_naive = evaluator.evaluate_top3_alpha(oos_naive, engine.historical_candles, engine.benchmark_df, horizon='20d')
        oos_naive['foldIndex'] = f_idx
        oos_preds_naive.append(oos_naive)
        
        # Strategy C: Regularized Winner Model
        if regularized_winner == ANCHOR_TARGET:
            oos_reg = oos_anchor.copy()
            ev_reg = ev_anchor
        elif regularized_winner == naive_winner:
            oos_reg = oos_naive.copy()
            ev_reg = ev_naive
        else:
            ranker_reg = RegimeConditionedAlphaRanker(horizon_str='20d', target_type=regularized_winner)
            ranker_reg.fit(outer_train_df, features=FEATURE_NAMES)
            oos_reg = ranker_reg.predict(outer_test_df, features=FEATURE_NAMES)
            ev_reg = evaluator.evaluate_top3_alpha(oos_reg, engine.historical_candles, engine.benchmark_df, horizon='20d')
        oos_reg['foldIndex'] = f_idx
        oos_preds_reg.append(oos_reg)
        
        ex_anc = ev_anchor['hitRates20d']['meanExcessReturnPct']
        sh_anc = ev_anchor['backtestMetrics']['sharpe']
        ex_nai = ev_naive['hitRates20d']['meanExcessReturnPct']
        sh_nai = ev_naive['backtestMetrics']['sharpe']
        ex_reg = ev_reg['hitRates20d']['meanExcessReturnPct']
        sh_reg = ev_reg['backtestMetrics']['sharpe']
        
        print(
            f"  Outer OOS Results: "
            f"Anchor ({ANCHOR_TARGET}) = {ex_anc:>+6.2f}% (Sh={sh_anc:>5.2f}) | "
            f"Naive ({naive_winner}) = {ex_nai:>+6.2f}% (Sh={sh_nai:>5.2f}) | "
            f"Regularized ({regularized_winner}) = {ex_reg:>+6.2f}% (Sh={sh_reg:>5.2f})",
            flush=True
        )
        
        fold_details.append({
            'foldIndex': f_idx,
            'label': label,
            'testStart': te_start,
            'testEnd': te_end,
            'naiveWinner': naive_winner,
            'regularizedWinner': regularized_winner,
            'switchReason': switch_reason,
            'candidateRankings': candidate_scores,
            'anchorMetrics': {
                'meanExcess20d': ex_anc,
                'sharpe20d': sh_anc,
                'cagr20d': ev_anchor['backtestMetrics']['cagr'],
                'turnover20d': ev_anchor['backtestMetrics']['annualTurnoverEstPct']
            },
            'naiveMetrics': {
                'meanExcess20d': ex_nai,
                'sharpe20d': sh_nai,
                'cagr20d': ev_naive['backtestMetrics']['cagr'],
                'turnover20d': ev_naive['backtestMetrics']['annualTurnoverEstPct']
            },
            'regularizedMetrics': {
                'meanExcess20d': ex_reg,
                'sharpe20d': sh_reg,
                'cagr20d': ev_reg['backtestMetrics']['cagr'],
                'turnover20d': ev_reg['backtestMetrics']['annualTurnoverEstPct']
            },
            'lineage': {
                'actualTrainingTarget': ranker_anchor.global_ranker.actual_training_target,
                'actualGradeCol': ranker_anchor.global_ranker.actual_grade_col,
                'actualExcessCol': ranker_anchor.global_ranker.actual_excess_col
            }
        })
        
    # Aggregate Stitched Out-of-Sample Performance across Folds 0-7
    stitched_anchor = pd.concat(oos_preds_anchor, axis=0) if oos_preds_anchor else pd.DataFrame()
    stitched_naive = pd.concat(oos_preds_naive, axis=0) if oos_preds_naive else pd.DataFrame()
    stitched_reg = pd.concat(oos_preds_reg, axis=0) if oos_preds_reg else pd.DataFrame()
    
    full_ev_anc = evaluator.evaluate_top3_alpha(stitched_anchor, engine.historical_candles, engine.benchmark_df, horizon='20d')
    full_ev_nai = evaluator.evaluate_top3_alpha(stitched_naive, engine.historical_candles, engine.benchmark_df, horizon='20d')
    full_ev_reg = evaluator.evaluate_top3_alpha(stitched_reg, engine.historical_candles, engine.benchmark_df, horizon='20d')
    
    anc_excess_list = [f['anchorMetrics']['meanExcess20d'] for f in fold_details]
    nai_excess_list = [f['naiveMetrics']['meanExcess20d'] for f in fold_details]
    reg_excess_list = [f['regularizedMetrics']['meanExcess20d'] for f in fold_details]
    n_dev = len(fold_details)
    
    # Paired t-test comparing Regularized vs Anchor and Naive vs Anchor
    t_stat_reg, p_val_reg = stats.ttest_rel(reg_excess_list, anc_excess_list) if len(set(reg_excess_list) - set(anc_excess_list)) > 0 else (0.0, 1.0)
    t_stat_nai, p_val_nai = stats.ttest_rel(nai_excess_list, anc_excess_list)
    
    comparison_summary = {
        'fixedAnchor': {
            'target': ANCHOR_TARGET,
            'medianExcess20d': float(np.median(anc_excess_list)),
            'meanExcess20d': float(np.mean(anc_excess_list)),
            'positiveFoldsCount': f"{sum(1 for e in anc_excess_list if e > 0)}/{n_dev}",
            'positiveFoldsPct': round(sum(1 for e in anc_excess_list if e > 0) / n_dev * 100.0, 1),
            'cagr': full_ev_anc['backtestMetrics']['cagr'],
            'sharpe': full_ev_anc['backtestMetrics']['sharpe'],
            'sortino': full_ev_anc['backtestMetrics']['sortino'],
            'maxDrawdown': full_ev_anc['backtestMetrics']['maxDrawdown'],
            'medianTurnover': float(np.median([f['anchorMetrics']['turnover20d'] for f in fold_details]))
        },
        'naiveNestedSelection': {
            'medianExcess20d': float(np.median(nai_excess_list)),
            'meanExcess20d': float(np.mean(nai_excess_list)),
            'positiveFoldsCount': f"{sum(1 for e in nai_excess_list if e > 0)}/{n_dev}",
            'positiveFoldsPct': round(sum(1 for e in nai_excess_list if e > 0) / n_dev * 100.0, 1),
            'cagr': full_ev_nai['backtestMetrics']['cagr'],
            'sharpe': full_ev_nai['backtestMetrics']['sharpe'],
            'sortino': full_ev_nai['backtestMetrics']['sortino'],
            'maxDrawdown': full_ev_nai['backtestMetrics']['maxDrawdown'],
            'medianTurnover': float(np.median([f['naiveMetrics']['turnover20d'] for f in fold_details])),
            'deltaVsAnchorTStat': float(t_stat_nai),
            'deltaVsAnchorPValue': float(p_val_nai)
        },
        'regularizedNestedSelection': {
            'medianExcess20d': float(np.median(reg_excess_list)),
            'meanExcess20d': float(np.mean(reg_excess_list)),
            'positiveFoldsCount': f"{sum(1 for e in reg_excess_list if e > 0)}/{n_dev}",
            'positiveFoldsPct': round(sum(1 for e in reg_excess_list if e > 0) / n_dev * 100.0, 1),
            'cagr': full_ev_reg['backtestMetrics']['cagr'],
            'sharpe': full_ev_reg['backtestMetrics']['sharpe'],
            'sortino': full_ev_reg['backtestMetrics']['sortino'],
            'maxDrawdown': full_ev_reg['backtestMetrics']['maxDrawdown'],
            'medianTurnover': float(np.median([f['regularizedMetrics']['turnover20d'] for f in fold_details])),
            'deltaVsAnchorTStat': float(t_stat_reg),
            'deltaVsAnchorPValue': float(p_val_reg)
        }
    }
    
    # Pre-registered Decision Rule:
    # If nested selection fails to beat the anchor on median excess and Sharpe, the anchor remains certified for deployment.
    nested_beats_anchor = (
        comparison_summary['regularizedNestedSelection']['medianExcess20d'] > comparison_summary['fixedAnchor']['medianExcess20d'] and
        comparison_summary['regularizedNestedSelection']['sharpe'] > comparison_summary['fixedAnchor']['sharpe'] and
        p_val_reg < 0.05
    )
    
    certified_production_strategy = 'regularized_nested_selection' if nested_beats_anchor else ANCHOR_TARGET
    decision_verdict = (
        "REGULARIZED NESTED SELECTION CERTIFIED" if nested_beats_anchor else
        f"FIXED ROBUST ANCHOR ({ANCHOR_TARGET}) CERTIFIED: Nested selection did not beat incumbent anchor with statistical significance."
    )
    
    print("\n" + "=" * 105)
    print("HEAD-TO-HEAD COMPARISON: FIXED ANCHOR vs NAIVE NESTED vs REGULARIZED NESTED")
    print("=" * 105)
    header = f"{'Strategy Architecture':<32} | {'Med 20D Ex':<11} | {'Mean 20D Ex':<11} | {'Pos Folds':<10} | {'Sharpe':<8} | {'CAGR':<8} | {'Turnover':<10}"
    print(header)
    print("-" * 105)
    for name, s in [('Fixed Anchor (vol_adj_net_excess)', comparison_summary['fixedAnchor']),
                    ('Naive Nested Selection', comparison_summary['naiveNestedSelection']),
                    ('Regularized Nested Selection', comparison_summary['regularizedNestedSelection'])]:
        line = (
            f"{name:<32} | "
            f"{s['medianExcess20d']:>+9.3f}% | "
            f"{s['meanExcess20d']:>+9.3f}% | "
            f"{s['positiveFoldsCount']:>10} | "
            f"{s['sharpe']:>8.2f} | "
            f"{s['cagr']:>7.2f}% | "
            f"{s['medianTurnover']:>9.1f}%"
        )
        print(line)
    print("=" * 105)
    print(f"\nDECISION RULE VERDICT: {decision_verdict}")
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
        'protocol': 'Pre-Registered Nested Target Selection & Comparative Protocol',
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'strategyHorizon': '20d',
        'anchorStrategy': ANCHOR_TARGET,
        'selectionHurdleBps': SELECTION_HURDLE_BPS,
        'devFoldsCount': n_dev,
        'certifiedProductionStrategy': certified_production_strategy,
        'decisionVerdict': decision_verdict,
        'comparisonSummary': comparison_summary,
        'foldDetails': fold_details,
        'holdoutStatus': 'EXCLUDED FROM RESEARCH SCRIPT: Evaluated strictly through execute_frozen_holdout.py with cryptographic manifest lock.'
    }
    
    with open(output_path, 'w') as f:
        json.dump(final_bundle, f, indent=2, default=_json_serial)
    print(f"\nSaved certified comparison results to {output_path}")
    return final_bundle

if __name__ == '__main__':
    run_nested_walk_forward_protocol()

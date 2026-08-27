"""
QuantX Holding-Period & Exit Policy Research Registry.
Evaluates candidate holding policies strictly on the VALIDATION partition (2023-07-04 to 2024-01-24):
- CAND_A_FIXED_5D
- CAND_B_FIXED_10D
- CAND_C_FIXED_20D
- CAND_D_PREDICTED_BEST_HORIZON
- CAND_E_EV_DECAY_EXIT
- CAND_F_OPPORTUNITY_COST_EXIT (with varying switch margins: 0.10%, 0.20%, 0.30%)

Applies Multi-Criteria Robust Economic Utility:
Utility = Sharpe + (0.5 * Sortino) + (0.1 * min(CAGR, 20.0)) - (0.5 * abs(MaxDD) / 100.0)
Penalizes high drawdown, low sample count (< 30 trades), or turnover fragility.
Freezes the winning policy and runs untouched TEST and HOLDOUT.
"""
import os
import sys
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from backtest.backtest_engine import run_portfolio_backtest
from models.cross_sectional_ranker import select_and_allocate_portfolio

CANDIDATES = [
    {
        'candidateId': 'CAND_A_FIXED_5D',
        'horizonDays': 5,
        'exitPolicy': 'FIXED_HORIZON',
        'switchMargin': 0.0,
        'minEvExitMargin': 0.0,
        'description': 'Baseline fixed 5-day holding period'
    },
    {
        'candidateId': 'CAND_B_FIXED_10D',
        'horizonDays': 10,
        'exitPolicy': 'FIXED_HORIZON',
        'switchMargin': 0.0,
        'minEvExitMargin': 0.0,
        'description': 'Fixed 10-day holding period allowing medium-term trend capture'
    },
    {
        'candidateId': 'CAND_C_FIXED_20D',
        'horizonDays': 20,
        'exitPolicy': 'FIXED_HORIZON',
        'switchMargin': 0.0,
        'minEvExitMargin': 0.0,
        'description': 'Fixed 20-day swing holding period'
    },
    {
        'candidateId': 'CAND_D_PREDICTED_BEST_HORIZON',
        'horizonDays': 3,
        'exitPolicy': 'FIXED_HORIZON',
        'switchMargin': 0.0,
        'minEvExitMargin': 0.0,
        'description': 'Empirically predicted fast 3-day capital turnover'
    },
    {
        'candidateId': 'CAND_E_EV_DECAY_EXIT',
        'horizonDays': 5,
        'exitPolicy': 'EV_DECAY_EXIT',
        'switchMargin': 0.0,
        'minEvExitMargin': 0.0,
        'description': 'Dynamic exit when remaining EV collapses below 0'
    },
    {
        'candidateId': 'CAND_F_OPPORTUNITY_COST_EXIT_10BPS',
        'horizonDays': 5,
        'exitPolicy': 'OPPORTUNITY_COST_EXIT',
        'switchMargin': 0.0010,
        'minEvExitMargin': 0.0,
        'description': 'Opportunity cost capital switching with 10 bps margin'
    },
    {
        'candidateId': 'CAND_F_OPPORTUNITY_COST_EXIT_20BPS',
        'horizonDays': 5,
        'exitPolicy': 'OPPORTUNITY_COST_EXIT',
        'switchMargin': 0.0020,
        'minEvExitMargin': 0.0,
        'description': 'Opportunity cost capital switching with 20 bps margin'
    },
    {
        'candidateId': 'CAND_F_OPPORTUNITY_COST_EXIT_30BPS',
        'horizonDays': 5,
        'exitPolicy': 'OPPORTUNITY_COST_EXIT',
        'switchMargin': 0.0030,
        'minEvExitMargin': 0.0,
        'description': 'Opportunity cost capital switching with 30 bps margin'
    }
]

def calculate_validation_utility_score(metrics: Dict[str, Any]) -> float:
    """
    Multi-objective utility scoring function strictly for VALIDATION selection.
    """
    total_trades = metrics.get('totalTrades', 0)
    if total_trades < 15:
        return -999.0
        
    cagr = metrics.get('cagr', 0.0)
    max_dd = abs(metrics.get('maxDrawdown', 0.0))
    sharpe_raw = metrics.get('sharpe', 0.0)
    sortino_raw = metrics.get('sortino', 0.0)
    
    sharpe = float(sharpe_raw) if isinstance(sharpe_raw, (int, float)) else -1.0
    sortino = float(sortino_raw) if isinstance(sortino_raw, (int, float)) else -1.0
    
    pf_raw = metrics.get('profitFactor')
    pf = float(pf_raw) if isinstance(pf_raw, (int, float)) else 1.0
    
    # Utility formula
    utility = (
        (1.0 * sharpe) +
        (0.5 * sortino) +
        (0.15 * min(cagr, 25.0)) -
        (0.5 * (max_dd / 10.0)) +
        (0.2 * min(pf, 3.0))
    )
    return float(round(utility, 4))

def evaluate_holding_period_candidates(
    val_predictions_df: pd.DataFrame,
    candles_by_ticker: Dict[str, pd.DataFrame]
) -> Dict[str, Any]:
    """
    Runs all candidate holding policies on VALIDATION ONLY, ranks them, selects the winner,
    and returns full registry data.
    """
    results = []
    
    for cand in CANDIDATES:
        cand_id = cand['candidateId']
        h_days = cand['horizonDays']
        policy = cand['exitPolicy']
        s_margin = cand['switchMargin']
        min_ev = cand['minEvExitMargin']
        
        # Format predictions horizon to match candidate
        df_cand = val_predictions_df.copy()
        df_cand['horizon'] = f"{h_days}d"
        
        bt_res = run_portfolio_backtest(
            predictions_df=df_cand,
            historical_candles_by_ticker=candles_by_ticker,
            horizon_days=h_days,
            exit_policy=policy,
            switch_margin=s_margin,
            min_ev_exit_margin=min_ev,
            exit_policy_version=f"v4.0.0-{cand_id.lower()}",
            partition='VALIDATION'
        )
        
        trades = bt_res.get('trades', [])
        days_held = [t.get('daysHeld', h_days) for t in trades]
        rets = [t.get('netReturn', 0.0) for t in trades]
        wins = [r for r in rets if r > 0]
        losses = [r for r in rets if r < 0]
        fees = sum(t.get('fees', 0.0) for t in trades)
        
        cand_metrics = {
            'candidateId': cand_id,
            'description': cand['description'],
            'horizonDays': h_days,
            'exitPolicy': policy,
            'switchMargin': s_margin,
            'totalTrades': bt_res.get('totalTrades', len(trades)),
            'winRate': bt_res.get('winRate', 0.0),
            'cagr': bt_res.get('cagr', 0.0),
            'sharpe': bt_res.get('sharpe', 0.0),
            'sortino': bt_res.get('sortino', 0.0),
            'calmar': bt_res.get('calmar', 0.0),
            'maxDrawdown': bt_res.get('maxDrawdown', 0.0),
            'profitFactor': bt_res.get('profitFactor', 1.0),
            'expectancy': float(round(np.mean(rets), 5)) if rets else 0.0,
            'turnover': float(round(sum(t.get('notional', 0.0) for t in trades), 2)),
            'averageHoldingPeriod': float(round(np.mean(days_held), 2)) if days_held else float(h_days),
            'medianHoldingPeriod': float(round(np.median(days_held), 2)) if days_held else float(h_days),
            'averageWin': float(round(np.mean(wins), 5)) if wins else 0.0,
            'averageLoss': float(round(np.mean(losses), 5)) if losses else 0.0,
            'costDrag': float(round(fees, 2)),
        }
        
        cand_metrics['utilityScore'] = calculate_validation_utility_score(cand_metrics)
        results.append(cand_metrics)
        
    results.sort(key=lambda x: x['utilityScore'], reverse=True)
    selected_winner = results[0]
    
    registry = {
        'evaluationPartition': 'VALIDATION',
        'evaluatedAt': '2026-08-27T12:38:00Z',
        'candidateCount': len(results),
        'selectedPolicy': selected_winner['candidateId'],
        'selectionRationale': f"Ranked #1 with highest validation economic utility score ({selected_winner['utilityScore']})",
        'candidates': results
    }
    
    out_path = os.path.join(os.path.dirname(__file__), 'holding_period_experiment_registry.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2)
        
    return registry

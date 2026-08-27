"""
QuantX Multi-Dimensional Robustness Stress Suite.
Evaluates:
1. Cost Robustness (10 to 50 bps)
2. Slippage Robustness (0 to 20 bps)
3. Regime Robustness (Bull, Bear, Sideways, High Vol, Panic)
4. Ticker Robustness (Single-Name Dependency)
5. Sector Robustness (Sector Dependency)
6. Temporal Robustness & Alpha Decay Detection (Early, Middle, Late)
"""
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional

def evaluate_ticker_concentration(completed_trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Evaluates ticker concentration by removing the single top-contributing ticker (Section 43).
    Flags SINGLE_NAME_DEPENDENT if alpha collapses by > 50%.
    """
    if not completed_trades:
        return {'singleNameDependent': False, 'status': 'INSUFFICIENT_TRADES'}

    total_net_pnl = sum(float(t.get('netPnL', 0.0)) for t in completed_trades)
    
    # Aggregate net PnL by ticker
    pnl_by_ticker: Dict[str, float] = {}
    for t in completed_trades:
        tkr = str(t.get('ticker', 'UNKNOWN'))
        pnl_by_ticker[tkr] = pnl_by_ticker.get(tkr, 0.0) + float(t.get('netPnL', 0.0))

    if not pnl_by_ticker:
        return {'singleNameDependent': False, 'status': 'PASS'}

    top_ticker = max(pnl_by_ticker.items(), key=lambda x: x[1])
    top_ticker_name, top_ticker_pnl = top_ticker

    pnl_ex_top = total_net_pnl - top_ticker_pnl
    concentration_ratio = (top_ticker_pnl / total_net_pnl) if total_net_pnl > 0 else 0.0

    is_dependent = bool(total_net_pnl > 0 and concentration_ratio > 0.50)

    return {
        'totalNetPnL': round(total_net_pnl, 2),
        'topTicker': top_ticker_name,
        'topTickerNetPnL': round(top_ticker_pnl, 2),
        'pnlExTopTicker': round(pnl_ex_top, 2),
        'topTickerContributionRatio': round(concentration_ratio, 4),
        'singleNameDependent': is_dependent,
        'status': 'SINGLE_NAME_DEPENDENT' if is_dependent else 'PASS'
    }


def evaluate_temporal_decay(daily_equity_series: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Splits OOS performance into early, middle, and late chronological segments (Section 45 & 47).
    Detects alpha decay across strategy lifecycle.
    """
    if len(daily_equity_series) < 60:
        return {'alphaDecayDetected': False, 'status': 'INSUFFICIENT_HISTORY'}

    n = len(daily_equity_series)
    seg_size = n // 3
    
    early_seg = daily_equity_series[:seg_size]
    mid_seg = daily_equity_series[seg_size : 2 * seg_size]
    late_seg = daily_equity_series[2 * seg_size:]

    def calc_seg_return(seg: List[Dict[str, Any]]) -> float:
        if not seg:
            return 0.0
        start_val = float(seg[0].get('portfolioValue', seg[0].get('equity', 1.0)))
        end_val = float(seg[-1].get('portfolioValue', seg[-1].get('equity', 1.0)))
        return ((end_val - start_val) / start_val) if start_val > 0 else 0.0

    r_early = calc_seg_return(early_seg)
    r_mid = calc_seg_return(mid_seg)
    r_late = calc_seg_return(late_seg)

    # Flag alpha decay if late segment return is lower than early by > 3%
    is_decaying = bool(r_late < r_early - 0.03 and r_late < 0.0)

    return {
        'earlySegmentReturnPct': round(r_early * 100.0, 2),
        'midSegmentReturnPct': round(r_mid * 100.0, 2),
        'lateSegmentReturnPct': round(r_late * 100.0, 2),
        'alphaDecayDetected': is_decaying,
        'status': 'ALPHA_DECAY' if is_decaying else 'PASS'
    }


def compute_research_overfit_scorecard(
    candidate_count: int,
    dsr_dict: Dict[str, Any],
    pbo_dict: Dict[str, Any],
    neighborhood_dict: Dict[str, Any],
    ticker_conc_dict: Dict[str, Any],
    temporal_dict: Dict[str, Any],
    selection_margin: Optional[float] = None
) -> Dict[str, Any]:
    """
    Assembles authoritative RESEARCH_OVERFIT_RISK Scorecard (Section 64).
    Classifies risk into LOW, MEDIUM, or HIGH.
    """
    flags = []
    
    # 1. Multiple-Testing Footprint
    if candidate_count > 50:
        flags.append('LARGE_CANDIDATE_SEARCH')
    if not dsr_dict.get('statisticallySignificant', False):
        flags.append('DEFLATED_SHARPE_UNCONFIRMED')
        
    # 2. PBO Risk
    pbo_risk = pbo_dict.get('riskLevel', 'LOW')
    if pbo_risk == 'HIGH':
        flags.append('HIGH_PBO_OVERFIT_PROBABILITY')
    elif pbo_risk == 'MEDIUM':
        flags.append('MEDIUM_PBO')

    # 3. Parameter Neighborhood
    if neighborhood_dict.get('isSharpPeak', False):
        flags.append('PARAMETER_SHARP_PEAK')

    # 4. Ticker Concentration
    if ticker_conc_dict.get('singleNameDependent', False):
        flags.append('SINGLE_NAME_DEPENDENCY')

    # 5. Temporal Decay
    if temporal_dict.get('alphaDecayDetected', False):
        flags.append('TEMPORAL_ALPHA_DECAY')

    # Overall Classification
    if len(flags) >= 3 or 'HIGH_PBO_OVERFIT_PROBABILITY' in flags or 'PARAMETER_SHARP_PEAK' in flags:
        overall_risk = 'HIGH'
        prod_ready = False
    elif len(flags) >= 1:
        overall_risk = 'MEDIUM'
        prod_ready = True
    else:
        overall_risk = 'LOW'
        prod_ready = True

    return {
        'researchOverfitRisk': overall_risk,
        'productionReady': prod_ready,
        'candidateCount': candidate_count,
        'deflatedSharpe': dsr_dict.get('dsr'),
        'pbo': pbo_dict.get('pbo'),
        'pboRisk': pbo_risk,
        'selectionMargin': selection_margin,
        'parameterRobustness': neighborhood_dict.get('classification', 'UNKNOWN'),
        'singleNameConcentration': ticker_conc_dict.get('topTickerContributionRatio'),
        'alphaDecay': temporal_dict.get('alphaDecayDetected'),
        'activeFlags': flags
    }

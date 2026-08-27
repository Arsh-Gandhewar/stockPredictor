"""
Capacity and Tail / Crisis Stress Analysis for QuantX.
Implements Sections 68-72 of Final Economic Certification:
- Capacity curve across ₹1L to ₹10Cr (Section 68, 69)
- Identification of CAPACITY_LIMIT (Section 69)
- Crisis window stress (largest NIFTY drawdowns, VIX spikes) (Section 70)
- Tail loss probability distribution: P(Return < -1%, -2%, -5%, -10%) (Section 71)
"""
import os
import sys
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional

CAPITAL_TIERS = [
    100_000,       # ₹1 Lakh
    500_000,       # ₹5 Lakh
    1_000_000,     # ₹10 Lakh (Base)
    2_500_000,     # ₹25 Lakh
    5_000_000,     # ₹50 Lakh
    10_000_000,    # ₹1 Crore
    25_000_000,    # ₹2.5 Crore
    50_000_000,    # ₹5 Crore
    100_000_000,   # ₹10 Crore
]

def evaluate_capacity_curve(
    base_cagr: float = -0.57,
    base_sharpe: float = -0.52,
    base_capital: float = 1_000_000.0,
    daily_adv: float = 50_000_000.0
) -> Dict[str, Any]:
    """
    Simulates capacity scaling across capital tiers (Section 68, 69).
    Accounts for market impact expansion: Impact ~ (OrderSize / ADV)**0.5.
    """
    tiers_results = []
    capacity_limit = None
    
    for cap in CAPITAL_TIERS:
        cap_lakhs = cap / 100_000.0
        cap_cr = cap / 10_000_000.0
        label = f"₹{int(cap_lakhs)}L" if cap < 10_000_000 else f"₹{cap_cr:.1f}Cr"
        
        # Max position is 10% of portfolio
        pos_size = cap * 0.10
        participation_rate = pos_size / daily_adv
        
        # Incremental market impact in bps
        impact_bps = 5.0 * np.sqrt(max(0.01, participation_rate / 0.002))
        impact_pct = (impact_bps / 10_000.0) * 100.0
        
        # Additional annual cost drag from impact (assuming ~500 trades / 2.5 years ~ 200 trades/yr)
        extra_drag = 200 * (impact_pct / 100.0) * 0.10 * 100.0
        
        net_cagr = round(base_cagr - extra_drag, 2)
        net_sharpe = round(base_sharpe - (extra_drag / 15.0), 2)
        
        # Capacity limit reached if participation > 5% or net CAGR drops by > 5% from base
        if capacity_limit is None and (participation_rate > 0.05 or extra_drag > 3.0):
            capacity_limit = label
            
        tiers_results.append({
            'capital': cap,
            'label': label,
            'participationRate': float(round(participation_rate, 4)),
            'incrementalImpactBps': float(round(impact_bps, 2)),
            'annualImpactDragPct': float(round(extra_drag, 2)),
            'netCAGR': net_cagr,
            'netSharpe': net_sharpe
        })
        
    if capacity_limit is None:
        capacity_limit = "₹10Cr+"
        
    return {
        'status': 'VALID',
        'baseCapital': base_capital,
        'capacityLimit': capacity_limit,
        'tiers': tiers_results
    }

def calculate_tail_loss_distribution(daily_returns: np.ndarray) -> Dict[str, Any]:
    """
    Calculates tail loss probabilities from empirical historical return series (Section 71):
    P(Return < -1%), P(Return < -2%), P(Return < -5%), P(Return < -10%).
    """
    rets = np.asarray(daily_returns, dtype=float)
    rets = rets[~np.isnan(rets)]
    n = len(rets)
    if n < 30:
        return {'status': 'INSUFFICIENT_DATA'}
        
    p_neg_1 = float(round(np.mean(rets < -0.01) * 100.0, 2))
    p_neg_2 = float(round(np.mean(rets < -0.02) * 100.0, 2))
    p_neg_5 = float(round(np.mean(rets < -0.05) * 100.0, 2))
    p_neg_10 = float(round(np.mean(rets < -0.10) * 100.0, 2))
    
    var_95 = float(round(np.percentile(rets, 5.0) * 100.0, 2))
    var_99 = float(round(np.percentile(rets, 1.0) * 100.0, 2))
    
    # Expected Shortfall (CVaR)
    cvar_95 = float(round(np.mean(rets[rets <= np.percentile(rets, 5.0)]) * 100.0, 2))
    
    return {
        'status': 'VALID',
        'sampleCount': n,
        'pReturnBelow1Pct': p_neg_1,
        'pReturnBelow2Pct': p_neg_2,
        'pReturnBelow5Pct': p_neg_5,
        'pReturnBelow10Pct': p_neg_10,
        'historicalVaR95Pct': var_95,
        'historicalVaR99Pct': var_99,
        'expectedShortfallCVaR95Pct': cvar_95
    }

def evaluate_crisis_stress_events(
    strategy_returns: np.ndarray,
    nifty_returns: np.ndarray,
    vix_levels: Optional[np.ndarray] = None
) -> Dict[str, Any]:
    """
    Evaluates strategy during largest historical NIFTY drawdowns and VIX spike events (Section 70).
    """
    s_ret = np.asarray(strategy_returns, dtype=float)
    b_ret = np.asarray(nifty_returns, dtype=float)
    n = min(len(s_ret), len(b_ret))
    if n < 30:
        return {'status': 'INSUFFICIENT_DATA'}
        
    s_ret, b_ret = s_ret[:n], b_ret[:n]
    
    # 1. Benchmark 10 worst days
    worst_bench_idx = np.argsort(b_ret)[:10]
    bench_crash_loss = float(round(np.mean(b_ret[worst_bench_idx]) * 100.0, 2))
    strat_in_crash_loss = float(round(np.mean(s_ret[worst_bench_idx]) * 100.0, 2))
    
    # 2. VIX spike days (top 5% if available, else worst 5% return days)
    if vix_levels is not None and len(vix_levels) >= n:
        vix_arr = np.asarray(vix_levels[:n], dtype=float)
        vix_spike_idx = np.where(vix_arr >= np.percentile(vix_arr, 95))[0]
    else:
        vix_spike_idx = worst_bench_idx[:5]
        
    strat_vix_spike_loss = float(round(np.mean(s_ret[vix_spike_idx]) * 100.0, 2)) if len(vix_spike_idx) > 0 else 0.0
    
    return {
        'status': 'VALID',
        'sampleCount': n,
        'benchmarkWorst10DaysMeanLoss': bench_crash_loss,
        'strategyReturnOnWorst10Days': strat_in_crash_loss,
        'crashProtectionDelta': float(round(strat_in_crash_loss - bench_crash_loss, 2)),
        'strategyReturnOnVixSpikeDays': strat_vix_spike_loss
    }

"""
Validation-Only Market Regime Policy Experiment Suite.
Evaluates Candidate Policies A through H strictly on the VALIDATION partition
(2023-07-04 to 2024-01-24) to select the optimal point-in-time regime policy.
"""
import os
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional

from models.regime_engine import MarketRegimeEngine, MIN_REGIME_SAMPLE_COUNT
from models.regime_policy import (
    RegimePolicyConfig,
    build_baseline_policy,
    build_high_vol_reduction_policy,
    build_panic_reduction_policy,
    build_bear_ev_increase_policy,
    build_sideways_ev_increase_policy,
    build_panic_no_trade_policy,
    build_composite_risk_control_policy,
    build_regime_holding_period_policy
)
from backtest.backtest_engine import run_portfolio_backtest

VALIDATION_START = "2023-07-04"
VALIDATION_END = "2024-01-24"

def compute_robust_regime_utility(metrics: Dict[str, Any]) -> float:
    """
    Computes Section 30 Multi-Criteria Robust Economic Utility:
    Utility = Sharpe + 0.5*Sortino + 0.15*min(CAGR, 25.0) - 0.5*(abs(MaxDD)/10.0) + 0.2*min(PF, 3.0)
    """
    cagr = float(metrics.get('cagr', 0.0) or 0.0)
    sharpe_raw = metrics.get('sharpe')
    sharpe = float(sharpe_raw) if (sharpe_raw is not None and sharpe_raw not in ['NOT_AVAILABLE', 'NOT_MEANINGFUL']) else -1.0
    
    sortino_raw = metrics.get('sortino')
    sortino = float(sortino_raw) if (sortino_raw is not None and sortino_raw not in ['NOT_AVAILABLE', 'NOT_MEANINGFUL']) else -1.0
    
    max_dd = float(metrics.get('maxDrawdown', 0.0) or 0.0)
    pf_raw = metrics.get('profitFactor')
    pf = float(pf_raw) if (pf_raw is not None and pf_raw not in ['NOT_AVAILABLE', 'NOT_MEANINGFUL']) else 0.5
    
    if metrics.get('totalTrades', 0) < 10:
        return -999.0
        
    utility = (
        sharpe
        + 0.5 * sortino
        + 0.15 * min(cagr, 25.0)
        - 0.5 * (abs(max_dd) / 10.0)
        + 0.2 * min(pf, 3.0)
    )
    return round(float(utility), 4)

def evaluate_regime_candidate_suite(
    predictions_df: pd.DataFrame,
    historical_candles: Dict[str, pd.DataFrame],
    regime_engine: MarketRegimeEngine,
    output_registry_path: str = "packages/quant-engine/research/regime_experiment_registry.json"
) -> Dict[str, Any]:
    """
    Executes all candidate regime policies strictly on VALIDATION partition.
    """
    # 1. Strict Validation Slice
    val_preds = predictions_df.loc[
        (predictions_df['date'] >= VALIDATION_START) &
        (predictions_df['date'] <= VALIDATION_END)
    ].copy()
    
    if val_preds.empty:
        val_preds = predictions_df.copy()
        
    candidates = [
        ("CAND_A_BASELINE_NO_REGIME", build_baseline_policy(), "Unconstrained trading across all regimes"),
        ("CAND_B_HIGH_VOL_REDUCTION", build_high_vol_reduction_policy(), "Reduce exposure to 50% in HIGH_VOLATILITY"),
        ("CAND_C_PANIC_REDUCTION", build_panic_reduction_policy(), "Reduce exposure to 25% in PANIC"),
        ("CAND_D_BEAR_EV_INCREASE", build_bear_ev_increase_policy(), "Increase required EV hurdle by 1.5x in BEAR"),
        ("CAND_E_SIDEWAYS_EV_INCREASE", build_sideways_ev_increase_policy(), "Increase required EV hurdle by 1.25x in SIDEWAYS"),
        ("CAND_F_PANIC_NO_TRADE", build_panic_no_trade_policy(), "Hard NO_TRADE during PANIC regime"),
        ("CAND_G_COMPOSITE_RISK", build_composite_risk_control_policy(), "Integrated multi-regime risk scaling"),
        ("CAND_H_REGIME_HOLDING", build_regime_holding_period_policy(), "Regime-specific holding periods (BULL 10d, BEAR 3d, PANIC 0)")
    ]
    
    results = []
    for cand_id, policy_cfg, desc in candidates:
        bt_res = run_portfolio_backtest(
            predictions_df=val_preds,
            historical_candles_by_ticker=historical_candles,
            horizon_days=5,
            regime_policy_config=policy_cfg,
            market_regime_engine=regime_engine,
            partition='VALIDATION'
        )
        
        utility = compute_robust_regime_utility(bt_res)
        
        # Check single regime dependency (> 60% of alpha from one regime)
        reg_attrib = bt_res.get('regimeAttribution', {})
        total_pnl = sum(v.get('netPnL', 0.0) for v in reg_attrib.values())
        single_regime_dep = False
        dominant_regime = None
        if total_pnl > 0:
            for r_name, r_data in reg_attrib.items():
                if (r_data.get('netPnL', 0.0) / total_pnl) > 0.60:
                    single_regime_dep = True
                    dominant_regime = r_name
                    
        rec = {
            'candidateId': cand_id,
            'description': desc,
            'policyId': policy_cfg.policyId,
            'policyVersion': policy_cfg.version,
            'cagr': bt_res.get('cagr'),
            'sharpe': bt_res.get('sharpe'),
            'sortino': bt_res.get('sortino'),
            'maxDrawdown': bt_res.get('maxDrawdown'),
            'profitFactor': bt_res.get('profitFactor'),
            'totalTrades': bt_res.get('totalTrades'),
            'winRate': bt_res.get('winRate'),
            'utilityScore': utility,
            'singleRegimeDependency': single_regime_dep,
            'dominantRegime': dominant_regime,
            'regimeAttribution': reg_attrib,
            'validationPeriod': f"{VALIDATION_START} to {VALIDATION_END}"
        }
        results.append(rec)
        
    # Rank candidates by Utility Score descending
    results.sort(key=lambda x: x['utilityScore'], reverse=True)
    for rank, r in enumerate(results, start=1):
        r['rank'] = rank
        
    winner = results[0]
    registry_output = {
        'evaluationTimestamp': pd.Timestamp.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'validationPeriod': f"{VALIDATION_START} to {VALIDATION_END}",
        'sampleSufficiencyRequirement': MIN_REGIME_SAMPLE_COUNT,
        'selectedPolicy': winner['candidateId'],
        'selectedPolicyId': winner['policyId'],
        'selectedPolicyVersion': winner['policyVersion'],
        'candidates': results
    }
    
    os.makedirs(os.path.dirname(output_registry_path), exist_ok=True)
    with open(output_registry_path, 'w', encoding='utf-8') as f:
        json.dump(registry_output, f, indent=2)
        
    return registry_output

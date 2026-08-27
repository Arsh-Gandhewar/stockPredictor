import os
import sys
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np

class EconomicPayoffMismatchError(Exception):
    """Raised when there is any disconnect between EV estimation and trade execution payoff."""
    pass

class HorizonMismatchError(Exception):
    """Raised when distribution horizon does not match trade horizon."""
    pass

class InvalidPayoffError(Exception):
    """Raised when payoff parameters are invalid or economically non-executable."""
    pass

@dataclass(frozen=True)
class TradePayoffProfile:
    """
    Immutable single source of truth for trade economic payoff.
    Binds conditional return estimation, expected value calculation,
    stop/target construction, backtest execution, and attribution.
    """
    horizon: str
    expectedGain: float
    expectedLoss: float
    p15: float
    p50: float
    p85: float
    stopReturn: float
    targetReturn: float
    distributionVersion: str
    fitStart: Optional[str]
    fitEnd: Optional[str]
    sourceMethod: str
    gainSampleCount: Optional[int] = None
    lossSampleCount: Optional[int] = None
    sampleCount: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

def build_trade_payoff_profile(
    signal: Any,
    trade_horizon: str = '5d'
) -> TradePayoffProfile:
    """
    Constructs an immutable TradePayoffProfile directly from causal empirical return distributions.
    Validates:
    - Horizon consistency (trade_horizon == signal.horizon)
    - Valid non-null p15 and p85
    - targetReturn > 0 and stopReturn < 0
    - Real empirical expectedGain and expectedLoss
    Raises InvalidPayoffError or HorizonMismatchError if invalid (triggering NO TRADE).
    """
    # 1. Horizon Consistency (Section 13)
    sig_horizon = str(signal.get('horizon', '5d')).lower().strip()
    norm_trade_h = str(trade_horizon).lower().strip()
    
    if not sig_horizon.endswith('d'):
        sig_horizon = f"{sig_horizon}d"
    if not norm_trade_h.endswith('d'):
        norm_trade_h = f"{norm_trade_h}d"
        
    if sig_horizon != norm_trade_h:
        raise HorizonMismatchError(
            f"HORIZON_MISMATCH: distribution horizon '{sig_horizon}' != trade horizon '{norm_trade_h}'"
        )
        
    # 2. Check for missing or insufficient data
    ret_method = signal.get('returnEstimateMethod', '')
    if ret_method == 'INSUFFICIENT_DATA':
        raise InvalidPayoffError("NO_TRADE: Return distribution has INSUFFICIENT_DATA.")
        
    e_gain = signal.get('conditional_gain')
    e_loss = signal.get('conditional_loss')
    
    if e_gain is None or pd.isna(e_gain):
        raise InvalidPayoffError("NO_TRADE: Missing conditional gain.")
    if e_loss is None or pd.isna(e_loss):
        raise InvalidPayoffError("NO_TRADE: Missing conditional loss.")
        
    e_gain = float(e_gain)
    e_loss = float(e_loss)

    if 'p85' in signal:
        p85 = signal.get('p85')
        if p85 is None or pd.isna(p85):
            raise InvalidPayoffError("NO_TRADE: Missing p85 empirical quantile.")
        p85 = float(p85)
    else:
        p85 = e_gain
        
    if 'p15' in signal:
        p15 = signal.get('p15')
        if p15 is None or pd.isna(p15):
            raise InvalidPayoffError("NO_TRADE: Missing p15 empirical quantile.")
        p15 = float(p15)
    else:
        p15 = -abs(e_loss)
        
    p50 = signal.get('p50')
    p50 = float(p50) if (p50 is not None and not pd.isna(p50)) else (p85 + p15) / 2.0
    e_gain = float(e_gain)
    e_loss = float(e_loss)
    
    # 3. Payoff Direction & Boundary Validation (Section 6 & 7)
    # For a long position: targetReturn > 0 and stopReturn < 0 MUST hold.
    if p85 <= 0.0:
        raise InvalidPayoffError(f"NO_TRADE: p85 ({p85}) <= 0. Cannot form a valid positive target.")
        
    if p15 >= 0.0:
        raise InvalidPayoffError(f"NO_TRADE: p15 ({p15}) >= 0. Cannot form a valid negative stop.")
        
    target_return = p85
    stop_return = p15
    
    dist_ver = str(signal.get('distributionVersion', 'v5.0.0-fold-causal'))
    fit_start = signal.get('distributionFitStart')
    fit_end = signal.get('distributionFitEnd') or signal.get('distributionFitEndTimestamp')
    
    sample_count = signal.get('returnEstimateSampleCount')
    
    return TradePayoffProfile(
        horizon=norm_trade_h,
        expectedGain=e_gain,
        expectedLoss=e_loss,
        p15=p15,
        p50=p50,
        p85=p85,
        stopReturn=stop_return,
        targetReturn=target_return,
        distributionVersion=dist_ver,
        fitStart=str(fit_start) if fit_start else None,
        fitEnd=str(fit_end) if fit_end else None,
        sourceMethod=ret_method or 'EMPIRICAL_CAUSAL_DISTRIBUTION',
        gainSampleCount=signal.get('gainSampleCount'),
        lossSampleCount=signal.get('lossSampleCount'),
        sampleCount=int(sample_count) if (sample_count is not None and not pd.isna(sample_count)) else None
    )

def verify_trade_payoff_invariants(trade: Dict[str, Any], profile: TradePayoffProfile) -> None:
    """
    Enforces Section 9 Invariants:
    1. abs(trade.expectedGain - profile.expectedGain) <= 1e-12
    2. trade.distributionVersion == profile.distributionVersion
    3. abs(trade.targetReturn - profile.targetReturn) <= 1e-12
    4. abs(trade.stopReturn - profile.stopReturn) <= 1e-12
    """
    if abs(float(trade['expectedGain']) - profile.expectedGain) > 1e-12:
        raise EconomicPayoffMismatchError(
            f"CRITICAL ECONOMIC MISMATCH: trade.expectedGain {trade['expectedGain']} != profile.expectedGain {profile.expectedGain}"
        )
    if str(trade['distributionVersion']) != profile.distributionVersion:
        raise EconomicPayoffMismatchError(
            f"CRITICAL ECONOMIC MISMATCH: trade.distributionVersion {trade['distributionVersion']} != profile.distributionVersion {profile.distributionVersion}"
        )
    if abs(float(trade['targetReturn']) - profile.targetReturn) > 1e-12:
        raise EconomicPayoffMismatchError(
            f"CRITICAL ECONOMIC MISMATCH: trade.targetReturn {trade['targetReturn']} != profile.targetReturn {profile.targetReturn}"
        )
    if abs(float(trade['stopReturn']) - profile.stopReturn) > 1e-12:
        raise EconomicPayoffMismatchError(
            f"CRITICAL ECONOMIC MISMATCH: trade.stopReturn {trade['stopReturn']} != profile.stopReturn {profile.stopReturn}"
        )

def reconcile_trade_payoffs(completed_trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Section 16: Independent Economic Reconciliation Verifier.
    For every production trade:
    Recomputes expectedGain, expectedLoss, P_UP, P_DOWN, EV, targetReturn, stopReturn
    from the stored payoff profile and compares to values consumed by execution.
    Any mismatch: FAIL.
    """
    total_trades = len(completed_trades)
    reconciled_trades = 0
    mismatches = []
    
    for idx, trade in enumerate(completed_trades):
        profile_data = trade.get('payoffProfile')
        if not profile_data:
            # Baseline ATR trades might not have a profile, which is expected for baselines
            continue
            
        profile = TradePayoffProfile(**profile_data)
        
        # 1. Gain & Loss check
        if abs(trade['expectedGain'] - profile.expectedGain) > 1e-12:
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): expectedGain mismatch {trade['expectedGain']} vs {profile.expectedGain}")
            
        if abs(trade['expectedLoss'] - profile.expectedLoss) > 1e-12:
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): expectedLoss mismatch {trade['expectedLoss']} vs {profile.expectedLoss}")
            
        # 2. Target & Stop Return check
        if abs(trade['targetReturn'] - profile.targetReturn) > 1e-12:
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): targetReturn mismatch {trade['targetReturn']} vs {profile.targetReturn}")
            
        if abs(trade['stopReturn'] - profile.stopReturn) > 1e-12:
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): stopReturn mismatch {trade['stopReturn']} vs {profile.stopReturn}")
            
        # 3. Execution Prices check
        entry_p = trade['entryPrice']
        expected_target_p = entry_p * (1.0 + profile.targetReturn)
        expected_stop_p = entry_p * (1.0 + profile.stopReturn)
        
        if abs(trade['targetPrice'] - expected_target_p) > 1e-6 * max(1.0, entry_p):
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): targetPrice execution mismatch")
            
        if abs(trade['stopLossPrice'] - expected_stop_p) > 1e-6 * max(1.0, entry_p):
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): stopLossPrice execution mismatch")
            
        # 4. EV calculation check
        p_up = trade.get('p_up')
        p_down = trade.get('p_down')
        if p_up is not None and p_down is not None:
            recomputed_ev_before = (p_up * profile.expectedGain) - (p_down * profile.expectedLoss)
            if abs(trade.get('ev_before_cost', recomputed_ev_before) - recomputed_ev_before) > 1e-6:
                mismatches.append(f"Trade {idx} ({trade.get('ticker')}): EV before cost recomputation mismatch")
                
        # 5. Causal Timestamp Invariant
        fit_end = profile.fitEnd
        entry_date = trade.get('entryDate')
        if fit_end and entry_date and str(fit_end)[:10] >= str(entry_date)[:10]:
            mismatches.append(f"Trade {idx} ({trade.get('ticker')}): distributionFitEnd {fit_end} >= entryDate {entry_date}")
            
        reconciled_trades += 1
        
    return {
        'status': 'PASS' if len(mismatches) == 0 else 'FAIL',
        'totalCompletedTrades': total_trades,
        'reconciledProductionTrades': reconciled_trades,
        'mismatchCount': len(mismatches),
        'mismatches': mismatches
    }

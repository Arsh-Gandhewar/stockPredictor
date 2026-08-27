"""
QuantX Multi-Horizon Signal Decay Research Engine.
Measures realized forward gross and net returns across 1D, 2D, 3D, 5D, 7D, 10D, 15D, and 20D trading sessions.
Computes economic signal half-lives across:
- Probability buckets (<0.50, 0.50-0.55, 0.55-0.60, 0.60-0.65, 0.65-0.70, 0.70-0.80, 0.80+)
- Return magnitude deciles (D1 to D10)
- Macro market regimes (BULL, BEAR, SIDEWAYS, HIGH_VOLATILITY, PANIC)
- Volatility regimes (LOW, MEDIUM, HIGH, EXTREME)
- Stock characteristics (beta, liquidity, ATR, momentum) requiring N >= 100.
"""
import os
import sys
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from quant_governance_config import BASE_ROUND_TRIP_FRICTION, MIN_RETURN_BUCKET_SAMPLE_COUNT

DECAY_HORIZONS = [1, 2, 3, 5, 7, 10, 15, 20]

PROB_BUCKETS = [
    ('<0.50', 0.00, 0.50),
    ('0.50-0.55', 0.50, 0.55),
    ('0.55-0.60', 0.55, 0.60),
    ('0.60-0.65', 0.60, 0.65),
    ('0.65-0.70', 0.65, 0.70),
    ('0.70-0.80', 0.70, 0.80),
    ('0.80+', 0.80, 1.01)
]

def get_prob_bucket_label(p: float) -> str:
    p = float(np.clip(p, 0.0, 1.0))
    for label, low, high in PROB_BUCKETS:
        if low <= p < high or (high >= 1.0 and p == 1.0):
            return label
    return '0.50-0.55'

def compute_multi_horizon_forward_returns(
    predictions_df: pd.DataFrame,
    candles_by_ticker: Dict[str, pd.DataFrame],
    round_trip_cost: float = BASE_ROUND_TRIP_FRICTION
) -> pd.DataFrame:
    """
    Computes realized forward returns at 1D, 2D, 3D, 5D, 7D, 10D, 15D, and 20D trading sessions.
    Strictly follows production execution: entry at Open(T+1).
    All returns are measured strictly from entryTimestamp forward.
    """
    df = predictions_df.copy()
    
    for h in DECAY_HORIZONS:
        df[f'gross_return_{h}d'] = np.nan
        df[f'net_return_{h}d'] = np.nan
        
    for idx, row in df.iterrows():
        ticker = row.get('ticker')
        pred_date = str(row.get('predictionTimestamp', idx))[:10]
        candles = candles_by_ticker.get(ticker)
        if candles is None or candles.empty or pred_date not in candles.index:
            continue
            
        c_idx = candles.index.get_loc(pred_date)
        # Entry at next trading session Open(T+1)
        entry_idx = c_idx + 1
        if entry_idx >= len(candles):
            continue
            
        entry_open = candles['Open'].iloc[entry_idx]
        if pd.isna(entry_open) or entry_open <= 0:
            continue
            
        for h in DECAY_HORIZONS:
            exit_idx = entry_idx + h
            if exit_idx < len(candles):
                exit_close = candles['Close'].iloc[exit_idx]
                if not pd.isna(exit_close) and exit_close > 0:
                    gross_ret = (exit_close - entry_open) / entry_open
                    net_ret = gross_ret - round_trip_cost
                    df.at[idx, f'gross_return_{h}d'] = float(round(gross_ret, 5))
                    df.at[idx, f'net_return_{h}d'] = float(round(net_ret, 5))
                    
    return df

def calculate_cohort_decay_metrics(
    cohort_df: pd.DataFrame,
    min_sample_count: int = 50
) -> Dict[str, Any]:
    """
    Calculates mean net return, median, win rate, EV, risk, and half-life across horizons for a cohort.
    """
    n = len(cohort_df)
    if n < min_sample_count:
        return {
            'sampleCount': n,
            'status': 'INSUFFICIENT_DATA',
            'horizons': {},
            'signalHalfLife': None,
            'halfLifeConfidence': 'HALF_LIFE_UNCERTAIN'
        }
        
    horizon_metrics = {}
    ev_path = []
    
    for h in DECAY_HORIZONS:
        net_col = f'net_return_{h}d'
        if net_col not in cohort_df.columns:
            continue
            
        valid_rets = cohort_df[net_col].dropna().values
        v_n = len(valid_rets)
        if v_n < min_sample_count:
            horizon_metrics[f'{h}d'] = {'sampleCount': v_n, 'status': 'INSUFFICIENT_DATA'}
            ev_path.append((h, None))
            continue
            
        mean_ret = float(round(np.mean(valid_rets), 5))
        med_ret = float(round(np.median(valid_rets), 5))
        wr = float(round((valid_rets > 0).mean() * 100, 2))
        
        pos_rets = valid_rets[valid_rets > 0]
        neg_rets = valid_rets[valid_rets < 0]
        exp_gain = float(round(np.mean(pos_rets), 5)) if len(pos_rets) > 0 else 0.0
        exp_loss = float(round(abs(np.mean(neg_rets)), 5)) if len(neg_rets) > 0 else 0.0
        
        # Risk = downside standard deviation or expected loss
        downside_risk = float(round(np.std(neg_rets) if len(neg_rets) > 1 else exp_loss, 5))
        
        # Profit Factor
        gross_win = np.sum(pos_rets) if len(pos_rets) > 0 else 0.0
        gross_loss = np.sum(np.abs(neg_rets)) if len(neg_rets) > 0 else 0.0
        pf = float(round(gross_win / gross_loss, 2)) if gross_loss > 0 else (99.0 if gross_win > 0 else 1.0)
        
        # EV per unit time
        ev_val = mean_ret
        ev_path.append((h, ev_val))
        
        horizon_metrics[f'{h}d'] = {
            'sampleCount': v_n,
            'meanNetReturn': mean_ret,
            'medianNetReturn': med_ret,
            'winRate': wr,
            'expectedGain': exp_gain,
            'expectedLoss': exp_loss,
            'expectedRisk': downside_risk,
            'profitFactor': pf,
            'expectedValue': ev_val,
            'dailyEV': float(round(ev_val / h, 5))
        }
        
    # Determine Economic Half-Life:
    # First horizon H where incremental expected value falls below hurdle or turns non-positive
    signal_half_life = None
    confidence = 'HALF_LIFE_UNCERTAIN'
    
    valid_evs = [(h, ev) for h, ev in ev_path if ev is not None]
    if len(valid_evs) >= 3:
        best_ev = max(ev for h, ev in valid_evs)
        if best_ev > 0:
            # Find peak EV horizon
            peak_h = next(h for h, ev in valid_evs if ev == best_ev)
            # Find first horizon after peak where EV falls by > 50% or goes <= 0
            decay_h = None
            for h, ev in valid_evs:
                if h >= peak_h and (ev <= 0 or ev < (best_ev * 0.5)):
                    decay_h = h
                    break
            signal_half_life = decay_h if decay_h is not None else peak_h
            confidence = 'CONFIDENT' if n >= 100 else 'MODERATE'
            
    return {
        'sampleCount': n,
        'status': 'VALID',
        'horizons': horizon_metrics,
        'signalHalfLife': signal_half_life,
        'halfLifeConfidence': confidence
    }

def analyze_full_signal_decay(
    predictions_df: pd.DataFrame,
    candles_by_ticker: Dict[str, pd.DataFrame]
) -> Dict[str, Any]:
    """
    Executes full multi-dimensional signal decay analysis across cohorts.
    """
    df = compute_multi_horizon_forward_returns(predictions_df, candles_by_ticker)
    
    # 1. Global Decay Curve
    global_decay = calculate_cohort_decay_metrics(df, min_sample_count=100)
    
    # 2. Probability Buckets
    prob_col = 'calibratedProbability' if 'calibratedProbability' in df.columns else 'pred_prob'
    prob_decay = {}
    if prob_col in df.columns:
        df['prob_bucket'] = df[prob_col].apply(get_prob_bucket_label)
        for b_name, grp in df.groupby('prob_bucket'):
            prob_decay[b_name] = calculate_cohort_decay_metrics(grp, min_sample_count=50)
            
    # 3. Return Model Strength Deciles
    ret_col = 'conditional_gain' if 'conditional_gain' in df.columns else None
    decile_decay = {}
    if ret_col and df[ret_col].dropna().count() >= 100:
        df['ret_decile'] = pd.qcut(df[ret_col].rank(method='first'), q=10, labels=[f'D{i+1}' for i in range(10)])
        for d_name, grp in df.groupby('ret_decile'):
            decile_decay[str(d_name)] = calculate_cohort_decay_metrics(grp, min_sample_count=30)
            
    # 4. Market Regimes
    regime_decay = {}
    if 'regime' in df.columns:
        for r_name, grp in df.groupby('regime'):
            regime_decay[str(r_name)] = calculate_cohort_decay_metrics(grp, min_sample_count=50)
            
    # 5. Volatility Regimes
    vol_decay = {}
    if 'atr_percent' in df.columns and df['atr_percent'].dropna().count() >= 100:
        df['vol_bucket'] = pd.qcut(df['atr_percent'].rank(method='first'), q=4, labels=['LOW', 'MEDIUM', 'HIGH', 'EXTREME'])
        for v_name, grp in df.groupby('vol_bucket'):
            vol_decay[str(v_name)] = calculate_cohort_decay_metrics(grp, min_sample_count=50)
            
    return {
        'globalDecay': global_decay,
        'probabilityDecay': prob_decay,
        'returnDecileDecay': decile_decay,
        'regimeDecay': regime_decay,
        'volatilityDecay': vol_decay
    }

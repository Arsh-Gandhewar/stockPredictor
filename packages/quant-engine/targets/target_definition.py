"""
Directional Net-Return Target Formulation Engine.
Formulates mathematically interpretable directional binary targets:
y = 1 if forward net return (after centralized friction & slippage) > 0, y = 0 otherwise.
"""
import pandas as pd
import numpy as np
import os, sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from costs import TransactionCostEngine

TARGET_HORIZONS = [1, 5, 20]

def compute_targets(df: pd.DataFrame, cost_engine: TransactionCostEngine = None) -> pd.DataFrame:
    df = df.copy()
    if cost_engine is None:
        cost_engine = TransactionCostEngine('BASE_COST')
        
    friction_rate = cost_engine.calculate_round_trip_cost_rate()
    
    for h in TARGET_HORIZONS:
        # Gross forward return from close[t] to close[t+h]
        future_close = df['Close'].shift(-h)
        gross_ret = (future_close - df['Close']) / df['Close']
        
        # Net forward return after deducting total round-trip transaction friction
        net_ret = gross_ret - friction_rate
        
        df[f'future_gross_ret_{h}d'] = gross_ret
        df[f'future_net_ret_{h}d'] = net_ret
        
        # Binary directional target: 1 if profitable net of costs, 0 otherwise
        target_series = (net_ret > 0.0).astype(float)
        # Prevent lookahead contamination: set target to NaN where future is unknown
        target_series[future_close.isna()] = np.nan
        df[f'target_{h}d'] = target_series

    return df

"""
Directional Net-Return Target Formulation Engine.
Formulates mathematically rigorous directional binary targets matching realistic execution semantics:
- Signal timestamp: Close(T) (end of day evaluation)
- Executable entry: Open(T+1) (next trading session open)
- Exit: Close(T+H) (session H close)
- Target: y = 1 if forward net return (after institutional friction & slippage) > 0, y = 0 otherwise.
"""
import os
import sys
import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from costs import TransactionCostEngine

TARGET_HORIZONS = [1, 5, 20]

def compute_targets(df: pd.DataFrame, cost_engine: TransactionCostEngine = None) -> pd.DataFrame:
    df = df.copy()
    if cost_engine is None:
        cost_engine = TransactionCostEngine('BASE_COST')
        
    friction_rate = cost_engine.calculate_round_trip_cost_rate()
    
    # Executable entry price is the Open of the next session T+1
    entry_price = df['Open'].shift(-1) if 'Open' in df.columns else df['Close'].shift(-1)
    
    for h in TARGET_HORIZONS:
        # Exit price is the Close at horizon T+h
        exit_price = df['Close'].shift(-h)
        
        # Forward gross trade return from Open(T+1) to Close(T+h)
        # Note: For h=1, Open(T+1) to Close(T+1) is the intraday return of session T+1
        gross_ret = (exit_price - entry_price) / entry_price
        
        # Net forward return after deducting centralized institutional friction
        net_ret = gross_ret - friction_rate
        
        df[f'future_gross_ret_{h}d'] = gross_ret
        df[f'future_net_ret_{h}d'] = net_ret
        
        # Binary directional target: 1 if profitable net of costs, 0 otherwise
        target_series = (net_ret > 0.0).astype(float)
        # Invalidate where future is unknown or entry is unavailable
        target_series[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_{h}d'] = target_series

    return df


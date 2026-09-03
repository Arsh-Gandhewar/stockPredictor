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

from typing import Optional

TARGET_HORIZONS = [1, 5, 20]

def compute_targets(
    df: pd.DataFrame, 
    cost_engine: TransactionCostEngine = None,
    benchmark_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    df = df.copy()
    if cost_engine is None:
        cost_engine = TransactionCostEngine('BASE_COST')
        
    friction_rate = cost_engine.calculate_round_trip_cost_rate()
    
    # Executable entry price is the Open of the next session T+1
    entry_price = df['Open'].shift(-1) if 'Open' in df.columns else df['Close'].shift(-1)
    
    # Benchmark entry alignment
    bench_entry = None
    if benchmark_df is not None and not benchmark_df.empty:
        bench_aligned = benchmark_df.reindex(df.index).ffill()
        bench_entry = bench_aligned['Open'].shift(-1) if 'Open' in bench_aligned.columns else bench_aligned['Close'].shift(-1)
    else:
        bench_aligned = None
        
    for h in TARGET_HORIZONS:
        # Exit price is the Close at horizon T+h
        exit_price = df['Close'].shift(-h)
        
        # Forward gross trade return from Open(T+1) to Close(T+h)
        gross_ret = (exit_price - entry_price) / entry_price
        
        # Net forward return after deducting centralized institutional friction
        net_ret = gross_ret - friction_rate
        
        df[f'future_gross_ret_{h}d'] = gross_ret
        df[f'future_net_ret_{h}d'] = net_ret
        df[f'label_end_{h}d'] = df.index.to_series().shift(-h)
        
        # Benchmark-relative excess return
        if bench_aligned is not None and bench_entry is not None:
            bench_exit = bench_aligned['Close'].shift(-h)
            bench_gross = (bench_exit - bench_entry) / bench_entry
            excess_ret = gross_ret - bench_gross
            net_excess_ret = excess_ret - friction_rate
        else:
            excess_ret = gross_ret
            net_excess_ret = net_ret
            
        df[f'future_excess_ret_{h}d'] = excess_ret
        df[f'future_net_excess_ret_{h}d'] = net_excess_ret
        
        # Volatility standardization: 20-day rolling daily volatility * sqrt(h)
        daily_ret = df['Close'].pct_change()
        vol_h = daily_ret.rolling(20).std() * np.sqrt(h)
        vol_h = vol_h.clip(lower=0.005)  # floor to prevent division by zero
        
        standardized_excess = excess_ret / vol_h
        standardized_excess[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_vol_std_excess_{h}d'] = standardized_excess
        
        # Binary directional target: 1 if profitable net of costs, 0 otherwise
        target_series = (net_ret > 0.0).astype(float)
        target_series[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_{h}d'] = target_series

    return df

def assign_cross_sectional_relevance_grades(
    panel_df: pd.DataFrame, 
    horizons: list = [5, 20]
) -> pd.DataFrame:
    """
    Computes discrete relevance grades (0 to 4) per trading session for LambdaMART ranking.
    Grade 4: Top 10% standardized excess return
    Grade 3: 75th to 90th percentile
    Grade 2: 50th to 75th percentile
    Grade 1: 25th to 50th percentile
    Grade 0: Bottom 25%
    """
    df = panel_df.copy()
    if 'predictionTimestamp' in df.columns:
        date_series = pd.to_datetime(df['predictionTimestamp']).dt.strftime('%Y-%m-%d')
    elif isinstance(df.index, pd.DatetimeIndex):
        date_series = df.index.strftime('%Y-%m-%d')
    else:
        date_series = df.index.astype(str)
        
    df['date_group'] = date_series
    
    for h in horizons:
        col = f'target_vol_std_excess_{h}d'
        if col not in df.columns:
            continue
            
        def _compute_grades(group: pd.Series) -> pd.Series:
            ranks = group.rank(pct=True)
            grades = pd.Series(0.0, index=group.index)
            grades[ranks >= 0.25] = 1.0
            grades[ranks >= 0.50] = 2.0
            grades[ranks >= 0.75] = 3.0
            grades[ranks >= 0.90] = 4.0
            grades[group.isna()] = np.nan
            return grades
            
        df[f'target_rank_grade_{h}d'] = df.groupby('date_group')[col].transform(_compute_grades)
        
    return df



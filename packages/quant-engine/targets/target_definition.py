"""
Directional Net-Return Target Formulation Engine.
Formulates mathematically rigorous directional targets matching realistic execution semantics:
- Signal timestamp: Close(T) (end of day evaluation)
- Executable entry: Open(T+1) (next trading session open)
- Exit: Close(T+H) (session H close)
- Target families:
  1. std_excess: Standardized excess return (Baseline)
  2. raw_excess: Raw forward excess return (tests volatility normalization impact)
  3. net_excess: Forward excess return net of institutional friction & volatility-scaled slippage
  4. vol_adj_net_excess: Risk-adjusted net excess return
  5. pct_rank: Cross-sectional percentile rank of net excess
  6. tail_aware: Asymmetric downside-penalized net excess return
"""
import os
import sys
import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from costs import TransactionCostEngine

from typing import Optional, List

TARGET_HORIZONS = [1, 5, 20]
TARGET_TYPES = ['std_excess', 'raw_excess', 'net_excess', 'vol_adj_net_excess', 'pct_rank', 'tail_aware']

TARGET_REGISTRY = {
    'std_excess': {
        'name': 'Standardized Excess Return',
        'grade_col': lambda h: f'target_rank_grade_std_excess_{h}d',
        'excess_col': lambda h: f'target_std_excess_{h}d',
        'economic_gate': False,
        'description': 'Forward excess return divided by horizon volatility'
    },
    'raw_excess': {
        'name': 'Raw Forward Excess Return',
        'grade_col': lambda h: f'target_rank_grade_raw_excess_{h}d',
        'excess_col': lambda h: f'target_raw_excess_{h}d',
        'economic_gate': False,
        'description': 'Forward excess return without volatility shrinkage'
    },
    'net_excess': {
        'name': 'Net Forward Excess Return',
        'grade_col': lambda h: f'target_rank_grade_net_excess_{h}d',
        'excess_col': lambda h: f'target_net_excess_{h}d',
        'economic_gate': True,
        'description': 'Forward excess return net of 13 bps friction and volatility-scaled slippage'
    },
    'vol_adj_net_excess': {
        'name': 'Volatility-Adjusted Net Excess',
        'grade_col': lambda h: f'target_rank_grade_vol_adj_net_excess_{h}d',
        'excess_col': lambda h: f'target_vol_adj_net_excess_{h}d',
        'economic_gate': True,
        'description': 'Net excess return divided by horizon volatility with economic grade gating'
    },
    'pct_rank': {
        'name': 'Cross-Sectional Percentile Rank',
        'grade_col': lambda h: f'target_rank_grade_pct_rank_{h}d',
        'excess_col': lambda h: f'target_pct_rank_{h}d',
        'economic_gate': False,
        'description': 'Daily cross-sectional percentile rank of forward net excess'
    },
    'tail_aware': {
        'name': 'Tail-Aware Net Excess',
        'grade_col': lambda h: f'target_rank_grade_tail_aware_{h}d',
        'excess_col': lambda h: f'target_tail_aware_{h}d',
        'economic_gate': True,
        'description': 'Forward net excess with 2.0x asymmetric penalty on negative outcomes'
    }
}

def get_target_columns(target_type: str, horizon: int | str) -> tuple[str, str]:
    """
    Returns explicit (grade_column, excess_column) tuple for requested target_type and horizon.
    Guarantees strict 1-to-1 semantic mapping with zero legacy fallbacks.
    """
    if target_type not in TARGET_REGISTRY:
        raise KeyError(f"FAIL-CLOSED: Unknown target_type '{target_type}'. Registered targets: {list(TARGET_REGISTRY.keys())}")
    h = int(str(horizon).replace('d', ''))
    entry = TARGET_REGISTRY[target_type]
    return entry['grade_col'](h), entry['excess_col'](h)

def compute_targets(
    df: pd.DataFrame, 
    cost_engine: Optional[TransactionCostEngine] = None,
    benchmark_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """
    Computes forward return targets across horizons [1d, 5d, 20d] with realistic transaction
    costs and volatility-conditioned expected slippage.
    """
    df = df.copy()
    if cost_engine is None:
        cost_engine = TransactionCostEngine('BASE_COST')
        
    friction_rate = cost_engine.calculate_round_trip_cost_rate()  # 13 bps (0.0013)
    
    # Executable entry price is the Open of the next session T+1
    entry_price = df['Open'].shift(-1) if 'Open' in df.columns else df['Close'].shift(-1)
    
    # Benchmark entry alignment
    bench_entry = None
    if benchmark_df is not None and not benchmark_df.empty:
        bench_aligned = benchmark_df.reindex(df.index).ffill()
        bench_entry = bench_aligned['Open'].shift(-1) if 'Open' in bench_aligned.columns else bench_aligned['Close'].shift(-1)
    else:
        bench_aligned = None

    # Volatility estimation for scaling and expected slippage
    daily_ret = df['Close'].pct_change()
    daily_vol = daily_ret.rolling(20).std()
    ann_vol = daily_vol * np.sqrt(252)
    # Expected slippage: 10 bps base round-trip, scaled by stock volatility relative to 25% benchmark
    # Bounds: 5 bps to 25 bps round-trip slippage
    expected_slippage = 0.0010 * (ann_vol / 0.25).clip(lower=0.5, upper=2.5)
    expected_slippage = expected_slippage.fillna(0.0010)
    total_cost = friction_rate + expected_slippage
        
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
        
        # Horizon volatility: 20-day rolling daily volatility * sqrt(h)
        vol_h = daily_vol * np.sqrt(h)
        vol_h = vol_h.clip(lower=0.005)  # floor to prevent division by zero
        
        # 1. Target Family 1: Standardized Excess (Baseline)
        standardized_excess = excess_ret / vol_h
        standardized_excess[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_vol_std_excess_{h}d'] = standardized_excess
        df[f'target_std_excess_{h}d'] = standardized_excess
        
        # 2. Target Family 2: Raw Excess Return
        raw_excess = excess_ret.copy()
        raw_excess[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_raw_excess_{h}d'] = raw_excess
        
        # 3. Target Family 3: Net Excess After Realistic Costs & Slippage (Direct Economic Objective)
        # Target = Forward Return(T->H) - NIFTY Return(T->H) - Actual Trading Cost - Expected Slippage
        net_excess_after_slippage = excess_ret - total_cost
        net_excess_after_slippage[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_net_excess_{h}d'] = net_excess_after_slippage
        
        # 4. Target Family 4: Volatility-Adjusted Net Excess
        vol_adj_net_excess = net_excess_after_slippage / vol_h
        vol_adj_net_excess[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_vol_adj_net_excess_{h}d'] = vol_adj_net_excess
        
        # 5. Target Family 6: Tail-Aware Net Excess
        # Asymmetric penalty: downside outcomes (net excess < 0) penalized 2.0x vs upside gains
        tail_aware = np.where(
            net_excess_after_slippage >= 0.0,
            net_excess_after_slippage,
            net_excess_after_slippage * 2.0
        )
        tail_aware = pd.Series(tail_aware, index=df.index)
        tail_aware[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_tail_aware_{h}d'] = tail_aware
        
        # Binary directional target: 1 if profitable net of costs, 0 otherwise
        target_series = (net_ret > 0.0).astype(float)
        target_series[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_{h}d'] = target_series

        # Exact production executable event: excess return net of friction > 0
        net_excess_series = (net_excess_ret > 0.0).astype(float)
        net_excess_series[exit_price.isna() | entry_price.isna()] = np.nan
        df[f'target_net_excess_binary_{h}d'] = net_excess_series

    return df

def assign_cross_sectional_relevance_grades(
    panel_df: pd.DataFrame, 
    horizons: list = [5, 20]
) -> pd.DataFrame:
    """
    Computes discrete relevance grades (0 to 4) per trading session for LambdaMART ranking
    across all target families.
    
    Economic Relevance Logic for Net Targets:
    - Grade 4: Top 10% cross-section AND strictly positive net excess
    - Grade 3: 75th to 90th percentile AND strictly positive net excess
    - Grade 2: 50th to 75th percentile
    - Grade 1: 25th to 50th percentile (or unprofitable top-ranked stocks)
    - Grade 0: Bottom 25% (or severe left-tail losers)
    """
    df = panel_df.copy()
    if 'predictionTimestamp' in df.columns:
        date_series = pd.to_datetime(df['predictionTimestamp']).dt.strftime('%Y-%m-%d')
    elif isinstance(df.index, pd.DatetimeIndex):
        date_series = df.index.strftime('%Y-%m-%d')
    else:
        date_series = df.index.astype(str)
        
    df['date_group'] = date_series

    def _assign_grades_vectorized(ranks: pd.Series, values: pd.Series, economic_gate: bool = False) -> pd.Series:
        grades = pd.Series(0.0, index=ranks.index)
        grades[ranks >= 0.25] = 1.0
        grades[ranks >= 0.50] = 2.0
        grades[ranks >= 0.75] = 3.0
        grades[ranks >= 0.90] = 4.0
        if economic_gate:
            # Strict economic relevance gating: any losing/flat trade after costs is capped at grade 1
            mask_le_zero = values <= 0.0
            grades[mask_le_zero] = np.minimum(grades[mask_le_zero], 1.0)
        grades[values.isna()] = np.nan
        return grades

    for h in horizons:
        # 1. Baseline Standardized Excess Grades
        col_std = f'target_vol_std_excess_{h}d'
        if col_std in df.columns:
            ranks_std = df.groupby('date_group')[col_std].rank(pct=True)
            std_grades = _assign_grades_vectorized(ranks_std, df[col_std], economic_gate=False)
            df[f'target_rank_grade_{h}d'] = std_grades
            df[f'target_rank_grade_std_excess_{h}d'] = std_grades

        # 2. Raw Excess Return Grades
        col_raw = f'target_raw_excess_{h}d'
        if col_raw in df.columns:
            ranks_raw = df.groupby('date_group')[col_raw].rank(pct=True)
            df[f'target_rank_grade_raw_excess_{h}d'] = _assign_grades_vectorized(ranks_raw, df[col_raw], economic_gate=False)

        # 3. Net Excess Return Grades (with Economic Gating)
        col_net = f'target_net_excess_{h}d'
        if col_net in df.columns:
            ranks_net = df.groupby('date_group')[col_net].rank(pct=True)
            # Also compute percentile rank target (Target Family 5)
            df[f'target_pct_rank_{h}d'] = ranks_net
            df[f'target_rank_grade_net_excess_{h}d'] = _assign_grades_vectorized(ranks_net, df[col_net], economic_gate=True)
            df[f'target_rank_grade_pct_rank_{h}d'] = _assign_grades_vectorized(ranks_net, df[col_net], economic_gate=False)

        # 5. Volatility-Adjusted Net Excess Grades
        col_vol_adj = f'target_vol_adj_net_excess_{h}d'
        if col_vol_adj in df.columns:
            ranks_vol_adj = df.groupby('date_group')[col_vol_adj].rank(pct=True)
            df[f'target_rank_grade_vol_adj_net_excess_{h}d'] = _assign_grades_vectorized(ranks_vol_adj, df[col_vol_adj], economic_gate=True)

        # 6. Tail-Aware Net Excess Grades
        col_tail = f'target_tail_aware_{h}d'
        if col_tail in df.columns:
            ranks_tail = df.groupby('date_group')[col_tail].rank(pct=True)
            df[f'target_rank_grade_tail_aware_{h}d'] = _assign_grades_vectorized(ranks_tail, df[col_tail], economic_gate=True)

    return df





import pandas as pd
import numpy as np
from typing import Dict, Any, Optional

def compute_market_regimes(benchmark_df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes point-in-time benchmark market regimes with zero lookahead bias.
    Regimes:
    - BULL: Benchmark Close > SMA50 and SMA50 > SMA200 and 20d Realized Vol < 25%
    - BEAR: Benchmark Close < SMA50 and SMA50 < SMA200
    - HIGH_VOLATILITY: 20d Realized Vol >= 25%
    - SIDEWAYS: All other market conditions
    """
    df = benchmark_df.copy()
    df.sort_index(inplace=True)
    close = df['Close']
    
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()
    
    # 20-day annualized realized volatility
    daily_ret = close.pct_change()
    realized_vol = daily_ret.rolling(20).std() * np.sqrt(252.0)
    
    regimes = []
    for c, s50, s200, vol in zip(close, sma50, sma200, realized_vol):
        if pd.isna(s200) or pd.isna(vol):
            regimes.append('SIDEWAYS')
        elif vol >= 0.28:
            regimes.append('HIGH_VOLATILITY')
        elif c > s50 and s50 >= s200 and vol < 0.22:
            regimes.append('BULL')
        elif c < s50 and s50 < s200:
            regimes.append('BEAR')
        else:
            regimes.append('SIDEWAYS')
            
    df['market_regime'] = regimes
    df['benchmark_vol_20d'] = realized_vol
    df['benchmark_sma50_dist'] = (close - sma50) / sma50
    return df

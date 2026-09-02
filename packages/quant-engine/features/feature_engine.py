"""
Strict Point-in-Time Quantitative Feature Engineering Engine.
Generates 25 deterministic technical, momentum, volatility, and benchmark features with zero lookahead bias.
"""
import pandas as pd
import numpy as np
from typing import List, Optional

FEATURE_NAMES: List[str] = [
    'rsi_14',
    'macd_hist',
    'sma_20_dist',
    'sma_50_dist',
    'ema_20_dist',
    'atr_percent',
    'bb_width',
    'stoch_k',
    'volume_z_score',
    'annualized_volatility',
    'downside_deviation',
    'beta_nifty',
    'relative_strength_nifty',
    'momentum_5',
    'momentum_20',
    'ret_1d',
    'ret_5d',
    'ret_20d',
    'gap_pct',
    'dist_52w_high',
    'dist_52w_low',
    'roc_12',
    'rel_volume',
    'vol_20d',
    'vol_60d',
]

def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df['High'] if 'High' in df.columns else df['Close']
    low = df['Low'] if 'Low' in df.columns else df['Close']
    close = df['Close']
    high_low = high - low
    high_close = (high - close.shift(1)).abs()
    low_close = (low - close.shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.rolling(period).mean()

def calculate_features(df: pd.DataFrame, benchmark_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """
    Computes all 25 point-in-time features strictly using historical candles at or before timestamp t.
    NaN values during warm-up periods are preserved (not filled with synthetic constants)
    and handled by downstream dropna() in train_model.py.
    """
    df = df.copy()
    df.sort_index(inplace=True)
    
    # Require actual OHLCV columns — do not fabricate synthetic price/volume data
    if 'Close' not in df.columns:
        raise ValueError("DataFrame must contain 'Close' column. Cannot fabricate synthetic prices.")
    close = df['Close']
    if 'Open' not in df.columns or 'High' not in df.columns or 'Low' not in df.columns:
        raise ValueError("DataFrame must contain 'Open', 'High', 'Low' columns.")
    open_p = df['Open']
    high = df['High']
    low = df['Low']
    vol = df['Volume'] if 'Volume' in df.columns else pd.Series(np.nan, index=df.index)
    
    # 1. Momentum & Oscillators (NaN propagates naturally during warm-up)
    df['rsi_14'] = calculate_rsi(close, 14)
    
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    macd_signal = macd_line.ewm(span=9, adjust=False).mean()
    df['macd_hist'] = (macd_line - macd_signal) / close.replace(0, np.nan)
    
    low14 = low.rolling(14).min()
    high14 = high.rolling(14).max()
    df['stoch_k'] = 100 * (close - low14) / (high14 - low14).replace(0, np.nan)
    df['roc_12'] = close.pct_change(12) * 100
    
    # 2. Moving Average Distance & Trend
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    ema20 = close.ewm(span=20, adjust=False).mean()
    
    df['sma_20_dist'] = (close - sma20) / sma20.replace(0, np.nan)
    df['sma_50_dist'] = (close - sma50) / sma50.replace(0, np.nan)
    df['ema_20_dist'] = (close - ema20) / ema20.replace(0, np.nan)
    
    # 3. Volatility & Bands
    atr14 = calculate_atr(df, 14)
    df['atr_percent'] = atr14 / close.replace(0, np.nan)
    
    std20 = close.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    df['bb_width'] = (bb_upper - bb_lower) / sma20.replace(0, np.nan)
    
    daily_returns = close.pct_change()
    df['vol_20d'] = daily_returns.rolling(20).std() * np.sqrt(252)
    df['vol_60d'] = daily_returns.rolling(60).std() * np.sqrt(252)
    df['annualized_volatility'] = df['vol_20d']
    
    downside_returns = daily_returns.clip(upper=0)
    df['downside_deviation'] = downside_returns.rolling(20).std() * np.sqrt(252)
    
    # 4. Multi-Horizon Returns & Price Action
    df['ret_1d'] = close.pct_change(1)
    df['ret_5d'] = close.pct_change(5)
    df['ret_20d'] = close.pct_change(20)
    df['momentum_5'] = df['ret_5d']
    df['momentum_20'] = df['ret_20d']
    
    prev_close = close.shift(1)
    df['gap_pct'] = (open_p - prev_close) / prev_close.replace(0, np.nan)
    
    rolling_252_high = high.rolling(252, min_periods=252).max()
    rolling_252_low = low.rolling(252, min_periods=252).min()
    df['dist_52w_high'] = (close - rolling_252_high) / rolling_252_high.replace(0, np.nan)
    df['dist_52w_low'] = (close - rolling_252_low) / rolling_252_low.replace(0, np.nan)
    
    # 5. Volume Features
    vol_mean_20 = vol.rolling(20).mean()
    vol_std_20 = vol.rolling(20).std().replace(0, np.nan)
    df['volume_z_score'] = ((vol - vol_mean_20) / vol_std_20).clip(-3.0, 3.0)
    df['rel_volume'] = (vol / vol_mean_20.replace(0, np.nan)).clip(0.1, 10.0)
    
    # 6. Benchmark Features (Nifty 50)
    if benchmark_df is not None and len(benchmark_df) > 0:
        bench_close = benchmark_df['Close'].reindex(df.index).ffill()
        bench_returns = bench_close.pct_change()
        
        # 60-day rolling Beta vs Nifty
        cov = daily_returns.rolling(60).cov(bench_returns)
        var_bench = bench_returns.rolling(60).var().replace(0, np.nan)
        df['beta_nifty'] = (cov / var_bench).clip(0.2, 3.0)
        
        # 20-day Relative Strength vs Nifty
        stock_perf_20 = close.pct_change(20)
        bench_perf_20 = bench_close.pct_change(20)
        df['relative_strength_nifty'] = stock_perf_20 - bench_perf_20
    else:
        df['beta_nifty'] = np.nan
        df['relative_strength_nifty'] = np.nan
        
    # Replace Inf/-Inf with NaN but do NOT fill NaN with synthetic constants.
    # NaN rows are warm-up rows that will be dropped by train_model.py's dropna().
    for feat in FEATURE_NAMES:
        if feat not in df.columns:
            df[feat] = np.nan
        df[feat] = df[feat].replace([np.inf, -np.inf], np.nan)
        
    # Required row-level flag: featureWarmupComplete = true iff every feature is valid non-NaN
    df['featureWarmupComplete'] = df[FEATURE_NAMES].notna().all(axis=1)
        
    return df

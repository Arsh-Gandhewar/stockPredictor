"""
Strict Point-in-Time Quantitative Feature Engineering Engine.
Generates 31 deterministic technical, momentum, volatility, benchmark, and regime meta-features
with zero lookahead bias.

Phase 2 additions (P1-4 Regime-Conditional Alpha):
  - market_vol_regime: stock vol_20d rolling 252D percentile (0-1).
    Measures whether the stock is currently in a high/low-vol environment.
  - market_trend_60d: sign of NIFTY 60D SMA slope (+1 bull / -1 bear). Tells ranker
    whether the broad market is trending up or down.
  - breadth_pct_above_20ma: fraction of universe (the panel cross-section on that date)
    whose price is above their 20D SMA. Populated cross-sectionally in the walk-forward
    engine via enrich_panel_with_regime_features(); filled to 0.5 until then.
  - vix_percentile_252d: India VIX 252-day rolling percentile (0-1). High values signal
    crisis / high-fear regimes; populated in walk-forward engine.
  - cross_sec_vol_rank: stock's vol_20d percentile rank within the daily cross-section.
    Differentiates high-vol vs low-vol names on the same day.
  - adv_decline_ratio: advance/decline ratio of the cross-section on that day.
    Populated cross-sectionally; filled to 1.0 until enrichment.
"""
import pandas as pd
import numpy as np
from typing import List, Optional

FEATURE_NAMES: List[str] = [
    # ── Original 25 features ──────────────────────────────────────────────────
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
    # ── Phase 2: Regime meta-features (P1-4) ─────────────────────────────────
    'market_vol_regime',
    'market_trend_60d',
    'breadth_pct_above_20ma',
    'vix_percentile_252d',
    'cross_sec_vol_rank',
    'adv_decline_ratio',
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

        # ── Phase 2 P1-4: Per-stock regime features computable per-security ──
        # market_vol_regime: rolling 60D percentile rank of vol_20d for THIS stock.
        # Use min_periods=20 to match vol_20d warmup — no additional NaN rows added.
        # Values near 1.0 → currently high-vol vs recent history; near 0.0 → calm.
        # NOTE: Changed from 252D to 60D window to avoid adding ~60 extra NaN rows
        # per stock at the start of their history (which would corrupt early folds).
        vol_regime_rolling = df['vol_20d'].rolling(60, min_periods=20)
        df['market_vol_regime'] = vol_regime_rolling.rank(pct=True)

        # market_trend_60d: sign of NIFTY 60D SMA slope. +1 = bull, -1 = bear, 0 = flat.
        # Fill early NaN (first 65 days) with 0.0 (neutral) to avoid dropping warmup rows.
        bench_sma60 = bench_close.rolling(60).mean()
        bench_sma60_lag5 = bench_sma60.shift(5)
        bench_slope = (bench_sma60 - bench_sma60_lag5) / bench_sma60_lag5.replace(0, np.nan)
        df['market_trend_60d'] = np.sign(bench_slope).fillna(0.0)
    else:
        df['beta_nifty'] = np.nan
        df['relative_strength_nifty'] = np.nan
        df['market_vol_regime'] = np.nan
        df['market_trend_60d'] = np.nan

    # 7. Phase 2: Cross-sectional regime features (populated by enrich_panel_with_regime_features).
    # Initialized to neutral defaults so downstream code works before enrichment.
    # breadth_pct_above_20ma → 0.5 (50% breadth = neutral)
    # vix_percentile_252d → 0.5 (VIX at median = neutral)
    # adv_decline_ratio → 1.0 (equal advances and declines)
    # cross_sec_vol_rank → populated per stock in enrich_panel_with_regime_features
    if 'breadth_pct_above_20ma' not in df.columns:
        df['breadth_pct_above_20ma'] = 0.5
    if 'vix_percentile_252d' not in df.columns:
        df['vix_percentile_252d'] = 0.5
    if 'adv_decline_ratio' not in df.columns:
        df['adv_decline_ratio'] = 1.0
    if 'cross_sec_vol_rank' not in df.columns:
        df['cross_sec_vol_rank'] = 0.5

    # Replace Inf/-Inf with NaN but do NOT fill NaN with synthetic constants.
    # NaN rows are warm-up rows that will be dropped by train_model.py's dropna().
    for feat in FEATURE_NAMES:
        if feat not in df.columns:
            df[feat] = np.nan
        df[feat] = df[feat].replace([np.inf, -np.inf], np.nan)
        
    # Required row-level flag: featureWarmupComplete = true iff every feature is valid non-NaN
    df['featureWarmupComplete'] = df[FEATURE_NAMES].notna().all(axis=1)
        
    return df


def enrich_panel_with_regime_features(
    panel_df: pd.DataFrame,
    vix_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """
    Computes cross-sectional regime meta-features that require seeing the entire universe
    on a given date simultaneously. Must be called ONCE on the full stacked panel after all
    per-security calculate_features() calls are complete.

    Features computed:
      - breadth_pct_above_20ma: fraction of stocks in the cross-section with sma_20_dist > 0
        on each date. Pure point-in-time: sma_20_dist is already computed per stock.
      - cross_sec_vol_rank: each stock's vol_20d percentile rank within the daily cross-section.
        Tells the ranker whether a stock is a high- or low-vol name relative to peers TODAY.
      - adv_decline_ratio: (# stocks with ret_1d > 0) / (# stocks with ret_1d <= 0) per day.
        Breadth-based sentiment indicator from the daily universe.
      - vix_percentile_252d: India VIX 252-day rolling percentile of the VIX close.
        Broadcast to every row on that date. If vix_df is None, defaults to 0.5.

    Args:
        panel_df: The stacked panel with a DatetimeIndex and 'predictionTimestamp' column.
        vix_df:   Optional VIX DataFrame with 'Close' column and DatetimeIndex.

    Returns:
        panel_df with the four cross-sectional regime features filled in.
    """
    panel_df = panel_df.copy()
    date_col = 'predictionTimestamp'

    # ── 1. VIX 252D Rolling Percentile (broadcast to all stocks on each date) ────────────
    if vix_df is not None and len(vix_df) > 0:
        vix_close = vix_df['Close'].sort_index()
        vix_pct = vix_close.rolling(252, min_periods=60).rank(pct=True)
        # Map each trading date in the panel to its VIX percentile
        vix_pct_by_date = {}
        for dt in vix_pct.index:
            date_str = dt.strftime('%Y-%m-%d')
            vix_pct_by_date[date_str] = float(vix_pct[dt])
        panel_df['vix_percentile_252d'] = panel_df[date_col].map(vix_pct_by_date).fillna(0.5)
    else:
        panel_df['vix_percentile_252d'] = 0.5

    # ── 2-4. Cross-sectional features: computed per trading date ─────────────────────────
    # Group by date once, vectorized
    dates = panel_df[date_col].values
    sma_20_dist = panel_df['sma_20_dist'].values
    vol_20d = panel_df['vol_20d'].values
    ret_1d = panel_df['ret_1d'].values

    breadth_arr = np.full(len(panel_df), 0.5, dtype=np.float64)
    vol_rank_arr = np.full(len(panel_df), 0.5, dtype=np.float64)
    adv_dec_arr = np.full(len(panel_df), 1.0, dtype=np.float64)

    unique_dates, inverse_idx = np.unique(dates, return_inverse=True)
    for i, d in enumerate(unique_dates):
        mask = (inverse_idx == i)
        # breadth
        dist_slice = sma_20_dist[mask]
        valid_dist = dist_slice[~np.isnan(dist_slice)]
        breadth_arr[mask] = float(np.mean(valid_dist > 0)) if len(valid_dist) > 0 else 0.5
        # cross-sectional vol rank
        vol_slice = vol_20d[mask]
        valid_vol = vol_slice.copy()
        n = len(valid_vol)
        if n > 1:
            not_nan = ~np.isnan(valid_vol)
            temp = np.argsort(np.argsort(np.where(not_nan, valid_vol, np.nan)))
            rank_pct = np.where(not_nan, temp / max(not_nan.sum() - 1, 1), 0.5)
            vol_rank_arr[mask] = rank_pct
        else:
            vol_rank_arr[mask] = 0.5
        # advance-decline
        ret_slice = ret_1d[mask]
        valid_ret = ret_slice[~np.isnan(ret_slice)]
        if len(valid_ret) > 0:
            advances = np.sum(valid_ret > 0)
            declines = np.sum(valid_ret <= 0)
            adv_dec_arr[mask] = float(advances) / float(max(declines, 1))
        else:
            adv_dec_arr[mask] = 1.0

    panel_df['breadth_pct_above_20ma'] = breadth_arr
    panel_df['cross_sec_vol_rank'] = vol_rank_arr
    panel_df['adv_decline_ratio'] = adv_dec_arr

    # Clip adv_decline_ratio to [0.1, 10] to prevent extreme values
    panel_df['adv_decline_ratio'] = panel_df['adv_decline_ratio'].clip(0.1, 10.0)

    return panel_df

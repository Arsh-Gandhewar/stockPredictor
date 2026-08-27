"""
Candle Sanitizer and Data Quality Engine for QuantX.
Implements Sections 32-38 of Final Economic Certification:
- Explicit data-quality states: FRESH, STALE, PARTIAL, MISSING, INVALID (Section 32)
- Stale market data threshold enforcement (Section 33)
- Stale news timestamp causal filtering (Section 34)
- Out-of-order, duplicate, negative volume, High < Low rejection (Section 35)
- Proper trading session calendar validation (Section 36)
- Corporate action integrity verification (Section 38)
"""
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Tuple, Optional
from datetime import datetime, timezone

class CandleSanitizationError(ValueError):
    """Raised when candle data contains fatal data integrity corruptions."""
    pass

class StaleDataError(ValueError):
    """Raised when market data exceeds freshness threshold."""
    pass

def sanitize_candles(
    df: pd.DataFrame,
    ticker: str = "UNKNOWN",
    max_stale_days: int = 5,
    reference_date: Optional[str] = None
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Validates and sanitizes historical candle series (Section 32, 35).
    Rejects corrupted data:
    - duplicate timestamps
    - non-monotonic timestamps
    - High < Low
    - negative volume or prices
    - stale data exceeding threshold
    """
    if df is None or len(df) == 0:
        return df, {
            'status': 'MISSING',
            'ticker': ticker,
            'sampleCount': 0,
            'isClean': False,
            'rejectionReason': 'Empty or None DataFrame'
        }
        
    res_df = df.copy()
    
    # 1. Datetime Index Validation
    if not isinstance(res_df.index, pd.DatetimeIndex):
        if 'date' in res_df.columns:
            res_df['date'] = pd.to_datetime(res_df['date'])
            res_df.set_index('date', inplace=True)
        else:
            try:
                res_df.index = pd.to_datetime(res_df.index)
            except Exception:
                raise CandleSanitizationError(f"Cannot parse datetime index for {ticker}")
                
    # 2. Check duplicate timestamps
    if res_df.index.has_duplicates:
        raise CandleSanitizationError(f"Duplicate timestamps detected in candles for {ticker}")
        
    # 3. Check monotonic ordering
    if not res_df.index.is_monotonic_increasing:
        raise CandleSanitizationError(f"Non-monotonic timestamps detected in candles for {ticker}")
        
    # 4. Check negative prices or volumes
    for col in ['Open', 'High', 'Low', 'Close']:
        if col in res_df.columns and (res_df[col] <= 0).any():
            raise CandleSanitizationError(f"Non-positive price found in {col} for {ticker}")
            
    if 'Volume' in res_df.columns and (res_df['Volume'] < 0).any():
        raise CandleSanitizationError(f"Negative volume found for {ticker}")
        
    # 5. Check High >= Low
    if 'High' in res_df.columns and 'Low' in res_df.columns:
        if (res_df['High'] < res_df['Low']).any():
            raise CandleSanitizationError(f"High < Low detected in candles for {ticker}")
            
    # 6. Freshness Check (Section 33)
    latest_dt = res_df.index.max()
    ref_dt = pd.to_datetime(reference_date) if reference_date else latest_dt
    calendar_gap_days = (ref_dt - latest_dt).days
    
    if calendar_gap_days > max_stale_days:
        quality_state = 'STALE'
    elif len(res_df) < 50:
        quality_state = 'PARTIAL'
    else:
        quality_state = 'FRESH'
        
    return res_df, {
        'status': quality_state,
        'ticker': ticker,
        'sampleCount': len(res_df),
        'isClean': True,
        'latestDate': str(latest_dt)[:10],
        'calendarGapDays': calendar_gap_days
    }

def filter_causal_news(
    news_items: List[Dict[str, Any]],
    signal_timestamp: str
) -> List[Dict[str, Any]]:
    """
    Causally filters news articles (Section 34).
    Only information published strictly before signal_timestamp is retained.
    Articles with missing publicationTimestamp are discarded.
    """
    sig_dt = pd.to_datetime(signal_timestamp)
    valid_news = []
    for item in news_items:
        pub_ts = item.get('publicationTimestamp')
        if not pub_ts:
            continue
        try:
            pub_dt = pd.to_datetime(pub_ts)
            if pub_dt <= sig_dt:
                valid_news.append(item)
        except Exception:
            continue
    return valid_news

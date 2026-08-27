"""
Point-in-Time Deterministic Market Regime Engine.
Computes macroeconomic market regimes (BULL, BEAR, SIDEWAYS, HIGH_VOLATILITY, PANIC)
with strict point-in-time causal verification and zero future lookahead.
"""
from typing import Dict, Any, Optional, Union, List
import pandas as pd
import numpy as np

MIN_REGIME_SAMPLE_COUNT = 250

class RegimeLookaheadError(ValueError):
    """Raised when future market data or lookahead information leaks into regime classification."""
    pass

class MarketRegimeEngine:
    """
    Deterministic single source of truth for point-in-time market regime classification.
    Evaluates:
    - Benchmark (NIFTY 50) trend, moving averages, 5d return, and 20d realized volatility
    - INDIA VIX volatility shock detection
    - Deterministic priority order: PANIC > HIGH_VOLATILITY > BEAR > BULL > SIDEWAYS
    """
    VERSION = "v5.0.0-deterministic-regime"
    ALLOWED_REGIMES = ['PANIC', 'HIGH_VOLATILITY', 'BEAR', 'BULL', 'SIDEWAYS']
    
    def __init__(
        self,
        benchmark_df: pd.DataFrame,
        vix_df: Optional[pd.DataFrame] = None
    ):
        self.benchmark_df = benchmark_df.copy()
        self.benchmark_df.index = pd.to_datetime(self.benchmark_df.index)
        self.benchmark_df.sort_index(inplace=True)
        
        self.vix_df = None
        if vix_df is not None and not vix_df.empty:
            self.vix_df = vix_df.copy()
            self.vix_df.index = pd.to_datetime(self.vix_df.index)
            self.vix_df.sort_index(inplace=True)
            
        self._validate_inputs(self.benchmark_df, self.vix_df)
        self._precomputed_history: Optional[pd.DataFrame] = None

    def _validate_inputs(self, b_df: pd.DataFrame, v_df: Optional[pd.DataFrame]) -> None:
        """Enforce strict causal schema: no future_* columns allowed."""
        for col in b_df.columns:
            if str(col).startswith('future_'):
                raise RegimeLookaheadError(f"CRITICAL CAUSAL LEAKAGE: Future column '{col}' detected in benchmark data!")
        if v_df is not None:
            for col in v_df.columns:
                if str(col).startswith('future_'):
                    raise RegimeLookaheadError(f"CRITICAL CAUSAL LEAKAGE: Future column '{col}' detected in VIX data!")

    def classify_date(self, as_of_date: Union[str, pd.Timestamp]) -> Dict[str, Any]:
        """
        Classifies market regime for a single date T using strictly data <= T.
        Raises RegimeLookaheadError if future timestamps or future leakage are detected.
        """
        ts = pd.to_datetime(as_of_date)
        ts_str = str(ts)[:10]
        
        # 1. Causal Slice: data <= T
        b_slice = self.benchmark_df.loc[self.benchmark_df.index <= ts]
        if b_slice.empty:
            return {
                'regime': 'SIDEWAYS',
                'regimeConfidence': None,
                'regimeVersion': self.VERSION,
                'regimeFeatureTimestamp': ts_str,
                'sourceTimestamp': ts_str,
                'status': 'INSUFFICIENT_DATA',
                'metrics': {}
            }
            
        # Assert strict causal timestamp bound
        max_source_ts = b_slice.index.max()
        if max_source_ts > ts:
            raise RegimeLookaheadError(f"CRITICAL CAUSAL LEAKAGE: max(regimeSourceTimestamp) {max_source_ts} > signalTimestamp {ts}")
            
        close_series = b_slice['Close'].astype(float)
        current_close = float(close_series.iloc[-1])
        
        # Compute point-in-time indicators
        n_obs = len(close_series)
        sma20 = float(close_series.rolling(20).mean().iloc[-1]) if n_obs >= 20 else current_close
        sma50 = float(close_series.rolling(50).mean().iloc[-1]) if n_obs >= 50 else current_close
        sma200 = float(close_series.rolling(200).mean().iloc[-1]) if n_obs >= 200 else current_close
        
        daily_ret = close_series.pct_change().dropna()
        realized_vol_20d = float(daily_ret.tail(20).std() * np.sqrt(252.0)) if len(daily_ret) >= 20 else 0.15
        ret_5d = float(close_series.iloc[-1] / close_series.iloc[-6] - 1.0) if n_obs >= 6 else 0.0
        
        peak_20d = float(close_series.tail(20).max()) if n_obs >= 20 else current_close
        drawdown_20d = float((current_close - peak_20d) / peak_20d) if peak_20d > 0 else 0.0
        
        # VIX point-in-time lookup
        current_vix = None
        if self.vix_df is not None:
            v_slice = self.vix_df.loc[self.vix_df.index <= ts]
            if not v_slice.empty:
                current_vix = float(v_slice['Close'].iloc[-1])
                
        # 2. Priority Dispatch: PANIC > HIGH_VOLATILITY > BEAR > BULL > SIDEWAYS
        is_panic = False
        is_high_vol = False
        is_bear = False
        is_bull = False
        
        # PANIC: VIX >= 28.0 OR 5d return <= -5.0% OR (20d drawdown <= -10% and VIX >= 24)
        if (current_vix is not None and current_vix >= 28.0) or (ret_5d <= -0.05) or (drawdown_20d <= -0.10 and (current_vix is None or current_vix >= 24.0)):
            is_panic = True
            
        # HIGH_VOLATILITY: Realized vol >= 24.0% OR VIX >= 22.0
        if realized_vol_20d >= 0.24 or (current_vix is not None and current_vix >= 22.0):
            is_high_vol = True
            
        # BEAR: Close < SMA50 and SMA50 < SMA200 (or Close < SMA200 and return_5d < -0.02)
        if (current_close < sma50 and sma50 < sma200) or (current_close < sma200 and ret_5d < -0.02):
            is_bear = True
            
        # BULL: Close > SMA50 and SMA50 >= SMA200 and realized vol < 20% and (VIX < 20 if available)
        vix_ok = current_vix is None or current_vix < 20.0
        if current_close > sma50 and sma50 >= sma200 and realized_vol_20d < 0.20 and vix_ok:
            is_bull = True
            
        # Determine deterministic regime
        if is_panic:
            regime = 'PANIC'
            # Confidence based on distance past panic threshold
            vix_excess = max(0.0, (current_vix - 28.0) / 10.0) if current_vix is not None else 0.0
            ret_excess = max(0.0, (-ret_5d - 0.05) / 0.05)
            confidence = min(1.0, 0.70 + 0.30 * max(vix_excess, ret_excess))
        elif is_high_vol:
            regime = 'HIGH_VOLATILITY'
            vol_excess = max(0.0, (realized_vol_20d - 0.24) / 0.10)
            confidence = min(1.0, 0.65 + 0.35 * vol_excess)
        elif is_bear:
            regime = 'BEAR'
            dist_sma50 = (sma50 - current_close) / sma50 if sma50 > 0 else 0.0
            confidence = min(1.0, 0.60 + 0.40 * min(1.0, max(0.0, dist_sma50 / 0.05)))
        elif is_bull:
            regime = 'BULL'
            dist_sma50 = (current_close - sma50) / sma50 if sma50 > 0 else 0.0
            confidence = min(1.0, 0.60 + 0.40 * min(1.0, max(0.0, dist_sma50 / 0.05)))
        else:
            regime = 'SIDEWAYS'
            confidence = 0.50
            
        return {
            'regime': regime,
            'regimeConfidence': round(float(confidence), 4),
            'regimeVersion': self.VERSION,
            'regimeFeatureTimestamp': ts_str,
            'sourceTimestamp': str(max_source_ts)[:10],
            'status': 'VALID',
            'metrics': {
                'close': current_close,
                'sma50': sma50,
                'sma200': sma200,
                'realizedVol20d': realized_vol_20d,
                'vix': current_vix,
                'ret5d': ret_5d,
                'drawdown20d': drawdown_20d
            }
        }

    def classify_history(self) -> pd.DataFrame:
        """
        Precomputes regime across all dates in the benchmark index with zero lookahead.
        """
        records = []
        for d in self.benchmark_df.index:
            info = self.classify_date(d)
            records.append({
                'date': str(d)[:10],
                'regime': info['regime'],
                'regimeConfidence': info['regimeConfidence'],
                'regimeVersion': info['regimeVersion'],
                'sourceTimestamp': info['sourceTimestamp']
            })
        df = pd.DataFrame(records)
        df.set_index('date', inplace=True)
        self._precomputed_history = df
        return df

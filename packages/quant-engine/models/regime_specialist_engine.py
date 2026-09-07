"""
Point-in-Time Deterministic Regime Specialist Engine.
=====================================================
Partitions macro market state into 8 robust economic regimes:
    Bull / Bear x LowVol / HighVol x Trending / MeanReverting
with strict causal point-in-time verification and 3-day persistence hysteresis.
"""
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, Union, List

# Canonical 8 regime states
CANONICAL_REGIME_STATES = [
    'BULL_LOWVOL_TREND',
    'BULL_LOWVOL_CHOPPY',
    'BULL_HIGHVOL_TREND',
    'BULL_HIGHVOL_CHOPPY',
    'BEAR_LOWVOL_TREND',
    'BEAR_LOWVOL_CHOPPY',
    'BEAR_HIGHVOL_TREND',
    'BEAR_HIGHVOL_CHOPPY',
]

DEFAULT_FALLBACK_REGIME = 'BULL_LOWVOL_CHOPPY'


class RegimeSpecialistEngine:
    """
    Deterministic, point-in-time engine for classifying macro market regimes.
    Observable features:
    1. Trend (Bull vs Bear): Benchmark Close > SMA200
    2. Volatility (LowVol vs HighVol): 20d annualized realized volatility < 18%
    3. Structure (Trending vs MeanReverting/Choppy): 20d Kaufman Efficiency Ratio >= 0.25
    4. Persistence Filter: 3-day confirmation hysteresis to eliminate noise-driven flickering.
    """

    def __init__(
        self,
        benchmark_df: pd.DataFrame,
        vol_threshold: float = 0.18,
        er_threshold: float = 0.25,
        confirmation_days: int = 3
    ):
        self.benchmark_df = benchmark_df.copy()
        if 'Date' in self.benchmark_df.columns:
            self.benchmark_df['date_dt'] = pd.to_datetime(self.benchmark_df['Date'])
            self.benchmark_df.set_index('date_dt', inplace=True)
        elif 'timestamp' in self.benchmark_df.columns:
            self.benchmark_df['date_dt'] = pd.to_datetime(self.benchmark_df['timestamp'])
            self.benchmark_df.set_index('date_dt', inplace=True)
        elif not isinstance(self.benchmark_df.index, pd.DatetimeIndex):
            self.benchmark_df.index = pd.to_datetime(self.benchmark_df.index)

        self.benchmark_df.sort_index(inplace=True)
        self.vol_threshold = vol_threshold
        self.er_threshold = er_threshold
        self.confirmation_days = confirmation_days
        self._precomputed_regimes: Optional[pd.DataFrame] = None
        self._date_to_regime: Dict[str, str] = {}
        self._compute_regimes()

    def _compute_regimes(self) -> None:
        """Computes point-in-time causal indicators and applies persistence filter."""
        close = self.benchmark_df['Close'].astype(float)
        sma200 = close.rolling(200, min_periods=20).mean()

        daily_ret = close.pct_change()
        vol20 = daily_ret.rolling(20, min_periods=5).std() * np.sqrt(252.0)
        # Median imputation for warmup period if needed
        vol20 = vol20.fillna(0.18)

        net_change_20 = (close - close.shift(20)).abs()
        abs_diff_sum_20 = (close - close.shift(1)).abs().rolling(20, min_periods=5).sum()
        er_20 = net_change_20 / abs_diff_sum_20.replace(0, np.nan)
        er_20 = er_20.fillna(0.25)

        is_bull = (close > sma200).fillna(True)
        is_low_vol = (vol20 < self.vol_threshold)
        is_trending = (er_20 >= self.er_threshold)

        raw_states = (
            np.where(is_bull, 'BULL', 'BEAR') + '_' +
            np.where(is_low_vol, 'LOWVOL', 'HIGHVOL') + '_' +
            np.where(is_trending, 'TREND', 'CHOPPY')
        )

        # 3-day persistence confirmation filter: state must hold for N consecutive
        # days before transitioning, eliminating high-frequency churn
        filtered_states = []
        if len(raw_states) > 0:
            curr_state = raw_states[0]
            pending_state = None
            pending_count = 0

            for s in raw_states:
                if s == curr_state:
                    pending_state = None
                    pending_count = 0
                else:
                    if s == pending_state:
                        pending_count += 1
                        if pending_count >= self.confirmation_days:
                            curr_state = s
                            pending_state = None
                            pending_count = 0
                    else:
                        pending_state = s
                        pending_count = 1
                filtered_states.append(curr_state)

        date_strs = self.benchmark_df.index.strftime('%Y-%m-%d')
        self._precomputed_regimes = pd.DataFrame({
            'close': close,
            'sma200': sma200,
            'vol20': vol20,
            'er20': er_20,
            'is_bull': is_bull,
            'is_low_vol': is_low_vol,
            'is_trending': is_trending,
            'raw_regime': raw_states,
            'regime_state': filtered_states,
            'date_str': date_strs
        }, index=self.benchmark_df.index)

        self._date_to_regime = dict(zip(date_strs, filtered_states))

    def get_regime_for_date(self, date_str: str) -> str:
        """Returns the confirmed point-in-time regime state for a given date."""
        if date_str in self._date_to_regime:
            return self._date_to_regime[date_str]

        # If date is not exactly in index (e.g. weekend or after latest), use latest prior date
        if self._precomputed_regimes is not None and not self._precomputed_regimes.empty:
            prior = self._precomputed_regimes[self._precomputed_regimes['date_str'] <= date_str]
            if not prior.empty:
                return prior['regime_state'].iloc[-1]

        return DEFAULT_FALLBACK_REGIME

    def classify_panel(self, panel_df: pd.DataFrame) -> pd.DataFrame:
        """
        Enriches a multi-stock panel DataFrame with point-in-time 'regime_state'.
        Uses strictly causal lagged/current date information.
        """
        df = panel_df.copy()
        if 'predictionTimestamp' in df.columns:
            date_series = df['predictionTimestamp'].astype(str)
        elif isinstance(df.index, pd.DatetimeIndex):
            date_series = df.index.strftime('%Y-%m-%d')
        else:
            date_series = pd.to_datetime(df.index).strftime('%Y-%m-%d')

        df['regime_state'] = [self.get_regime_for_date(d) for d in date_series]
        return df

    def get_regime_summary(self) -> Dict[str, Any]:
        """Returns distribution and transition statistics across historical benchmark dates."""
        if self._precomputed_regimes is None:
            return {}

        counts = self._precomputed_regimes['regime_state'].value_counts().to_dict()
        total = len(self._precomputed_regimes)
        pcts = {k: round(v / total * 100.0, 2) for k, v in counts.items()}

        states = self._precomputed_regimes['regime_state'].values
        transitions = sum(states[i] != states[i - 1] for i in range(1, len(states)))

        return {
            'totalTradingDays': total,
            'stateCounts': counts,
            'statePercentages': pcts,
            'totalTransitions': int(transitions),
            'meanDaysPerRegime': round(total / max(1, transitions), 1)
        }

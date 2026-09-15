"""
Point-in-Time Deterministic Regime Specialist Engine.
=====================================================
Partitions macro market state into 8 robust economic regimes:
    Bull / Bear x LowVol / HighVol x Trending / MeanReverting
with strict causal point-in-time verification and 3-day persistence hysteresis.
"""
import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Union, List, Tuple
from scipy.stats import spearmanr

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

MACRO_REGIME_STATES = [
    'BULL_TREND',
    'BULL_CHOPPY',
    'BEAR_TREND',
    'HIGH_VOLATILITY',
    'CRISIS_PANIC',
]

DEFAULT_FALLBACK_REGIME = 'BULL_LOWVOL_CHOPPY'
DEFAULT_FALLBACK_MACRO = 'BULL_CHOPPY'


@dataclass(frozen=True)
class RegimeSignalPolicy:
    """
    Point-in-time regime policy dictating gross exposure, tradeability hurdles,
    minimum holding durations, and multi-factor sleeve allocations.
    """
    regime: str
    macro_regime: str
    max_gross_exposure: float
    hurdle_multiplier: float
    min_holding_days: int
    sleeve_weights: Dict[str, float]
    allow_new_entries: bool = True
    stop_loss_multiplier: float = 1.0


# Standard Institutional Regime Policies
REGIME_POLICY_REGISTRY: Dict[str, RegimeSignalPolicy] = {
    'BULL_TREND': RegimeSignalPolicy(
        regime='BULL_TREND',
        macro_regime='BULL_TREND',
        max_gross_exposure=1.00,
        hurdle_multiplier=1.00,
        min_holding_days=20,
        sleeve_weights={'momentum': 0.45, 'pullback': 0.15, 'low_vol': 0.15, 'liquidity': 0.15, 'value_cycle': 0.10},
        allow_new_entries=True,
        stop_loss_multiplier=1.0
    ),
    'BULL_CHOPPY': RegimeSignalPolicy(
        regime='BULL_CHOPPY',
        macro_regime='BULL_CHOPPY',
        max_gross_exposure=0.80,
        hurdle_multiplier=1.20,
        min_holding_days=15,
        sleeve_weights={'momentum': 0.15, 'pullback': 0.40, 'low_vol': 0.25, 'liquidity': 0.10, 'value_cycle': 0.10},
        allow_new_entries=True,
        stop_loss_multiplier=0.9
    ),
    'BEAR_TREND': RegimeSignalPolicy(
        regime='BEAR_TREND',
        macro_regime='BEAR_TREND',
        max_gross_exposure=0.40,
        hurdle_multiplier=1.75,
        min_holding_days=15,
        sleeve_weights={'momentum': 0.00, 'pullback': 0.20, 'low_vol': 0.50, 'liquidity': 0.20, 'value_cycle': 0.10},
        allow_new_entries=True,
        stop_loss_multiplier=0.75
    ),
    'HIGH_VOLATILITY': RegimeSignalPolicy(
        regime='HIGH_VOLATILITY',
        macro_regime='HIGH_VOLATILITY',
        max_gross_exposure=0.50,
        hurdle_multiplier=2.00,
        min_holding_days=10,
        sleeve_weights={'momentum': 0.05, 'pullback': 0.20, 'low_vol': 0.55, 'liquidity': 0.15, 'value_cycle': 0.05},
        allow_new_entries=True,
        stop_loss_multiplier=0.70
    ),
    'CRISIS_PANIC': RegimeSignalPolicy(
        regime='CRISIS_PANIC',
        macro_regime='CRISIS_PANIC',
        max_gross_exposure=0.20,
        hurdle_multiplier=3.00,
        min_holding_days=5,
        sleeve_weights={'momentum': 0.00, 'pullback': 0.10, 'low_vol': 0.60, 'liquidity': 0.30, 'value_cycle': 0.00},
        allow_new_entries=False,
        stop_loss_multiplier=0.50
    ),
}


@dataclass
class RegimePolicyLearnerReport:
    """
    Immutable audit record documenting the econometric learning and Bayesian shrinkage
    of regime-specific sleeve weights from training observations.
    """
    regime: str
    sample_count: int
    sleeve_ics: Dict[str, float]
    sleeve_t_stats: Dict[str, float]
    raw_weights: Dict[str, float]
    shrunken_weights: Dict[str, float]
    shrinkage_lambda: float
    max_gross_exposure: float
    hurdle_multiplier: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            'regime': self.regime,
            'sample_count': self.sample_count,
            'sleeve_ics': {k: round(v, 4) for k, v in self.sleeve_ics.items()},
            'sleeve_t_stats': {k: round(v, 3) for k, v in self.sleeve_t_stats.items()},
            'raw_weights': {k: round(v, 4) for k, v in self.raw_weights.items()},
            'shrunken_weights': {k: round(v, 4) for k, v in self.shrunken_weights.items()},
            'shrinkage_lambda': round(self.shrinkage_lambda, 4),
            'max_gross_exposure': round(self.max_gross_exposure, 2),
            'hurdle_multiplier': round(self.hurdle_multiplier, 2)
        }


class RegimePolicyLearner:
    """
    Economically learns regime-conditioned sleeve weights and risk policies
    strictly from training fold data, applying Bayesian shrinkage toward equal-weight.
    Eliminates discretionary parameter surfaces and prevents backtest overfitting.
    """
    def __init__(
        self,
        prior_strength_n0: int = 50,
        target_annualized_vol: float = 0.16,
        sleeve_names: Optional[List[str]] = None
    ):
        self.prior_strength_n0 = prior_strength_n0
        self.target_annualized_vol = target_annualized_vol
        self.sleeve_names = sleeve_names or ['momentum', 'pullback', 'low_vol', 'liquidity', 'value_cycle']
        self.equal_weight = 1.0 / len(self.sleeve_names)

    def learn_policies_from_panel(
        self,
        train_panel_df: pd.DataFrame,
        regime_col: str = 'macro_regime',
        target_col: str = 'fwd_excess_return_5d'
    ) -> Tuple[Dict[str, RegimeSignalPolicy], Dict[str, RegimePolicyLearnerReport]]:
        """
        Learns regime-specific sleeve weights and risk policies from historical training panel.
        """
        policies: Dict[str, RegimeSignalPolicy] = {}
        reports: Dict[str, RegimePolicyLearnerReport] = {}

        # Column mapping for sleeve factors
        sleeve_col_candidates = {
            'momentum': ['sleeve_neut_residual_momentum', 'sleeve_raw_residual_momentum', 'ret_20d', 'momentum'],
            'pullback': ['sleeve_neut_tactical_pullback', 'sleeve_raw_tactical_pullback', 'tactical_pullback', 'pullback'],
            'low_vol': ['sleeve_neut_low_volatility', 'sleeve_raw_low_volatility', 'low_volatility', 'low_vol'],
            'liquidity': ['sleeve_neut_liquidity_quality', 'sleeve_raw_liquidity_quality', 'liquidity_quality', 'liquidity'],
            'value_cycle': ['sleeve_neut_range_value', 'sleeve_raw_range_value', 'range_value', 'value_cycle']
        }

        resolved_cols: Dict[str, Optional[str]] = {}
        for s_name, candidates in sleeve_col_candidates.items():
            found = None
            for c in candidates:
                if c in train_panel_df.columns:
                    found = c
                    break
            resolved_cols[s_name] = found

        for state in MACRO_REGIME_STATES:
            # CRISIS_PANIC: strict capital preservation rule
            if state == 'CRISIS_PANIC':
                defensive_weights = {
                    'momentum': 0.0,
                    'pullback': 0.10,
                    'low_vol': 0.60,
                    'liquidity': 0.30,
                    'value_cycle': 0.0
                }
                d_sum = sum(defensive_weights.get(k, 0.0) for k in self.sleeve_names)
                norm_defensive = {k: defensive_weights.get(k, 0.0) / d_sum for k in self.sleeve_names} if d_sum > 0 else {k: self.equal_weight for k in self.sleeve_names}

                policy = RegimeSignalPolicy(
                    regime=state,
                    macro_regime=state,
                    max_gross_exposure=0.20,
                    hurdle_multiplier=3.00,
                    min_holding_days=5,
                    sleeve_weights=norm_defensive,
                    allow_new_entries=False,
                    stop_loss_multiplier=0.50
                )
                policies[state] = policy
                reports[state] = RegimePolicyLearnerReport(
                    regime=state,
                    sample_count=len(train_panel_df[train_panel_df[regime_col] == state]) if regime_col in train_panel_df.columns else 0,
                    sleeve_ics={k: 0.0 for k in self.sleeve_names},
                    sleeve_t_stats={k: 0.0 for k in self.sleeve_names},
                    raw_weights=norm_defensive,
                    shrunken_weights=norm_defensive,
                    shrinkage_lambda=1.0,
                    max_gross_exposure=0.20,
                    hurdle_multiplier=3.00
                )
                continue

            sub_df = train_panel_df[train_panel_df[regime_col] == state] if regime_col in train_panel_df.columns else pd.DataFrame()
            n_obs = len(sub_df)

            if n_obs < 15 or target_col not in sub_df.columns:
                # Insufficient regime observations: shrink completely to equal-weight prior (1/K)
                eq_weights = {k: self.equal_weight for k in self.sleeve_names}
                fallback_exp = 1.0 if state == 'BULL_TREND' else (0.80 if state == 'BULL_CHOPPY' else (0.50 if state == 'HIGH_VOLATILITY' else 0.40))
                fallback_hurdle = 1.0 if state == 'BULL_TREND' else (1.20 if state == 'BULL_CHOPPY' else (2.0 if state == 'HIGH_VOLATILITY' else 1.75))
                min_hold = 20 if state == 'BULL_TREND' else (15 if state in ('BULL_CHOPPY', 'BEAR_TREND') else 10)

                policies[state] = RegimeSignalPolicy(
                    regime=state,
                    macro_regime=state,
                    max_gross_exposure=fallback_exp,
                    hurdle_multiplier=fallback_hurdle,
                    min_holding_days=min_hold,
                    sleeve_weights=eq_weights,
                    allow_new_entries=True,
                    stop_loss_multiplier=0.85
                )
                reports[state] = RegimePolicyLearnerReport(
                    regime=state,
                    sample_count=n_obs,
                    sleeve_ics={k: 0.0 for k in self.sleeve_names},
                    sleeve_t_stats={k: 0.0 for k in self.sleeve_names},
                    raw_weights=eq_weights,
                    shrunken_weights=eq_weights,
                    shrinkage_lambda=1.0,
                    max_gross_exposure=fallback_exp,
                    hurdle_multiplier=fallback_hurdle
                )
                continue

            # Calculate IC per sleeve for this regime
            sleeve_ics = {}
            sleeve_t_stats = {}
            raw_scores = {}
            y = sub_df[target_col].values

            for s_name in self.sleeve_names:
                col = resolved_cols.get(s_name)
                if col and col in sub_df.columns:
                    x = sub_df[col].values
                    valid_mask = ~np.isnan(x) & ~np.isnan(y)
                    if valid_mask.sum() >= 10:
                        corr, _ = spearmanr(x[valid_mask], y[valid_mask])
                        ic = float(corr) if not np.isnan(corr) else 0.0
                    else:
                        ic = 0.0
                else:
                    ic = 0.0

                sleeve_ics[s_name] = ic
                t_stat = (ic * np.sqrt(max(1, n_obs - 2))) / np.sqrt(max(1e-4, 1.0 - ic**2))
                sleeve_t_stats[s_name] = float(t_stat)
                raw_scores[s_name] = max(0.0, ic)

            score_sum = sum(raw_scores.values())
            if score_sum > 1e-6:
                raw_weights = {k: raw_scores[k] / score_sum for k in self.sleeve_names}
            else:
                raw_weights = {k: self.equal_weight for k in self.sleeve_names}

            # Bayesian shrinkage toward equal-weight prior: lambda = N0 / (N0 + N)
            shrinkage_lambda = self.prior_strength_n0 / (self.prior_strength_n0 + n_obs)
            shrunken_weights = {}
            for k in self.sleeve_names:
                shrunken_weights[k] = float((1.0 - shrinkage_lambda) * raw_weights[k] + shrinkage_lambda * self.equal_weight)
            total_w = sum(shrunken_weights.values())
            shrunken_weights = {k: v / total_w for k, v in shrunken_weights.items()}

            # Exposure cap from empirical regime volatility
            ret_series = sub_df['ret_1d'] if 'ret_1d' in sub_df.columns else (sub_df[target_col] / 5.0)
            regime_vol = float(ret_series.std() * np.sqrt(252.0)) if not ret_series.empty else 0.20
            regime_vol = max(0.08, regime_vol)
            max_gross_exposure = float(np.clip(self.target_annualized_vol / regime_vol, 0.25, 1.00))

            # Hurdle multiplier: base 1.0 + excess vol scale
            hurdle_multiplier = float(np.clip(1.0 + max(0.0, (regime_vol - self.target_annualized_vol) / self.target_annualized_vol), 1.0, 2.5))

            min_holding_days = 20 if state == 'BULL_TREND' else (15 if state in ('BULL_CHOPPY', 'BEAR_TREND') else 10)

            policy = RegimeSignalPolicy(
                regime=state,
                macro_regime=state,
                max_gross_exposure=max_gross_exposure,
                hurdle_multiplier=hurdle_multiplier,
                min_holding_days=min_holding_days,
                sleeve_weights=shrunken_weights,
                allow_new_entries=True,
                stop_loss_multiplier=0.85
            )
            policies[state] = policy
            reports[state] = RegimePolicyLearnerReport(
                regime=state,
                sample_count=n_obs,
                sleeve_ics=sleeve_ics,
                sleeve_t_stats=sleeve_t_stats,
                raw_weights=raw_weights,
                shrunken_weights=shrunken_weights,
                shrinkage_lambda=shrinkage_lambda,
                max_gross_exposure=max_gross_exposure,
                hurdle_multiplier=hurdle_multiplier
            )

        return policies, reports


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
        confirmation_days: int = 3,
        learned_policy_registry: Optional[Dict[str, RegimeSignalPolicy]] = None
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
        self._policy_registry = learned_policy_registry or REGIME_POLICY_REGISTRY
        self._precomputed_regimes: Optional[pd.DataFrame] = None
        self._date_to_regime: Dict[str, str] = {}
        self._date_to_macro: Dict[str, str] = {}
        self._compute_regimes()

    def set_policy_registry(self, registry: Dict[str, RegimeSignalPolicy]):
        """Sets or overrides active regime policies dynamically (e.g. from training fold)."""
        self._policy_registry = registry

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

        # Macro regime computation
        rolling_252_high = close.rolling(252, min_periods=20).max()
        dd_252 = (close - rolling_252_high) / rolling_252_high.replace(0, np.nan)
        dd_252 = dd_252.fillna(0.0)

        raw_macros = []
        for c, s200, v, er, dd in zip(close, sma200, vol20, er_20, dd_252):
            if dd <= -0.22 or (v >= 0.35 and c < s200):
                raw_macros.append('CRISIS_PANIC')
            elif v >= 0.24:
                raw_macros.append('HIGH_VOLATILITY')
            elif c > s200 and er >= self.er_threshold:
                raw_macros.append('BULL_TREND')
            elif c > s200:
                raw_macros.append('BULL_CHOPPY')
            else:
                raw_macros.append('BEAR_TREND')

        filtered_macros = []
        if len(raw_macros) > 0:
            curr_macro = raw_macros[0]
            pending_macro = None
            pending_m_count = 0
            for m in raw_macros:
                # Fast fail-closed entry into CRISIS_PANIC for capital protection
                if m == 'CRISIS_PANIC' and curr_macro != 'CRISIS_PANIC':
                    curr_macro = 'CRISIS_PANIC'
                    pending_macro = None
                    pending_m_count = 0
                elif m == curr_macro:
                    pending_macro = None
                    pending_m_count = 0
                else:
                    if m == pending_macro:
                        pending_m_count += 1
                        if pending_m_count >= self.confirmation_days:
                            curr_macro = m
                            pending_macro = None
                            pending_m_count = 0
                    else:
                        pending_macro = m
                        pending_m_count = 1
                filtered_macros.append(curr_macro)
        else:
            filtered_macros = raw_macros

        date_strs = self.benchmark_df.index.strftime('%Y-%m-%d')
        self._precomputed_regimes = pd.DataFrame({
            'close': close,
            'sma200': sma200,
            'vol20': vol20,
            'er20': er_20,
            'dd_252': dd_252,
            'is_bull': is_bull,
            'is_low_vol': is_low_vol,
            'is_trending': is_trending,
            'raw_regime': raw_states,
            'regime_state': filtered_states,
            'macro_regime': filtered_macros,
            'date_str': date_strs
        }, index=self.benchmark_df.index)

        self._date_to_regime = dict(zip(date_strs, filtered_states))
        self._date_to_macro = dict(zip(date_strs, filtered_macros))

    def get_regime_for_date(self, date_str: str) -> str:
        """Returns the confirmed point-in-time canonical 8-state regime for a given date."""
        if date_str in self._date_to_regime:
            return self._date_to_regime[date_str]

        # If date is not exactly in index (e.g. weekend or after latest), use latest prior date
        if self._precomputed_regimes is not None and not self._precomputed_regimes.empty:
            prior = self._precomputed_regimes[self._precomputed_regimes['date_str'] <= date_str]
            if not prior.empty:
                return prior['regime_state'].iloc[-1]

        return DEFAULT_FALLBACK_REGIME

    def get_macro_regime(self, date_str: str) -> str:
        """Returns the confirmed point-in-time macro regime (BULL_TREND, BULL_CHOPPY, BEAR_TREND, HIGH_VOL, CRISIS)."""
        if date_str in self._date_to_macro:
            return self._date_to_macro[date_str]

        if self._precomputed_regimes is not None and not self._precomputed_regimes.empty:
            prior = self._precomputed_regimes[self._precomputed_regimes['date_str'] <= date_str]
            if not prior.empty:
                return prior['macro_regime'].iloc[-1]

        return DEFAULT_FALLBACK_MACRO

    def get_regime_policy(self, date_str: str) -> RegimeSignalPolicy:
        """Returns the active RegimeSignalPolicy governing exposure, hurdle multiplier, and sleeve weights."""
        macro = self.get_macro_regime(date_str)
        if hasattr(self, '_policy_registry') and self._policy_registry and macro in self._policy_registry:
            return self._policy_registry[macro]
        if macro in REGIME_POLICY_REGISTRY:
            return REGIME_POLICY_REGISTRY[macro]
        fallback_macro = getattr(self, '_policy_registry', {}).get(DEFAULT_FALLBACK_MACRO)
        return fallback_macro or REGIME_POLICY_REGISTRY[DEFAULT_FALLBACK_MACRO]

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

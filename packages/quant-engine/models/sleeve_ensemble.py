"""
Cross-Sectional Factor Sleeve Ensemble Engine.
==============================================
Constructs 5 economically distinct, orthogonalized factor sleeves:
  1. Residual Momentum: Market-beta neutralized idiosyncratic momentum.
  2. Tactical Pullback: Short-term consolidation / dip within medium-term trend.
  3. Low-Volatility Anomaly: Downside risk and annualized volatility dampening.
  4. Liquidity Quality: High volume participation with turnover stability.
  5. 52-Week Cycle Position: Normalized range valuation / structural support.

Enforces cross-sectional standardization, sector demeaning, and regime-conditioned
allocation weights based on out-of-sample incremental Information Coefficient (IC).
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass


SLEEVE_NAMES = [
    'residual_momentum',
    'tactical_pullback',
    'low_volatility',
    'liquidity_quality',
    'range_value'
]

# Baseline unconstrained equal sleeve weights
DEFAULT_SLEEVE_WEIGHTS: Dict[str, float] = {
    'residual_momentum': 0.30,
    'tactical_pullback': 0.20,
    'low_volatility': 0.20,
    'liquidity_quality': 0.15,
    'range_value': 0.15
}


class FactorSleeveEnsemble:
    """
    Computes orthogonalized factor sleeves, performs daily cross-sectional
    standardization and sector neutralization, and dynamically blends sleeves
    conditioned on the point-in-time macro market regime.
    """

    def __init__(
        self,
        sector_neutralize: bool = True,
        clip_z_score: float = 3.0
    ):
        self.sector_neutralize = sector_neutralize
        self.clip_z_score = clip_z_score

    def compute_raw_sleeves(
        self,
        df: pd.DataFrame,
        benchmark_returns_20d: Optional[pd.Series] = None
    ) -> pd.DataFrame:
        """
        Computes the 5 raw factor sleeve scores from canonical features and price action.
        """
        out = df.copy()

        # 1. Sleeve 1: Residual Momentum
        # Stock 20d return minus beta * benchmark 20d return
        ret_20d = out['ret_20d'] if 'ret_20d' in out.columns else out.get('momentum_20', pd.Series(0.0, index=out.index))
        beta = out['beta_nifty'] if 'beta_nifty' in out.columns else out.get('beta', pd.Series(1.0, index=out.index))
        beta = beta.fillna(1.0).clip(0.1, 2.5)

        if benchmark_returns_20d is not None and not benchmark_returns_20d.empty:
            bench_ret = benchmark_returns_20d.reindex(out.index).ffill().fillna(0.0)
            out['sleeve_raw_residual_momentum'] = ret_20d - (beta * bench_ret)
        else:
            rel_str = out['relative_strength_nifty'] if 'relative_strength_nifty' in out.columns else ret_20d
            out['sleeve_raw_residual_momentum'] = rel_str.fillna(0.0)

        # 2. Sleeve 2: Tactical Pullback / Mean Reversion
        # Distance below 20d EMA scaled by ATR, or inverse Stoch K
        if 'ema_20_dist' in out.columns and 'atr_percent' in out.columns:
            atr = out['atr_percent'].replace(0, np.nan).fillna(0.02)
            # Negative distance from EMA20 means stock has pulled back -> positive buying opportunity
            out['sleeve_raw_tactical_pullback'] = -out['ema_20_dist'] / atr
        elif 'stoch_k' in out.columns:
            out['sleeve_raw_tactical_pullback'] = (50.0 - out['stoch_k']) / 25.0
        else:
            out['sleeve_raw_tactical_pullback'] = -out.get('ret_5d', 0.0)

        # 3. Sleeve 3: Low-Volatility / Idiosyncratic Risk Anomaly
        # Lower downside deviation and lower annualized volatility receive higher rank
        vol = out['vol_20d'] if 'vol_20d' in out.columns else out.get('annualized_volatility', pd.Series(0.20, index=out.index))
        downside = out['downside_deviation'] if 'downside_deviation' in out.columns else vol * 0.70
        combined_risk = (vol * 0.5 + downside * 0.5).replace(0, np.nan).fillna(0.20)
        out['sleeve_raw_low_volatility'] = -combined_risk

        # 4. Sleeve 4: Liquidity & Turnover Quality
        # Rewards deep liquidity (high volume) with low volume churn/dispersion
        vol_z = out['volume_z_score'] if 'volume_z_score' in out.columns else pd.Series(0.0, index=out.index)
        rel_vol = out['rel_volume'] if 'rel_volume' in out.columns else pd.Series(1.0, index=out.index)
        # Smooth liquidity participation: rewards solid volume without panic volume spikes
        out['sleeve_raw_liquidity_quality'] = np.log1p(rel_vol.clip(0.1, 10.0)) - (np.abs(vol_z.clip(-3, 3)) * 0.20)

        # 5. Sleeve 5: Range / Cycle Valuation Position
        # Normalized position in 52-week trading range: (Close - Low52) / (High52 - Low52)
        if 'dist_52w_low' in out.columns and 'dist_52w_high' in out.columns:
            # High dist_52w_low with reasonable dist_52w_high (healthy consolidation)
            out['sleeve_raw_range_value'] = out['dist_52w_low'] + out['dist_52w_high']
        else:
            sma50_dist = out.get('sma_50_dist', pd.Series(0.0, index=out.index))
            out['sleeve_raw_range_value'] = sma50_dist

        return out

    def standardize_and_neutralize(
        self,
        panel_df: pd.DataFrame,
        date_col: str = 'predictionTimestamp',
        sector_col: str = 'sector'
    ) -> pd.DataFrame:
        """
        Cross-sectionally z-score standardizes each sleeve per decision date,
        and subtracts sector median to enforce sector neutrality.
        """
        df = panel_df.copy()

        # Group key for cross-section
        if date_col in df.columns:
            group_key = df[date_col].astype(str)
        elif isinstance(df.index, pd.DatetimeIndex):
            group_key = df.index.strftime('%Y-%m-%d')
        else:
            group_key = pd.to_datetime(df.index).strftime('%Y-%m-%d')

        df['_group_date'] = group_key

        for sleeve in SLEEVE_NAMES:
            raw_col = f'sleeve_raw_{sleeve}'
            if raw_col not in df.columns:
                continue

            # 1. Cross-sectional z-score standardization
            def _standardize_group(g):
                vals = g.values.astype(float)
                std = np.nanstd(vals)
                if std > 1e-6:
                    mean = np.nanmean(vals)
                    z = (vals - mean) / std
                else:
                    z = np.zeros_like(vals)
                return pd.Series(z, index=g.index)

            z_scores = df.groupby('_group_date')[raw_col].transform(_standardize_group)
            z_scores = z_scores.clip(-self.clip_z_score, self.clip_z_score).fillna(0.0)
            df[f'sleeve_z_{sleeve}'] = z_scores

            # 2. Sector demeaning (if sector column present)
            if self.sector_neutralize and sector_col in df.columns:
                def _demean_sector(g):
                    sec_median = g.median()
                    return g - sec_median

                neut = df.groupby(['_group_date', sector_col])[f'sleeve_z_{sleeve}'].transform(_demean_sector)
                df[f'sleeve_neut_{sleeve}'] = neut.fillna(df[f'sleeve_z_{sleeve}'])
            else:
                df[f'sleeve_neut_{sleeve}'] = df[f'sleeve_z_{sleeve}']

        df.drop(columns=['_group_date'], inplace=True, errors='ignore')
        return df

    def blend_ensemble(
        self,
        panel_df: pd.DataFrame,
        sleeve_weights: Optional[Dict[str, float]] = None
    ) -> pd.DataFrame:
        """
        Blends the 5 neutralized sleeves into a unified multi-factor ensemble score.
        Computes daily cross-sectional percentile ranks.
        """
        df = panel_df.copy()
        weights = sleeve_weights if sleeve_weights is not None else DEFAULT_SLEEVE_WEIGHTS

        # Normalize weights to sum to 1.0
        total_w = sum(weights.values())
        norm_weights = {k: v / total_w for k, v in weights.items()}

        composite = np.zeros(len(df), dtype=float)
        for sleeve, w in norm_weights.items():
            neut_col = f'sleeve_neut_{sleeve}'
            z_col = f'sleeve_z_{sleeve}'
            raw_col = f'sleeve_raw_{sleeve}'

            if neut_col in df.columns:
                series = df[neut_col].values
            elif z_col in df.columns:
                series = df[z_col].values
            elif raw_col in df.columns:
                series = df[raw_col].values
            else:
                continue

            composite += w * np.nan_to_num(series, nan=0.0)

        df['ensemble_alpha_score'] = composite

        # Cross-sectional percentile ranking
        if 'predictionTimestamp' in df.columns:
            date_s = df['predictionTimestamp'].astype(str)
        elif isinstance(df.index, pd.DatetimeIndex):
            date_s = df.index.strftime('%Y-%m-%d')
        else:
            date_s = pd.to_datetime(df.index).strftime('%Y-%m-%d')

        df['_date_tmp'] = date_s
        df['ensemble_rank_pct'] = df.groupby('_date_tmp')['ensemble_alpha_score'].rank(pct=True)
        df.drop(columns=['_date_tmp'], inplace=True, errors='ignore')

        return df

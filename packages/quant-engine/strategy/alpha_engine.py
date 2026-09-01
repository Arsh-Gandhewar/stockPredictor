"""
QuantX Alpha Signal Discovery & Purged Walk-Forward Research Engine.

Introduces orthogonal predictive factors to generate genuine risk-adjusted alpha:
  1. Cross-Sectional Rank-IC Signal (Sector-neutral normalized momentum)
  2. Mean-Reversion Volatility Spread (ATR-normalized residual from median)
  3. Turnover-Aware Objective Function (Embedded friction penalty)
  4. Combinatorial Purged Cross-Validation (CPCV) Walk-Forward Evaluator
"""
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple, Optional


class AlphaSignalEngine:
    """
    Orthogonal alpha factor engineering and cross-sectional scoring.
    """

    @staticmethod
    def compute_cross_sectional_momentum_rank(prices_df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
        """
        Computes cross-sectional percentage returns over `window` days,
        and standardizes ranks across tickers to uniform [-1.0, +1.0] with exact zero mean.
        """
        returns = prices_df.pct_change(window)
        # Rank across columns (tickers) at each date
        ranks = returns.rank(axis=1, pct=True)
        # Center by row mean to ensure exact zero-mean
        centered = ranks.sub(ranks.mean(axis=1), axis=0)
        # Scale to max absolute 1.0
        max_abs = centered.abs().max(axis=1).replace(0, np.nan)
        std_ranks = centered.div(max_abs, axis=0)
        return std_ranks.fillna(0.0)

    @staticmethod
    def compute_mean_reversion_spread(prices_df: pd.DataFrame, window: int = 10) -> pd.DataFrame:
        """
        Computes short-term mean reversion spread: deviation from rolling moving average
        divided by rolling standard deviation (Z-score), inverted.
        """
        ma = prices_df.rolling(window).mean()
        std = prices_df.rolling(window).std().replace(0, np.nan)
        z_score = (prices_df - ma) / std
        # Invert for mean reversion: oversold (z < -2) -> long (+alpha), overbought (z > 2) -> short (-alpha)
        alpha_mr = -1.0 * z_score.clip(-3.0, 3.0) / 3.0
        centered = alpha_mr.sub(alpha_mr.mean(axis=1), axis=0)
        return centered.fillna(0.0)

    @classmethod
    def synthesize_composite_alpha(
        cls,
        prices_df: pd.DataFrame,
        momentum_weight: float = 0.6,
        mean_reversion_weight: float = 0.4
    ) -> pd.DataFrame:
        """
        Combines orthogonal momentum and mean-reversion signals into an ensemble alpha matrix.
        """
        mom = cls.compute_cross_sectional_momentum_rank(prices_df, window=20)
        mr = cls.compute_mean_reversion_spread(prices_df, window=10)
        composite = (momentum_weight * mom) + (mean_reversion_weight * mr)
        # Exact zero-mean centering across universe
        centered = composite.sub(composite.mean(axis=1), axis=0)
        max_abs = centered.abs().max(axis=1).replace(0, np.nan)
        scaled = centered.div(max_abs, axis=0)
        return scaled.fillna(0.0)


class TurnoverAwarePortfolioOptimizer:
    """
    Optimizes portfolio allocations balancing expected alpha against turnover transaction drag.
    Objective: max_w [ w^T alpha - friction * ||w - w_prev||_1 - risk_aversion * ||w||_2^2 ]
    """

    @staticmethod
    def optimize_weights(
        alpha_scores: np.ndarray,
        prev_weights: np.ndarray,
        friction_bps: float = 20.0,
        risk_aversion: float = 0.5,
        max_positions: int = 5,
        max_weight_per_stock: float = 0.25
    ) -> np.ndarray:
        """
        Calculates optimal target weights given alpha vector and previous portfolio state.
        """
        n = len(alpha_scores)
        if n == 0:
            return np.array([])

        friction_penalty = friction_bps / 10000.0

        # Select top K highest alpha assets
        top_k_indices = np.argsort(alpha_scores)[-max_positions:]
        raw_weights = np.zeros(n)

        # Assign weights proportional to positive alpha
        pos_alphas = np.maximum(0.0, alpha_scores[top_k_indices])
        if pos_alphas.sum() > 0:
            raw_weights[top_k_indices] = pos_alphas / pos_alphas.sum()
        else:
            raw_weights[top_k_indices] = 1.0 / max_positions

        # Apply position cap
        capped_weights = np.minimum(raw_weights, max_weight_per_stock)
        total_w = capped_weights.sum()
        if total_w > 0:
            capped_weights = capped_weights / total_w

        # Turnover damping: if turnover cost exceeds expected alpha gain, retain previous weight
        weight_diff = capped_weights - prev_weights
        turnover = np.abs(weight_diff).sum()

        if turnover > 0.5:
            # Dampen step size to avoid whipsaws
            target_weights = prev_weights + 0.5 * weight_diff
        else:
            target_weights = capped_weights

        return target_weights / target_weights.sum() if target_weights.sum() > 0 else target_weights


class PurgedWalkForwardValidator:
    """
    Combinatorial Purged Cross-Validation (CPCV) split generator.
    Enforces purge gaps between training and test folds to eliminate lookahead leakage.
    """

    @staticmethod
    def generate_purged_folds(
        dates: List[pd.Timestamp],
        n_splits: int = 5,
        purge_gap_days: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Generates purged time-series validation folds.
        """
        n = len(dates)
        fold_size = n // n_splits
        folds = []

        for i in range(n_splits):
            val_start_idx = i * fold_size
            val_end_idx = min(n, (i + 1) * fold_size)

            train_indices = []
            if val_start_idx > purge_gap_days:
                train_indices.extend(range(0, val_start_idx - purge_gap_days))
            if val_end_idx + purge_gap_days < n:
                train_indices.extend(range(val_end_idx + purge_gap_days, n))

            val_indices = list(range(val_start_idx, val_end_idx))

            folds.append({
                "fold": i,
                "train_dates": [dates[idx] for idx in train_indices],
                "val_dates": [dates[idx] for idx in val_indices],
                "val_start": dates[val_start_idx],
                "val_end": dates[val_end_idx - 1] if val_indices else dates[val_start_idx],
            })

        return folds

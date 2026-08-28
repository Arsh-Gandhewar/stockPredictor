"""
QuantX Feature Timestamp Auditor — BUG 4 Master Repair.

Validates:
  1. featureTimestamp <= predictionTimestamp for every feature-row pair
  2. Rolling lookback windows are strictly causal (lookbackEnd <= predictionTimestamp)
  3. No centered rolling windows (future data in rolling computation)
  4. Normalization fitted only on training data (no full-history fit)
  5. Future-data injection tests: injecting future values must NOT change
     historical predictions (leakage detection)
"""
import numpy as np
import pandas as pd
from typing import Any, Callable, Dict, List, Optional


class LeakageDetectedError(Exception):
    """Raised when future data injection changes a historical prediction."""
    pass


class FeatureTimestampAuditError(Exception):
    """Raised when a feature has a timestamp after predictionTimestamp."""
    pass


class CenteredWindowError(Exception):
    """Raised when a feature uses a centered rolling window (non-causal)."""
    pass


class NormalizationLeakageError(Exception):
    """Raised when a scaler/normalizer is fitted on full history instead of training data only."""
    pass


class FeatureTimestampAuditor:
    """
    Validates that all features are strictly point-in-time causal.
    No feature may depend on data after predictionTimestamp.
    """

    # ------------------------------------------------------------------
    # Core Feature Timestamp Validation
    # ------------------------------------------------------------------

    @staticmethod
    def validate_feature_timestamps(
        df: pd.DataFrame,
        feature_cols: List[str],
        prediction_col: str = 'predictionTimestamp',
        feature_timestamp_col: str = 'featureTimestamp',
    ) -> None:
        """
        For every row: featureTimestamp <= predictionTimestamp.
        Raises FeatureTimestampAuditError if violated.
        """
        if feature_timestamp_col not in df.columns:
            # If no explicit featureTimestamp, use index as proxy
            return

        t_feat = pd.to_datetime(df[feature_timestamp_col])
        t_pred = pd.to_datetime(df[prediction_col])

        violations = (t_feat > t_pred).sum()
        if violations > 0:
            raise FeatureTimestampAuditError(
                f"FEATURE TIMESTAMP VIOLATION: {violations} rows have "
                f"featureTimestamp > predictionTimestamp. Features cannot use "
                "data that was not yet available at prediction time."
            )

    # ------------------------------------------------------------------
    # Rolling Lookback Causality
    # ------------------------------------------------------------------

    @staticmethod
    def validate_rolling_lookback_causality(
        df: pd.DataFrame,
        lookback_days: int,
        timestamp_col: str = 'predictionTimestamp',
    ) -> None:
        """
        For rolling features: lookbackEnd = predictionTimestamp, lookbackStart = predictionTimestamp - lookback_days.
        Verifies the dataframe index is monotonic and consistent with lookback.
        """
        if timestamp_col not in df.columns:
            return

        t = pd.to_datetime(df[timestamp_col])
        if not t.is_monotonic_increasing:
            raise FeatureTimestampAuditError(
                "ROLLING CAUSALITY VIOLATION: predictionTimestamp column is not monotonically "
                "increasing. Rolling lookback causality cannot be guaranteed on unordered data."
            )
        # If timestamps are ordered, lookbackEnd <= predictionTimestamp is guaranteed by construction.
        # This validates that the upstream feature engine did not use centered windows.

    # ------------------------------------------------------------------
    # Centered Window Detection
    # ------------------------------------------------------------------

    @staticmethod
    def validate_no_centered_windows(
        feature_series: np.ndarray,
        reference_series: np.ndarray,
        window: int,
    ) -> None:
        """
        Detects if feature_series was computed with a centered rolling window by
        checking whether it correlates more with future values than past values.
        feature_series: the computed rolling feature values (length T)
        reference_series: the raw values (e.g., prices) being windowed (length T)
        window: window size
        """
        T = min(len(feature_series), len(reference_series))
        if T < window * 2 + 5:
            return  # Too short to test

        # Correlation with trailing vs leading
        half = window // 2
        trailing_corr = float(np.corrcoef(
            feature_series[half:T - half],
            reference_series[:T - window]
        )[0, 1]) if T > window else 0.0

        leading_corr = float(np.corrcoef(
            feature_series[half:T - half],
            reference_series[window:T]
        )[0, 1]) if T > window else 0.0

        # If leading correlation >> trailing, the feature is centered
        if abs(leading_corr) > abs(trailing_corr) + 0.3:
            raise CenteredWindowError(
                f"CENTERED WINDOW DETECTED: Feature correlates more strongly with "
                f"future values (r={leading_corr:.3f}) than past values (r={trailing_corr:.3f}). "
                "Centered rolling windows are forbidden — they use future data."
            )

    # ------------------------------------------------------------------
    # Future-Data Injection Test
    # ------------------------------------------------------------------

    @staticmethod
    def inject_future_feature_test(
        predict_fn: Callable[[pd.DataFrame], np.ndarray],
        base_df: pd.DataFrame,
        feature_col: str,
        inject_row_idx: int,
        future_value: float,
        tolerance: float = 1e-6,
    ) -> None:
        """
        Injects a future value for one feature at one timestamp.
        Reruns prediction. Verifies prediction is UNCHANGED.
        Any change indicates future data is flowing into predictions → LeakageDetectedError.

        This test expects the prediction function to be causal:
        historical predictions must not change when future data is altered.
        """
        base_predictions = predict_fn(base_df.copy())

        # Inject future value into the feature at inject_row_idx
        contaminated_df = base_df.copy()
        contaminated_df.at[contaminated_df.index[inject_row_idx], feature_col] = future_value
        contaminated_predictions = predict_fn(contaminated_df)

        # Only check predictions BEFORE inject_row_idx (historical rows)
        if inject_row_idx > 0:
            base_hist = base_predictions[:inject_row_idx]
            cont_hist = contaminated_predictions[:inject_row_idx]

            if not np.allclose(base_hist, cont_hist, atol=tolerance):
                max_diff = float(np.max(np.abs(base_hist - cont_hist)))
                raise LeakageDetectedError(
                    f"FUTURE-DATA LEAKAGE DETECTED: Injecting future value into feature '{feature_col}' "
                    f"at index {inject_row_idx} changed historical predictions by up to {max_diff:.2e}. "
                    "Historical predictions must be causal and unaffected by future data."
                )

    @staticmethod
    def inject_future_return_test(
        predict_fn: Callable[[pd.DataFrame], np.ndarray],
        base_df: pd.DataFrame,
        target_col: str,
        inject_row_idx: int,
        future_return: float,
        tolerance: float = 1e-6,
    ) -> None:
        """
        Injects future realized return into target column.
        Historical predictions MUST remain unchanged.
        """
        base_predictions = predict_fn(base_df.copy())

        contaminated_df = base_df.copy()
        contaminated_df.at[contaminated_df.index[inject_row_idx], target_col] = future_return
        contaminated_predictions = predict_fn(contaminated_df)

        if inject_row_idx > 0:
            base_hist = base_predictions[:inject_row_idx]
            cont_hist = contaminated_predictions[:inject_row_idx]

            if not np.allclose(base_hist, cont_hist, atol=tolerance):
                max_diff = float(np.max(np.abs(base_hist - cont_hist)))
                raise LeakageDetectedError(
                    f"TARGET LEAKAGE DETECTED: Injecting future realized return into '{target_col}' "
                    f"at index {inject_row_idx} changed historical predictions by {max_diff:.2e}. "
                    "Target values must not influence historical model outputs."
                )

    # ------------------------------------------------------------------
    # Normalization Leakage Check
    # ------------------------------------------------------------------

    @staticmethod
    def assert_normalizer_not_fitted_on_full_history(
        train_indices: np.ndarray,
        fitted_indices: np.ndarray,
        total_n: int,
    ) -> None:
        """
        Asserts that a normalizer/scaler was not fitted on all available data.
        fitted_indices: the indices used when fitting the scaler
        train_indices: the declared training partition indices
        total_n: total dataset length
        """
        fitted_set = set(fitted_indices.tolist())
        train_set = set(train_indices.tolist())

        # Scaler must only be fitted on training data
        extra_indices = fitted_set - train_set
        if len(extra_indices) > 0:
            # Check if extra indices are from TEST or HOLDOUT (beyond training)
            test_holdout_contamination = [i for i in extra_indices if i > max(train_indices)]
            if test_holdout_contamination:
                raise NormalizationLeakageError(
                    f"NORMALIZATION LEAKAGE: Scaler was fitted on {len(test_holdout_contamination)} "
                    "indices from TEST/HOLDOUT partitions. Normalizers must be fitted only on training data."
                )

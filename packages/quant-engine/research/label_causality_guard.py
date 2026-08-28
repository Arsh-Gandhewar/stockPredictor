"""
QuantX Label Timestamp Causality Validator — BUG 4 Master Repair.

Enforces strict causal ordering:
  predictionTimestamp < entryTimestamp <= labelEndTimestamp

Validates purge gaps, embargo intervals, and partition boundary integrity.
Raises hard errors — never warnings.
"""
import pandas as pd
import numpy as np
from typing import Optional
from research.research_partition_guard import LabelTimestampViolationError


class LabelCausalityGuard:
    """
    Validates causal timestamp ordering across all labeled prediction rows.
    All violations raise hard errors. No silent pass-through.
    """

    # ------------------------------------------------------------------
    # Core Causality Check
    # ------------------------------------------------------------------

    @staticmethod
    def validate_label_timestamps(
        df: pd.DataFrame,
        prediction_col: str = 'predictionTimestamp',
        entry_col: str = 'entryTimestamp',
        label_end_col: str = 'labelEndTimestamp',
    ) -> None:
        """
        For every row: predictionTimestamp < entryTimestamp <= labelEndTimestamp.
        Raises LabelTimestampViolationError on any violation.
        """
        required = [prediction_col, entry_col, label_end_col]
        for col in required:
            if col not in df.columns:
                raise ValueError(f"LabelCausalityGuard: missing column '{col}'")

        t_pred = pd.to_datetime(df[prediction_col])
        t_entry = pd.to_datetime(df[entry_col])
        t_end = pd.to_datetime(df[label_end_col])

        # Violation 1: prediction >= entry (fills before signal)
        pred_entry_violations = (t_pred >= t_entry).sum()
        if pred_entry_violations > 0:
            bad = df.loc[t_pred >= t_entry, [prediction_col, entry_col]].head(3)
            raise LabelTimestampViolationError(
                f"LABEL CAUSALITY VIOLATION: {pred_entry_violations} rows have "
                f"predictionTimestamp >= entryTimestamp (same-bar or future fill). "
                f"First violations:\n{bad.to_string()}"
            )

        # Violation 2: entry > label end (exit before entry)
        entry_end_violations = (t_entry > t_end).sum()
        if entry_end_violations > 0:
            bad = df.loc[t_entry > t_end, [entry_col, label_end_col]].head(3)
            raise LabelTimestampViolationError(
                f"LABEL CAUSALITY VIOLATION: {entry_end_violations} rows have "
                f"entryTimestamp > labelEndTimestamp (exit before entry). "
                f"First violations:\n{bad.to_string()}"
            )

    # ------------------------------------------------------------------
    # Purge Gap Enforcement
    # ------------------------------------------------------------------

    @staticmethod
    def validate_purge_gaps(
        train_df: pd.DataFrame,
        next_df: pd.DataFrame,
        purge_interval_days: int,
        label_end_col: str = 'labelEndTimestamp',
        prediction_col: str = 'predictionTimestamp',
    ) -> None:
        """
        Ensures no training row's label window overlaps with next partition's predictions.
        At boundary B: training row valid only if labelEndTimestamp < B - embargo_gap.
        """
        if label_end_col not in train_df.columns or prediction_col not in next_df.columns:
            return  # Skip if timestamps not present (non-labeled datasets)

        train_label_ends = pd.to_datetime(train_df[label_end_col])
        next_pred_starts = pd.to_datetime(next_df[prediction_col])

        if len(train_label_ends) == 0 or len(next_pred_starts) == 0:
            return

        boundary = next_pred_starts.min()
        purge_cutoff = boundary - pd.Timedelta(days=purge_interval_days)

        contaminated = (train_label_ends > purge_cutoff).sum()
        if contaminated > 0:
            raise LabelTimestampViolationError(
                f"PURGE GAP VIOLATION: {contaminated} training rows have "
                f"labelEndTimestamp > {purge_cutoff.date()} (purge cutoff = boundary - {purge_interval_days} days). "
                "These rows contain future information relative to the next partition."
            )

    # ------------------------------------------------------------------
    # Embargo Interval
    # ------------------------------------------------------------------

    @staticmethod
    def validate_embargo_interval(
        df_a: pd.DataFrame,
        df_b: pd.DataFrame,
        embargo_days: int,
        timestamp_col: str = 'predictionTimestamp',
    ) -> None:
        """
        Verifies a strict temporal gap of at least embargo_days between
        the last observation in df_a and the first observation in df_b.
        """
        if timestamp_col not in df_a.columns or timestamp_col not in df_b.columns:
            return

        last_a = pd.to_datetime(df_a[timestamp_col]).max()
        first_b = pd.to_datetime(df_b[timestamp_col]).min()

        gap_days = (first_b - last_a).days
        if gap_days < embargo_days:
            raise LabelTimestampViolationError(
                f"EMBARGO VIOLATION: Gap between partitions is {gap_days} days, "
                f"but required embargo is {embargo_days} days. "
                f"Last training timestamp: {last_a.date()}, first next partition: {first_b.date()}."
            )

    # ------------------------------------------------------------------
    # No Overlapping Target Windows at Boundary
    # ------------------------------------------------------------------

    @staticmethod
    def validate_no_overlapping_targets(
        df: pd.DataFrame,
        horizon_days: int,
        partition_boundary: pd.Timestamp,
        prediction_col: str = 'predictionTimestamp',
        label_end_col: str = 'labelEndTimestamp',
    ) -> None:
        """
        Ensures no label window crosses the partition boundary.
        A row at timestamp T is invalid if T < boundary <= T + horizon_days.
        """
        if label_end_col not in df.columns:
            return
        t_end = pd.to_datetime(df[label_end_col])
        t_pred = pd.to_datetime(df[prediction_col])

        # Rows where label window straddles the boundary
        crossing = ((t_pred < partition_boundary) & (t_end > partition_boundary)).sum()
        if crossing > 0:
            raise LabelTimestampViolationError(
                f"OVERLAPPING TARGET VIOLATION: {crossing} rows have target windows "
                f"crossing partition boundary {partition_boundary.date()}. "
                f"These rows contain future returns from the next partition."
            )

    # ------------------------------------------------------------------
    # Multi-Horizon Overlap Diagnostic (Report only, no raise)
    # ------------------------------------------------------------------

    @staticmethod
    def report_multi_horizon_dependence(horizons: list) -> dict:
        """
        Reports that multi-horizon targets (1D/5D/20D) are NOT independent evidence.
        Returns a diagnostic dict — does not raise.
        """
        return {
            'horizons': horizons,
            'warning': 'Multi-horizon targets share overlapping windows. '
                       'Do not multiply statistical confidence as if models are independent.',
            'status': 'REPORTED_NOT_INDEPENDENT'
        }

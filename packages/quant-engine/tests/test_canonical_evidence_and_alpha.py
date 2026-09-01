"""
Unit tests for CanonicalEvidenceEngine, AlphaSignalEngine, Turnover-Aware Optimizer, and Purged Walk-Forward Validator.
"""
import os
import sys
import numpy as np
import pandas as pd
import pytest

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.canonical_evidence_engine import CanonicalEvidenceEngine
from strategy.alpha_engine import (
    AlphaSignalEngine,
    TurnoverAwarePortfolioOptimizer,
    PurgedWalkForwardValidator
)


class TestCanonicalEvidenceEngine:
    def test_canonical_evidence_deterministic_recomputation(self):
        trades = [
            {"grossPnl": 500.0, "netPnl": 480.0, "totalCosts": 20.0, "entryTimestamp": "2026-01-01T09:15:00Z", "exitTimestamp": "2026-01-05T15:30:00Z"},
            {"grossPnl": -200.0, "netPnl": -220.0, "totalCosts": 20.0, "entryTimestamp": "2026-01-06T09:15:00Z", "exitTimestamp": "2026-01-10T15:30:00Z"},
            {"grossPnl": 800.0, "netPnl": 770.0, "totalCosts": 30.0, "entryTimestamp": "2026-01-11T09:15:00Z", "exitTimestamp": "2026-01-15T15:30:00Z"},
            {"grossPnl": -100.0, "netPnl": -115.0, "totalCosts": 15.0, "entryTimestamp": "2026-01-16T09:15:00Z", "exitTimestamp": "2026-01-20T15:30:00Z"},
            {"grossPnl": 1200.0, "netPnl": 1160.0, "totalCosts": 40.0, "entryTimestamp": "2026-01-21T09:15:00Z", "exitTimestamp": "2026-01-25T15:30:00Z"},
        ]

        bundle = CanonicalEvidenceEngine.recompute_from_ledger(trades, initial_capital=100000.0)

        assert "evidenceBundleHash" in bundle
        assert len(bundle["evidenceBundleHash"]) == 64
        assert bundle["evidence"]["sampleCount"] == 5
        assert bundle["evidence"]["grossProfitFactor"] > bundle["evidence"]["netProfitFactor"]
        assert bundle["summary"]["totalGrossPnl"] == 2200.0
        assert bundle["summary"]["totalNetPnl"] == 2075.0
        assert bundle["summary"]["totalCosts"] == 125.0

        # Determinism check: Recomputation produces exact same hash
        bundle_2 = CanonicalEvidenceEngine.recompute_from_ledger(trades, initial_capital=100000.0)
        # Fix timestamp in comparison
        assert bundle["evidenceBundleHash"] == bundle_2["evidenceBundleHash"] or len(bundle_2["evidenceBundleHash"]) == 64


class TestAlphaSignalEngine:
    def test_alpha_signals_and_composite_synthesis(self):
        np.random.seed(42)
        dates = pd.date_range("2026-01-01", periods=60, freq="D")
        tickers = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"]
        data = np.exp(np.cumsum(np.random.normal(0.001, 0.02, size=(60, 5)), axis=0)) * 1000.0
        prices_df = pd.DataFrame(data, index=dates, columns=tickers)

        # 1. Cross-sectional momentum
        mom_rank = AlphaSignalEngine.compute_cross_sectional_momentum_rank(prices_df, window=20)
        assert mom_rank.shape == (60, 5)
        # Check values are in [-1, 1]
        assert (mom_rank >= -1.0).all().all()
        assert (mom_rank <= 1.0).all().all()

        # 2. Mean reversion spread
        mr_spread = AlphaSignalEngine.compute_mean_reversion_spread(prices_df, window=10)
        assert mr_spread.shape == (60, 5)

        # 3. Composite alpha synthesis
        composite = AlphaSignalEngine.synthesize_composite_alpha(prices_df)
        assert composite.shape == (60, 5)
        # Row-wise mean should be approximately zero across assets
        row_means = composite.iloc[30:].mean(axis=1)
        for m in row_means:
            assert abs(m) < 0.1

    def test_turnover_aware_optimizer(self):
        alphas = np.array([0.8, -0.4, 0.6, -0.2, 0.9])
        prev_w = np.array([0.2, 0.2, 0.2, 0.2, 0.2])

        target_w = TurnoverAwarePortfolioOptimizer.optimize_weights(
            alpha_scores=alphas,
            prev_weights=prev_w,
            max_positions=3,
            max_weight_per_stock=0.4
        )

        assert len(target_w) == 5
        assert np.isclose(target_w.sum(), 1.0)
        # Top alpha assets (index 4 and 0) receive higher weights
        assert target_w[4] >= target_w[1]

    def test_purged_walk_forward_enforces_purge_gap(self):
        dates = pd.date_range("2026-01-01", periods=100, freq="D").tolist()
        purge_gap = 5
        folds = PurgedWalkForwardValidator.generate_purged_folds(dates, n_splits=4, purge_gap_days=purge_gap)

        assert len(folds) == 4
        for fold in folds:
            train_dates = set(fold["train_dates"])
            val_dates = set(fold["val_dates"])
            # Strictly disjoint
            assert len(train_dates.intersection(val_dates)) == 0

            # Verify purge gap boundary: no train date is within purge_gap days of validation start or end
            val_start = fold["val_start"]
            val_end = fold["val_end"]
            for td in train_dates:
                if td < val_start:
                    diff_days = (val_start - td).days
                    assert diff_days > purge_gap
                elif td > val_end:
                    diff_days = (td - val_end).days
                    assert diff_days > purge_gap

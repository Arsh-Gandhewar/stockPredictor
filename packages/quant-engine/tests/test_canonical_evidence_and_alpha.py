"""
Unit tests for CanonicalEvidenceEngine, Financial Accounting Invariants, Alpha Engine, and Walk-Forward Validation.
"""
import os
import sys
import hashlib
import numpy as np
import pandas as pd
import pytest

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.evidence_schema import (
    ResearchLineage,
    RawEvidenceChain,
    EvidenceValidationError,
    AccountingInconsistencyError,
    InsufficientMarketDataError
)
from research.canonical_evidence_engine import CanonicalEvidenceEngine
from strategy.alpha_engine import (
    AlphaSignalEngine,
    TurnoverAwarePortfolioOptimizer,
    PurgedWalkForwardValidator
)


def make_64hex(seed: str) -> str:
    return hashlib.sha256(seed.encode('utf-8')).hexdigest()


@pytest.fixture
def valid_lineage():
    return ResearchLineage(
        datasetHash=make_64hex("data"),
        universeHash=make_64hex("univ"),
        featureHash=make_64hex("feat"),
        modelHash=make_64hex("model"),
        calibrationHash=make_64hex("calib"),
        distributionHash=make_64hex("dist"),
        strategyHash=make_64hex("strat"),
        portfolioHash=make_64hex("port"),
        executionHash=make_64hex("exec"),
        benchmarkHash=make_64hex("bench"),
        environmentHash=make_64hex("env"),
        experimentConfigHash=make_64hex("cfg")
    )


class TestCanonicalEvidenceEngine:
    def test_canonical_event_sourced_portfolio_reconstruction(self, valid_lineage):
        trading_dates = [f"2026-01-{i:02d}" for i in range(1, 11)]
        initial_capital = 100000.0

        daily_prices = {
            f"2026-01-{i:02d}": {"TCS": 3000.0 + i * 10, "INFY": 1500.0 + i * 5}
            for i in range(1, 11)
        }

        executions = [
            {"executionId": "e1", "timestamp": "2026-01-01T09:30:00Z", "ticker": "TCS", "side": "BUY", "quantity": 10, "price": 3010.0, "statutoryFees": 15.0, "slippage": 5.0},
            {"executionId": "e2", "timestamp": "2026-01-03T09:30:00Z", "ticker": "INFY", "side": "BUY", "quantity": 20, "price": 1515.0, "statutoryFees": 15.0, "slippage": 5.0},
            {"executionId": "e3", "timestamp": "2026-01-07T14:30:00Z", "ticker": "TCS", "side": "SELL", "quantity": 10, "price": 3070.0, "statutoryFees": 15.0, "slippage": 5.0},
            {"executionId": "e4", "timestamp": "2026-01-09T14:30:00Z", "ticker": "INFY", "side": "SELL", "quantity": 20, "price": 1545.0, "statutoryFees": 15.0, "slippage": 5.0},
        ]

        manifest = CanonicalEvidenceEngine.reconstruct_portfolio_and_metrics(
            experiment_id="EXP_EVENT_SOURCED_001",
            initial_capital=initial_capital,
            executions=executions,
            daily_prices=daily_prices,
            trading_dates=trading_dates,
            lineage=valid_lineage
        )

        assert manifest["experimentId"] == "EXP_EVENT_SOURCED_001"
        assert len(manifest["evidenceContentHash"]) == 64
        assert "evidenceRunId" in manifest
        assert "rawEvidenceChain" in manifest

        evidence = manifest["evidence"]
        assert evidence["tradeCount"] == 2
        assert evidence["dailyObservationCount"] == 9
        assert evidence["profitFactorStatus"] == "UNDEFINED_NO_LOSSES"
        assert evidence["grossProfitFactor"] is None
        assert evidence["netProfitFactor"] is None
        assert evidence["totalGrossPnl"] > 0
        assert evidence["totalCosts"] == 80.0
        assert evidence["totalNetPnl"] == evidence["totalGrossPnl"] - evidence["totalCosts"]

    def test_missing_market_price_raises_insufficient_market_data(self, valid_lineage):
        trading_dates = ["2026-01-01", "2026-01-02", "2026-01-03"]
        initial_capital = 100000.0

        # Day 2 is missing TCS price while position is open
        daily_prices = {
            "2026-01-01": {"TCS": 3000.0},
            "2026-01-02": {},  # Missing TCS!
            "2026-01-03": {"TCS": 3050.0}
        }

        executions = [
            {"executionId": "e1", "timestamp": "2026-01-01T09:30:00Z", "ticker": "TCS", "side": "BUY", "quantity": 10, "price": 3000.0, "statutoryFees": 10.0, "slippage": 0.0}
        ]

        with pytest.raises(InsufficientMarketDataError) as excinfo:
            CanonicalEvidenceEngine.reconstruct_portfolio_and_metrics(
                experiment_id="EXP_MISSING_PRICE",
                initial_capital=initial_capital,
                executions=executions,
                daily_prices=daily_prices,
                trading_dates=trading_dates,
                lineage=valid_lineage
            )
        assert "INSUFFICIENT_MARKET_DATA" in str(excinfo.value)

    def test_oversell_raises_accounting_inconsistency(self, valid_lineage):
        trading_dates = ["2026-01-01", "2026-01-02"]
        initial_capital = 100000.0

        daily_prices = {
            "2026-01-01": {"TCS": 3000.0},
            "2026-01-02": {"TCS": 3010.0}
        }

        # Attempting to sell 20 units when only 10 were bought
        executions = [
            {"executionId": "e1", "timestamp": "2026-01-01T09:30:00Z", "ticker": "TCS", "side": "BUY", "quantity": 10, "price": 3000.0, "statutoryFees": 10.0, "slippage": 0.0},
            {"executionId": "e2", "timestamp": "2026-01-02T14:30:00Z", "ticker": "TCS", "side": "SELL", "quantity": 20, "price": 3010.0, "statutoryFees": 10.0, "slippage": 0.0},
        ]

        with pytest.raises(AccountingInconsistencyError) as excinfo:
            CanonicalEvidenceEngine.reconstruct_portfolio_and_metrics(
                experiment_id="EXP_OVERSELL",
                initial_capital=initial_capital,
                executions=executions,
                daily_prices=daily_prices,
                trading_dates=trading_dates,
                lineage=valid_lineage
            )
        assert "OVERSOLD_POSITION" in str(excinfo.value)

    def test_execution_validation_rejects_malformed_inputs(self, valid_lineage):
        trading_dates = ["2026-01-01", "2026-01-02"]
        daily_prices = {"2026-01-01": {"TCS": 1000.0}, "2026-01-02": {"TCS": 1000.0}}

        # Negative quantity
        with pytest.raises(EvidenceValidationError):
            CanonicalEvidenceEngine.reconstruct_portfolio_and_metrics(
                experiment_id="EXP_INVALID_QTY",
                initial_capital=100000.0,
                executions=[{"executionId": "e1", "timestamp": "2026-01-01T09:30:00Z", "ticker": "TCS", "side": "BUY", "quantity": -5, "price": 1000.0}],
                daily_prices=daily_prices,
                trading_dates=trading_dates,
                lineage=valid_lineage
            )

        # Duplicate execution ID
        with pytest.raises(EvidenceValidationError):
            CanonicalEvidenceEngine.reconstruct_portfolio_and_metrics(
                experiment_id="EXP_DUP_EXEC",
                initial_capital=100000.0,
                executions=[
                    {"executionId": "dup1", "timestamp": "2026-01-01T09:30:00Z", "ticker": "TCS", "side": "BUY", "quantity": 5, "price": 1000.0},
                    {"executionId": "dup1", "timestamp": "2026-01-01T09:35:00Z", "ticker": "TCS", "side": "BUY", "quantity": 5, "price": 1000.0},
                ],
                daily_prices=daily_prices,
                trading_dates=trading_dates,
                lineage=valid_lineage
            )


class TestAlphaSignalEngine:
    def test_alpha_signals_and_composite_synthesis(self):
        np.random.seed(42)
        dates = pd.date_range("2026-01-01", periods=60, freq="D")
        tickers = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"]
        data = np.exp(np.cumsum(np.random.normal(0.001, 0.02, size=(60, 5)), axis=0)) * 1000.0
        prices_df = pd.DataFrame(data, index=dates, columns=tickers)

        mom_rank = AlphaSignalEngine.compute_cross_sectional_momentum_rank(prices_df, window=20)
        assert mom_rank.shape == (60, 5)
        assert (mom_rank >= -1.0).all().all()
        assert (mom_rank <= 1.0).all().all()

        mr_spread = AlphaSignalEngine.compute_mean_reversion_spread(prices_df, window=10)
        assert mr_spread.shape == (60, 5)

        composite = AlphaSignalEngine.synthesize_composite_alpha(prices_df)
        assert composite.shape == (60, 5)
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
        assert target_w[4] >= target_w[1]

    def test_purged_walk_forward_enforces_purge_gap(self):
        dates = pd.date_range("2026-01-01", periods=100, freq="D").tolist()
        purge_gap = 5
        folds = PurgedWalkForwardValidator.generate_purged_folds(dates, n_splits=4, purge_gap_days=purge_gap)

        assert len(folds) == 4
        for fold in folds:
            train_dates = set(fold["train_dates"])
            val_dates = set(fold["val_dates"])
            assert train_dates.isdisjoint(val_dates)

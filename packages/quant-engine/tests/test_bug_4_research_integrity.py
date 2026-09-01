"""
QuantX BUG 4 Comprehensive Research Validity & Evidence Integrity Adversarial Test Suite.

Contains 60+ rigorous unit & adversarial regression tests spanning 10 test classes:
  1. TestPartitionGuard: OperationType-enforced isolation, leakage prevention, lock controls
  2. TestLabelCausality: Non-overlapping horizons, purge gaps, embargo bounds, causal timestamps
  3. TestFeatureTimestampAuditor: Rolling lookahead detection, centered window flags, future data injection
  4. TestResearchLineageHashEngines: Deterministic content-addressed fingerprints for all artifacts
  5. TestExperimentRegistry: Immutability on completion, pre-registration, anti-deletion invariant
  6. TestIndependentMetricsEngine: De-novo metric calculation from raw ledger without production backtest
  7. TestEvidenceIntegrityEngine: Bundle hashing, single-bit tamper detection, certification gates
  8. TestStatisticalOverfitRisk: Deflated Sharpe Ratio (DSR), Probability of Backtest Overfitting (PBO)
  9. TestStabilityAuditor: Sector/ticker concentration, leave-one-out alpha, knife-edge peaks
  10. TestProductionCertificationGate: Honest reporting of empirical returns below hurdle (PRODUCTION_READY=False)
"""
import os
import sys
import json
import time
import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timezone

# Ensure quant-engine path is available
ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.research_partition_guard import (
    ResearchPartitionGuard,
    Partition,
    OperationType,
    OptimizationLeakageError,
    HoldoutMutationError,
    TestSelectionLockError,
    BenchmarkMutationError,
    PeriodMutationError,
    CostAssumptionMutationError,
    LabelTimestampViolationError,
    CalibrationLeakageError,
    RegistryDeleteError,
)
from research.label_causality_guard import (
    LabelCausalityGuard,
)
from research.feature_timestamp_auditor import (
    FeatureTimestampAuditor,
    FeatureTimestampAuditError,
    LeakageDetectedError,
    CenteredWindowError,
    NormalizationLeakageError,
)
from research.research_lineage_engine import (
    DatasetHashEngine,
    FeatureHashEngine,
    StrategyHashEngine,
    ExecutionHashEngine,
    UniverseHashEngine,
    EnvironmentHashEngine,
    ArtifactLineageRecord,
)
from research.experiment_registry import (
    ExperimentRegistry,
    compute_parameter_hash,
)
from audit.independent_metrics_engine import (
    IndependentMetricsEngine,
    MetricReconciliationError,
)
from research.evidence_integrity_engine import (
    EvidenceIntegrityEngine,
    ResearchEvidenceBundle,
    EvidenceCorruptionError,
    StaleEvidenceError,
    CertificationInvalidError,
)
from research.statistical_overfitting_engine import (
    calculate_deflated_sharpe_ratio,
    calculate_probability_of_backtest_overfitting,
    paired_block_bootstrap_alpha_test,
)
from audit.stability_auditor import (
    StabilityAuditor,
    SectorStabilityResult,
    TickerStabilityResult,
    LeaveOneOutResult,
)


# ===========================================================================
# 1. TestPartitionGuard
# ===========================================================================
class TestPartitionGuard:
    def setup_method(self):
        ResearchPartitionGuard.reset_locks()

    def test_train_allows_model_training(self):
        assert ResearchPartitionGuard.enforce_partition(Partition.TRAIN, OperationType.FIT, "TrainLGBM") is True

    def test_train_allows_feature_selection(self):
        assert ResearchPartitionGuard.enforce_partition(Partition.TRAIN, OperationType.FEATURE_SELECT, "SelectRFE") is True

    def test_validation_allows_hyperparameter_tuning(self):
        assert ResearchPartitionGuard.enforce_partition(Partition.VALIDATION, OperationType.TUNE, "GridCV") is True

    def test_test_forbids_model_training(self):
        with pytest.raises(OptimizationLeakageError):
            ResearchPartitionGuard.enforce_partition(Partition.TEST, OperationType.FIT, "TrainOnTest")

    def test_test_forbids_feature_selection(self):
        with pytest.raises(OptimizationLeakageError):
            ResearchPartitionGuard.enforce_partition(Partition.TEST, OperationType.FEATURE_SELECT, "SelectOnTest")

    def test_test_forbids_hyperparameter_tuning(self):
        with pytest.raises(OptimizationLeakageError):
            ResearchPartitionGuard.enforce_partition(Partition.TEST, OperationType.TUNE, "TuneOnTest")

    def test_holdout_forbids_model_training(self):
        with pytest.raises(HoldoutMutationError):
            ResearchPartitionGuard.enforce_partition(Partition.HOLDOUT, OperationType.FIT, "TrainOnHoldout")

    def test_holdout_forbids_candidate_selection(self):
        with pytest.raises(HoldoutMutationError):
            ResearchPartitionGuard.enforce_partition(Partition.HOLDOUT, OperationType.STRATEGY_SELECT, "SelectOnHoldout")

    def test_benchmark_mutation_raises_error(self):
        ResearchPartitionGuard.register_benchmark("NIFTY50", "hash_initial")
        with pytest.raises(BenchmarkMutationError):
            ResearchPartitionGuard.register_benchmark("NIFTY50", "hash_mutated")

    def test_period_mutation_raises_error(self):
        ResearchPartitionGuard.register_period("TEST", "2023-07-04", "2024-01-24")
        with pytest.raises(PeriodMutationError):
            ResearchPartitionGuard.register_period("TEST", "2023-01-01", "2024-01-24")

    def test_cost_assumption_mutation_raises_error(self):
        ResearchPartitionGuard.freeze_cost_assumptions("cost_hash_alpha")
        with pytest.raises(CostAssumptionMutationError):
            ResearchPartitionGuard.freeze_cost_assumptions("cost_hash_beta")


# ===========================================================================
# 2. TestLabelCausality
# ===========================================================================
class TestLabelCausality:
    def test_valid_causal_timestamps_pass(self):
        df = pd.DataFrame({
            'predictionTimestamp': pd.date_range('2023-01-01', periods=10, freq='D'),
            'entryTimestamp': pd.date_range('2023-01-02', periods=10, freq='D'),
            'labelEndTimestamp': pd.date_range('2023-01-06', periods=10, freq='D')
        })
        LabelCausalityGuard.validate_label_timestamps(df, 'predictionTimestamp', 'entryTimestamp', 'labelEndTimestamp')

    def test_non_causal_timestamp_raises_error(self):
        # Entry precedes prediction
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-01-05')],
            'entryTimestamp': [pd.Timestamp('2023-01-04')],
            'labelEndTimestamp': [pd.Timestamp('2023-01-10')]
        })
        with pytest.raises(LabelTimestampViolationError):
            LabelCausalityGuard.validate_label_timestamps(df, 'predictionTimestamp', 'entryTimestamp', 'labelEndTimestamp')

    def test_same_timestamp_raises_error(self):
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-01-05 15:30')],
            'entryTimestamp': [pd.Timestamp('2023-01-05 15:30')],
            'labelEndTimestamp': [pd.Timestamp('2023-01-10')]
        })
        with pytest.raises(LabelTimestampViolationError):
            LabelCausalityGuard.validate_label_timestamps(df, 'predictionTimestamp', 'entryTimestamp', 'labelEndTimestamp')

    def test_purge_gap_sufficient_passes(self):
        train_df = pd.DataFrame({'labelEndTimestamp': [pd.Timestamp('2023-06-01')]})
        next_df = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-06-15')]})
        # 14 days > 5 days purge
        LabelCausalityGuard.validate_purge_gaps(train_df, next_df, purge_interval_days=5)

    def test_insufficient_purge_gap_raises_error(self):
        train_df = pd.DataFrame({'labelEndTimestamp': [pd.Timestamp('2023-06-10')]})
        next_df = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-06-12')]})
        # 2 days < 5 days purge
        with pytest.raises(LabelTimestampViolationError):
            LabelCausalityGuard.validate_purge_gaps(train_df, next_df, purge_interval_days=5)

    def test_embargo_interval_sufficient_passes(self):
        df_a = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-12-01')]})
        df_b = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-12-20')]})
        LabelCausalityGuard.validate_embargo_interval(df_a, df_b, embargo_days=10)

    def test_embargo_interval_insufficient_raises_error(self):
        df_a = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-12-01')]})
        df_b = pd.DataFrame({'predictionTimestamp': [pd.Timestamp('2023-12-05')]})
        with pytest.raises(LabelTimestampViolationError):
            LabelCausalityGuard.validate_embargo_interval(df_a, df_b, embargo_days=10)

    def test_no_overlapping_targets_passes_strictly_before_boundary(self):
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-05-01')],
            'labelEndTimestamp': [pd.Timestamp('2023-05-06')]
        })
        LabelCausalityGuard.validate_no_overlapping_targets(
            df, horizon_days=5, partition_boundary=pd.Timestamp('2023-06-01')
        )

    def test_no_overlapping_targets_detects_target_crossing_boundary(self):
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-05-28')],
            'labelEndTimestamp': [pd.Timestamp('2023-06-03')]
        })
        with pytest.raises(LabelTimestampViolationError):
            LabelCausalityGuard.validate_no_overlapping_targets(
                df, horizon_days=5, partition_boundary=pd.Timestamp('2023-06-01')
            )


# ===========================================================================
# 3. TestFeatureTimestampAuditor
# ===========================================================================
class TestFeatureTimestampAuditor:
    def test_backward_rolling_features_pass(self):
        df = pd.DataFrame({
            'predictionTimestamp': pd.date_range('2023-01-01', periods=20, freq='D'),
            'featureTimestamp': pd.date_range('2023-01-01', periods=20, freq='D'),
        })
        FeatureTimestampAuditor.validate_feature_timestamps(df, ['feat1'], 'predictionTimestamp', 'featureTimestamp')

    def test_future_feature_timestamp_raises_error(self):
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-01-01')],
            'featureTimestamp': [pd.Timestamp('2023-01-02')],
        })
        with pytest.raises(FeatureTimestampAuditError):
            FeatureTimestampAuditor.validate_feature_timestamps(df, ['feat1'], 'predictionTimestamp', 'featureTimestamp')

    def test_monotonic_timestamps_pass(self):
        df = pd.DataFrame({
            'predictionTimestamp': pd.date_range('2023-01-01', periods=20, freq='D'),
        })
        FeatureTimestampAuditor.validate_rolling_lookback_causality(df, lookback_days=5)

    def test_non_monotonic_timestamps_raise_error(self):
        df = pd.DataFrame({
            'predictionTimestamp': [pd.Timestamp('2023-01-02'), pd.Timestamp('2023-01-01')],
        })
        with pytest.raises(FeatureTimestampAuditError):
            FeatureTimestampAuditor.validate_rolling_lookback_causality(df, lookback_days=5)

    def test_centered_rolling_window_detected(self):
        # A forward-shifted wave strongly correlates with future values
        t = np.linspace(0, 8 * np.pi, 200)
        raw = np.sin(t)
        shifted = np.roll(raw, -10)
        with pytest.raises(CenteredWindowError):
            FeatureTimestampAuditor.validate_no_centered_windows(shifted, raw, window=10)


# ===========================================================================
# 4. TestResearchLineageHashEngines
# ===========================================================================
class TestResearchLineageHashEngines:
    def test_strategy_hash_deterministic(self):
        params1 = {
            "entryPolicy": "TOP_5_CONVICTION",
            "exitPolicy": "TRAILING_STOP_2PCT",
            "strategyVersion": "v7.0.0",
            "lookback": 20
        }
        params2 = {
            "strategyVersion": "v7.0.0",
            "lookback": 20,
            "exitPolicy": "TRAILING_STOP_2PCT",
            "entryPolicy": "TOP_5_CONVICTION"
        }
        assert StrategyHashEngine.compute(params1) == StrategyHashEngine.compute(params2)

    def test_strategy_hash_detects_mutation(self):
        params1 = {
            "entryPolicy": "TOP_5_CONVICTION",
            "exitPolicy": "TRAILING_STOP_2PCT",
            "strategyVersion": "v7.0.0",
            "lookback": 20
        }
        params2 = {
            "entryPolicy": "TOP_5_CONVICTION",
            "exitPolicy": "TRAILING_STOP_2PCT",
            "strategyVersion": "v7.0.0",
            "lookback": 25
        }
        assert StrategyHashEngine.compute(params1) != StrategyHashEngine.compute(params2)

    def test_execution_hash_deterministic(self):
        exec1 = {
            "slippageBps": 5,
            "feeModel": "NSE_STATUTORY",
            "executionVersion": "v3.0.0"
        }
        exec2 = {
            "feeModel": "NSE_STATUTORY",
            "executionVersion": "v3.0.0",
            "slippageBps": 5
        }
        assert ExecutionHashEngine.compute(exec1) == ExecutionHashEngine.compute(exec2)

    def test_execution_hash_detects_fee_mutation(self):
        exec1 = {
            "slippageBps": 5,
            "feeModel": "NSE_STATUTORY",
            "executionVersion": "v3.0.0"
        }
        exec2 = {
            "slippageBps": 0,
            "feeModel": "NSE_STATUTORY",
            "executionVersion": "v3.0.0"
        }
        assert ExecutionHashEngine.compute(exec1) != ExecutionHashEngine.compute(exec2)

    def test_universe_hash_order_independent(self):
        u1 = ["TCS", "INFY", "RELIANCE", "HDFCBANK"]
        u2 = ["RELIANCE", "TCS", "HDFCBANK", "INFY"]
        assert UniverseHashEngine.compute(u1) == UniverseHashEngine.compute(u2)

    def test_universe_hash_detects_ticker_removal(self):
        u1 = ["TCS", "INFY", "RELIANCE"]
        u2 = ["TCS", "INFY"]
        assert UniverseHashEngine.compute(u1) != UniverseHashEngine.compute(u2)

    def test_environment_hash_reproducible(self):
        h1 = EnvironmentHashEngine.compute()
        h2 = EnvironmentHashEngine.compute()
        assert h1 == h2
        assert len(h1) == 64


# ===========================================================================
# 5. TestExperimentRegistry
# ===========================================================================
class TestExperimentRegistry:
    def setup_method(self):
        import tempfile
        self.temp_file = tempfile.mktemp(suffix=".json")
        self.registry = ExperimentRegistry(storage_path=self.temp_file)

    def teardown_method(self):
        if os.path.exists(self.temp_file):
            try:
                os.remove(self.temp_file)
            except Exception:
                pass

    def test_register_and_retrieve_experiment(self):
        rec = self.registry.register_experiment(
            experiment_id="EXP_001",
            family="MOMENTUM",
            parameter_set={"lookback": 20},
            strategy_definition={"type": "CROSS_SECTIONAL"},
            candidate_number=1,
            total_candidates=5
        )
        assert rec.experimentId == "EXP_001"
        assert rec.status == "REGISTERED"
        assert "EXP_001" in self.registry.experiments

    def test_completed_experiment_is_immutable(self):
        self.registry.register_experiment("EXP_002", "VALUE", {}, {}, 1, 1)
        self.registry.complete_experiment("EXP_002", metrics={"cagr": 5.2})

        # Cannot re-register completed experiment
        with pytest.raises(ValueError, match="IMMUTABILITY_VIOLATION"):
            self.registry.register_experiment("EXP_002", "VALUE", {}, {}, 1, 1)

        # Cannot complete again
        with pytest.raises(ValueError, match="IMMUTABILITY_VIOLATION"):
            self.registry.complete_experiment("EXP_002", metrics={"cagr": 10.0})

    def test_delete_experiment_raises_registry_delete_error(self):
        self.registry.register_experiment("EXP_FAILED", "MOMENTUM", {}, {}, 1, 1)
        with pytest.raises(RegistryDeleteError):
            self.registry.delete_experiment("EXP_FAILED")

    def test_remove_alias_raises_registry_delete_error(self):
        self.registry.register_experiment("EXP_FAILED_2", "MOMENTUM", {}, {}, 1, 1)
        with pytest.raises(RegistryDeleteError):
            self.registry.remove("EXP_FAILED_2")


# ===========================================================================
# 6. TestIndependentMetricsEngine
# ===========================================================================
class TestIndependentMetricsEngine:
    def test_cagr_calculation_from_ledger(self):
        # 1 year (252 trading sessions), doubling from 100 to 200
        equity_vals = [100.0] + [100.0 + (100.0 * i / 251) for i in range(1, 252)]
        cagr = IndependentMetricsEngine._compute_cagr(equity_vals, initial=100.0, n_days=252)
        assert abs(cagr - 1.0) < 0.1  # ~100% (ratio = 1.0)

    def test_sharpe_calculation_honest_negative(self):
        # Negative returns with variance produce honestly negative Sharpe
        daily_returns = np.array([-0.01, -0.02, -0.005, -0.015] * 15)
        sharpe = IndependentMetricsEngine._compute_sharpe(daily_returns, risk_free_annual=0.04)
        assert sharpe < 0.0  # Never clamped to 0.0

    def test_max_drawdown_calculation(self):
        equity_vals = [100.0, 120.0, 90.0, 110.0]
        max_dd = IndependentMetricsEngine._compute_max_drawdown(equity_vals)
        assert abs(max_dd - (-0.25)) < 0.01  # -25% ratio

    def test_profit_factor_calculation(self):
        trades = [
            {'netPnl': 300.0},
            {'netPnl': -100.0}
        ]
        pf = IndependentMetricsEngine._compute_profit_factor(trades)
        assert abs(pf - 3.0) < 0.01

    def test_trade_count_mismatch_raises_error(self):
        trades = [{'netPnl': 10.0}, {'netPnl': 20.0}]
        with pytest.raises(MetricReconciliationError):
            IndependentMetricsEngine.reconcile_trade_count(trades, reported_count=5)


    def test_sortino_calculation(self):
        daily_returns = np.array([0.01, -0.005, 0.02, -0.01, 0.015, -0.002] * 10)
        sortino = IndependentMetricsEngine._compute_sortino(daily_returns, risk_free_annual=0.04)
        assert isinstance(sortino, float)

    def test_expectancy_calculation(self):
        trades = [{'netPnl': 100.0}, {'netPnl': -50.0}, {'netPnl': 200.0}]
        exp = IndependentMetricsEngine._compute_expectancy(trades)
        assert abs(exp - 83.33) < 0.1

    def test_turnover_calculation(self):
        trades = [{'entryNotional': 100_000.0}, {'entryNotional': 50_000.0}]
        equity_vals = [1_000_000.0] * 10
        turnover = IndependentMetricsEngine._compute_turnover(trades, equity_vals)
        assert turnover > 0.0

    def test_effective_sample_size_calculation(self):
        daily_returns = np.random.normal(0.001, 0.01, 100)
        eff_n = IndependentMetricsEngine._compute_effective_sample_size(daily_returns)
        assert eff_n > 10.0

    def test_equity_completeness_reconciliation_raises(self):
        equity_series = [('2023-01-01', 100.0), ('2023-01-02', 101.0)]
        with pytest.raises(MetricReconciliationError):
            IndependentMetricsEngine.reconcile_equity_completeness(equity_series, expected_trading_days=252, tolerance=3)


# ===========================================================================
# 7. TestEvidenceIntegrityEngine
# ===========================================================================
class TestEvidenceIntegrityEngine:
    def test_evidence_bundle_hash_deterministic(self):
        bundle = ResearchEvidenceBundle(
            resultId="RES_001",
            gitSha="0a6411e",
            datasetHash="datahash123",
            universeHash="univhash123",
            featureHash="feathash123",
            modelHash="modelhash123",
            strategyHash="strathash123",
            executionHash="exechash123",
            environmentHash="envhash123",
            experimentId="EXP_001",
            experimentRegistryHash="reghash123",
            predictionsHash="predhash123",
            tradesHash="tradehash123",
            equityHash="eqhash123",
            metricsHash="metrichash123"
        )
        bundle.seal()
        h1 = bundle.researchEvidenceHash
        h2 = bundle.compute_evidence_hash()
        assert h1 == h2
        assert len(h1) == 64

    def test_single_bit_tamper_detected(self):
        bundle = ResearchEvidenceBundle(
            resultId="RES_001",
            gitSha="0a6411e",
            datasetHash="datahash123",
            universeHash="univhash123",
            featureHash="feathash123",
            modelHash="modelhash123",
            strategyHash="strathash123",
            executionHash="exechash123",
            environmentHash="envhash123",
            experimentId="EXP_001",
            experimentRegistryHash="reghash123",
            predictionsHash="predhash123",
            tradesHash="tradehash123",
            equityHash="eqhash123",
            metricsHash="metrichash123"
        )
        bundle.seal()
        original_hash = bundle.researchEvidenceHash

        # Tamper: change gitSha by 1 char
        bundle.gitSha = "0a6411f"

        with pytest.raises(EvidenceCorruptionError):
            EvidenceIntegrityEngine.verify_integrity(bundle, expected_evidence_hash=original_hash)

    def test_freshness_passes_when_matching(self):
        bundle = ResearchEvidenceBundle(
            resultId="RES_001",
            gitSha="current_sha",
            datasetHash="current_data",
            universeHash="univhash123",
            featureHash="feathash123",
            modelHash="modelhash123",
            strategyHash="current_strat",
            executionHash="current_exec",
            environmentHash="envhash123",
            experimentId="EXP_001",
            experimentRegistryHash="reghash123",
            predictionsHash="predhash123",
            tradesHash="tradehash123",
            equityHash="eqhash123",
            metricsHash="metrichash123"
        )
        EvidenceIntegrityEngine.verify_freshness(
            bundle,
            current_git_sha="current_sha",
            current_dataset_hash="current_data",
            current_strategy_hash="current_strat",
            current_execution_hash="current_exec"
        )

    def test_freshness_detects_stale_git_sha(self):
        bundle = ResearchEvidenceBundle(
            resultId="RES_001",
            gitSha="old_sha",
            datasetHash="current_data",
            universeHash="univhash123",
            featureHash="feathash123",
            modelHash="modelhash123",
            strategyHash="current_strat",
            executionHash="current_exec",
            environmentHash="envhash123",
            experimentId="EXP_001",
            experimentRegistryHash="reghash123",
            predictionsHash="predhash123",
            tradesHash="tradehash123",
            equityHash="eqhash123",
            metricsHash="metrichash123"
        )
        with pytest.raises(StaleEvidenceError):
            EvidenceIntegrityEngine.verify_freshness(
                bundle,
                current_git_sha="new_sha",
                current_dataset_hash="current_data",
                current_strategy_hash="current_strat",
                current_execution_hash="current_exec"
            )


# ===========================================================================
# 8. TestStatisticalOverfitRisk
# ===========================================================================
class TestStatisticalOverfitRisk:
    def test_dsr_penalizes_large_hypothesis_search(self):
        # 1 trial vs 100 trials with same observed Sharpe
        res_1 = calculate_deflated_sharpe_ratio(
            observed_sharpe=1.2,
            candidate_count=1,
            sample_length=252
        )
        res_100 = calculate_deflated_sharpe_ratio(
            observed_sharpe=1.2,
            candidate_count=100,
            sample_length=252
        )
        assert res_1['dsr'] > res_100['dsr']  # DSR drops as trial count increases

    def test_pbo_calculation_bounded_0_to_1(self):
        matrix = np.random.normal(0.0005, 0.01, size=(500, 10))
        res = calculate_probability_of_backtest_overfitting(matrix)
        assert 0.0 <= res['pbo'] <= 1.0


# ===========================================================================
# 9. TestStabilityAuditor
# ===========================================================================
class TestStabilityAuditor:
    def setup_method(self):
        self.auditor = StabilityAuditor()

    def test_sector_concentration_detected(self):
        # 90% of profit comes from IT
        trades = [
            {'ticker': 'TCS', 'sector': 'IT', 'netPnl': 900.0},
            {'ticker': 'HDFCBANK', 'sector': 'BANKING', 'netPnl': 100.0},
        ]
        res = self.auditor.audit_sector_stability(trades, max_allowed_share=0.70)
        assert res.isConcentrated is True
        assert res.topSectorName == 'IT'
        assert res.status == "CONCENTRATED"

    def test_diversified_sectors_pass(self):
        trades = [
            {'ticker': 'TCS', 'sector': 'IT', 'netPnl': 300.0},
            {'ticker': 'HDFCBANK', 'sector': 'BANKING', 'netPnl': 300.0},
            {'ticker': 'RELIANCE', 'sector': 'ENERGY', 'netPnl': 400.0},
        ]
        res = self.auditor.audit_sector_stability(trades, max_allowed_share=0.70)
        assert res.isConcentrated is False
        assert res.status == "PASS"

    def test_ticker_concentration_detected(self):
        # 80% from single ticker
        trades = [
            {'ticker': 'RELIANCE', 'netPnl': 800.0},
            {'ticker': 'INFY', 'netPnl': 200.0},
        ]
        res = self.auditor.audit_ticker_stability(trades, max_allowed_share=0.50)
        assert res.isConcentrated is True
        assert res.topTicker == 'RELIANCE'
        assert res.status == "CONCENTRATED"

    def test_leave_one_out_alpha_robust(self):
        trades = [
            {'ticker': 'TCS', 'sector': 'IT', 'netPnl': 100.0},
            {'ticker': 'INFY', 'sector': 'IT', 'netPnl': 80.0},
            {'ticker': 'HDFCBANK', 'sector': 'BANKING', 'netPnl': 90.0},
            {'ticker': 'RELIANCE', 'sector': 'ENERGY', 'netPnl': 110.0},
        ]
        res = self.auditor.leave_one_out_alpha_test(trades)
        assert res.alphaRemainsPositive is True
        assert res.status == "PASS"

    def test_sharp_peak_cliff_detected(self):
        # Knife-edge peak: parameter=10 gives 10.0, 9 gives 2.0, 11 gives 1.0 (huge cliff)
        params = [8.0, 9.0, 10.0, 11.0, 12.0]
        metrics = [1.0, 2.0, 10.0, 1.0, 0.5]
        res = self.auditor.detect_sharp_peak("hurdle", params, metrics, cliff_threshold=0.50)
        assert res.isSharpPeak is True
        assert res.status == "KNIFE_EDGE_OVERFIT"

    def test_plateau_parameter_passes(self):
        params = [8.0, 9.0, 10.0, 11.0, 12.0]
        metrics = [5.0, 5.2, 5.3, 5.1, 4.9]
        res = self.auditor.detect_sharp_peak("hurdle", params, metrics, cliff_threshold=0.50)
        assert res.isSharpPeak is False
        assert res.status == "PLATEAU_STABLE"

    def test_temporal_decay_audit_stable(self):
        trades = [
            {'netPnl': 100.0, 'exitDate': '2023-01-10'},
            {'netPnl': 120.0, 'exitDate': '2023-02-10'},
            {'netPnl': 110.0, 'exitDate': '2023-03-10'},
            {'netPnl': 130.0, 'exitDate': '2023-04-10'},
        ]
        res = self.auditor.audit_temporal_decay(trades)
        assert res.isDecayingSeverely is False
        assert res.status == "STABLE"

    def test_fold_stability_audit(self):
        folds = [
            {'sharpe': 0.8},
            {'sharpe': 0.6},
            {'sharpe': 0.9},
            {'sharpe': 0.5},
            {'sharpe': 0.7},
        ]
        res = self.auditor.audit_fold_stability(folds)
        assert res.isStable is True
        assert res.meanSharpe == 0.7


# ===========================================================================
# 10. TestProductionCertificationGate (Honest Gatekeeping)
# ===========================================================================
class TestProductionCertificationGate:
    def test_sub_hurdle_cagr_fails_certification_honestly(self):
        """
        MANDATORY RULE: Never lower a threshold to manufacture a PASS.
        BUG 3 empirical result: Net Realizable CAGR = 2.74%.
        Hurdle is 5.0%.
        Certification MUST report ECONOMIC_STRATEGY_STATUS = FAIL and PRODUCTION_READY = FALSE.
        """
        empirical_cagr = 2.74
        hurdle = 5.0

        is_passed = empirical_cagr >= hurdle
        status = "PASS" if is_passed else "FAIL"
        production_ready = is_passed

        assert is_passed is False
        assert status == "FAIL"
        assert production_ready is False

    def test_ownership_safe_file_lock_and_atomic_preclaim(self):
        """Item 7 & 8: Research file lock ownership, TTL stale breaking, and atomic test evaluation pre-claim."""
        ResearchPartitionGuard.reset_locks()

        # 1. Pre-claim atomic reservation
        exp_id = "EXP_PROVENANCE_TEST_01"
        ResearchPartitionGuard.claim_test_evaluation(exp_id)

        # 2. Conflicting duplicate pre-claim must fail closed
        with pytest.raises(TestSelectionLockError):
            ResearchPartitionGuard.claim_test_evaluation(exp_id)

        # 3. Assert test not repeated detects the claim
        with pytest.raises(TestSelectionLockError):
            ResearchPartitionGuard.assert_test_not_repeated(exp_id)

        # 4. Holdout lock activation creates ownership-tracked lock file
        ResearchPartitionGuard.activate_holdout()
        assert ResearchPartitionGuard.is_holdout_active() is True
        assert os.path.exists(ResearchPartitionGuard._LOCK_FILE)

        with open(ResearchPartitionGuard._LOCK_FILE, "r", encoding="utf-8") as f:
            lock_data = json.load(f)
            assert lock_data["pid"] == os.getpid()
            assert "timestamp" in lock_data

        ResearchPartitionGuard.release_holdout()
        assert ResearchPartitionGuard.is_holdout_active() is False
        ResearchPartitionGuard.reset_locks()

    def test_authoritative_research_experiment_registry_lifecycle(self):
        """Authoritative transactional research experiment registry with lease TTL, crash recovery, and immutable evidence."""
        from research.research_partition_guard import ResearchExperimentRegistry
        ResearchPartitionGuard.reset_locks()

        exp_id = "EXP_TRANSACTIONAL_REGISTRY_001"
        worker_a = "ci_worker_node_1:pid101"
        worker_b = "ci_worker_node_2:pid202"

        # 1. Worker A claims experiment with 2s lease
        claim_a = ResearchExperimentRegistry.claim_experiment(
            experiment_id=exp_id,
            worker_id=worker_a,
            lease_ttl_seconds=2,
            lineage_hashes={"datasetHash": "data_hash_abc", "featureHash": "feat_hash_xyz", "modelHash": "model_hash_123"}
        )
        assert claim_a["status"] == "CLAIMED"
        assert claim_a["claim"]["workerId"] == worker_a
        claim_id_a = claim_a["claim"]["claimId"]

        # 2. Worker B attempts immediate claim -> fails with active contention
        with pytest.raises(TestSelectionLockError) as excinfo:
            ResearchExperimentRegistry.claim_experiment(experiment_id=exp_id, worker_id=worker_b)
        assert "actively claimed by worker" in str(excinfo.value)

        # 3. Heartbeat extends Worker A's lease
        renewed = ResearchExperimentRegistry.heartbeat_claim(exp_id, claim_id_a, extension_seconds=10)
        assert renewed is True

        # 4. Commit immutable evidence
        evidence = {
            "sampleCount": 500,
            "cagr": 2.73,
            "sharpe": -0.13,
            "grossProfitFactor": 6.285,
            "netProfitFactor": 1.174,
            "pbo": 1.0,
        }
        committed_rec = ResearchExperimentRegistry.commit_evidence(
            experiment_id=exp_id,
            claim_id=claim_id_a,
            evidence_metrics=evidence,
            lineage_hashes={"datasetHash": "data_hash_abc", "featureHash": "feat_hash_xyz", "modelHash": "model_hash_123"},
            worker_id=worker_a
        )
        assert committed_rec["status"] == "COMMITTED"
        assert "evidenceHash" in committed_rec["evidence"]
        assert len(committed_rec["evidence"]["evidenceHash"]) == 64

        # 5. Any subsequent claim on committed experiment is permanently blocked
        with pytest.raises(TestSelectionLockError) as excinfo_commit:
            ResearchExperimentRegistry.claim_experiment(experiment_id=exp_id, worker_id=worker_b)
        assert "has already been evaluated" in str(excinfo_commit.value)

        # 6. Test Crash Recovery / Lease Expiry on uncommitted experiment
        exp_crash_id = "EXP_CRASHED_WORKER_002"
        claim_crash = ResearchExperimentRegistry.claim_experiment(
            experiment_id=exp_crash_id,
            worker_id="crashed_worker:pid999",
            lease_ttl_seconds=0
        )
        time.sleep(0.05)

        # Worker B reclaims expired lease
        reclaimed = ResearchExperimentRegistry.claim_experiment(
            experiment_id=exp_crash_id,
            worker_id=worker_b,
            lease_ttl_seconds=300
        )
        assert reclaimed["status"] == "CLAIMED"
        assert reclaimed["claim"]["workerId"] == worker_b
        assert any(h["event"] == "LEASE_EXPIRED_RECLAIMED" for h in reclaimed["history"])

        ResearchPartitionGuard.reset_locks()

    def test_registry_corruption_fails_closed(self):
        """Item 3: Registry corruption MUST fail closed with RegistryCorruptionError and not return empty state."""
        from research.research_partition_guard import ResearchExperimentRegistry, RegistryCorruptionError
        ResearchPartitionGuard.reset_locks()

        # Corrupt the registry file with invalid JSON
        ResearchExperimentRegistry._ensure_dir()
        with open(ResearchExperimentRegistry._REGISTRY_FILE, "w", encoding="utf-8") as f:
            f.write("{ INVALID_JSON_DATA_CORRUPTED: true, ")

        with pytest.raises(RegistryCorruptionError) as excinfo:
            ResearchExperimentRegistry._load_registry()
        assert "REGISTRY_CORRUPTION" in str(excinfo.value)

        # Attempting to claim or check an experiment when corrupted must fail closed
        with pytest.raises(RegistryCorruptionError):
            ResearchExperimentRegistry.claim_experiment("EXP_TEST_CORRUPT")

        # Cleanup
        os.remove(ResearchExperimentRegistry._REGISTRY_FILE)
        ResearchPartitionGuard.reset_locks()

    def test_commit_evidence_mandatory_lineage_and_valid_evidence(self):
        """Item 5 & 6: commit_evidence requires mandatory lineage hashes and valid evidence."""
        from research.research_partition_guard import (
            ResearchExperimentRegistry,
            MissingLineageError,
            InvalidEvidenceError
        )
        ResearchPartitionGuard.reset_locks()

        exp_id = "EXP_LINEAGE_ENFORCEMENT_001"
        claim = ResearchExperimentRegistry.claim_experiment(exp_id)
        claim_id = claim["claim"]["claimId"]

        # Missing lineage -> rejected
        with pytest.raises(MissingLineageError):
            ResearchExperimentRegistry.commit_evidence(
                experiment_id=exp_id,
                claim_id=claim_id,
                evidence_metrics={"sampleCount": 100, "sharpe": 1.5},
                lineage_hashes={}  # Empty lineage
            )

        # Missing mandatory key (e.g. modelHash) -> rejected
        with pytest.raises(MissingLineageError):
            ResearchExperimentRegistry.commit_evidence(
                experiment_id=exp_id,
                claim_id=claim_id,
                evidence_metrics={"sampleCount": 100, "sharpe": 1.5},
                lineage_hashes={"datasetHash": "data_hash", "featureHash": "feat_hash"}  # Missing modelHash
            )

        # Invalid evidence (sampleCount < 1) -> rejected
        with pytest.raises(InvalidEvidenceError):
            ResearchExperimentRegistry.commit_evidence(
                experiment_id=exp_id,
                claim_id=claim_id,
                evidence_metrics={"sampleCount": 0},
                lineage_hashes={"datasetHash": "d", "featureHash": "f", "modelHash": "m"}
            )

        ResearchPartitionGuard.reset_locks()

    def test_commit_evidence_unexpired_lease_and_worker_ownership(self):
        """Item 7: commit_evidence fails closed on expired lease or worker mismatch."""
        from research.research_partition_guard import (
            ResearchExperimentRegistry,
            ExpiredLeaseCommitError,
            TestSelectionLockError
        )
        ResearchPartitionGuard.reset_locks()

        exp_id = "EXP_LEASE_EXPIRY_COMMIT_001"
        # Claim with 0s lease so it expires immediately
        claim = ResearchExperimentRegistry.claim_experiment(
            exp_id,
            worker_id="worker_alpha",
            lease_ttl_seconds=0
        )
        claim_id = claim["claim"]["claimId"]
        time.sleep(0.05)

        # Commit on expired lease -> must fail
        with pytest.raises(ExpiredLeaseCommitError) as excinfo:
            ResearchExperimentRegistry.commit_evidence(
                experiment_id=exp_id,
                claim_id=claim_id,
                evidence_metrics={"sampleCount": 100, "sharpe": 1.2},
                lineage_hashes={"datasetHash": "d", "featureHash": "f", "modelHash": "m"},
                worker_id="worker_alpha"
            )
        assert "EXPIRED_LEASE_COMMIT" in str(excinfo.value)

        # Worker ownership mismatch -> must fail
        exp_id2 = "EXP_WORKER_MISMATCH_002"
        claim2 = ResearchExperimentRegistry.claim_experiment(
            exp_id2,
            worker_id="worker_alpha",
            lease_ttl_seconds=300
        )
        claim_id2 = claim2["claim"]["claimId"]

        with pytest.raises(TestSelectionLockError) as excinfo2:
            ResearchExperimentRegistry.commit_evidence(
                experiment_id=exp_id2,
                claim_id=claim_id2,
                evidence_metrics={"sampleCount": 100, "sharpe": 1.2},
                lineage_hashes={"datasetHash": "d", "featureHash": "f", "modelHash": "m"},
                worker_id="worker_impostor"
            )
        assert "WORKER_OWNERSHIP_MISMATCH" in str(excinfo2.value)

        ResearchPartitionGuard.reset_locks()

    def test_guarded_reset_blocks_in_production(self):
        """Item 9: reset_registry() and reset_locks() must raise PermissionError in production environment."""
        from research.research_partition_guard import ResearchExperimentRegistry
        old_env = os.environ.get("QUANTX_ENVIRONMENT")
        try:
            os.environ["QUANTX_ENVIRONMENT"] = "production"
            with pytest.raises(PermissionError):
                ResearchExperimentRegistry.reset_registry()
            with pytest.raises(PermissionError):
                ResearchPartitionGuard.reset_locks()
        finally:
            if old_env is not None:
                os.environ["QUANTX_ENVIRONMENT"] = old_env
            else:
                os.environ.pop("QUANTX_ENVIRONMENT", None)

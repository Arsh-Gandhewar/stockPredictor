"""
Comprehensive Tests for TransactionalResearchRegistry, Generation Fencing, and 12-Dimensional Lineage.
"""
import os
import sys
import time
import pytest
import hashlib

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.evidence_schema import (
    ResearchLineage,
    ResearchEvidence,
    EvidenceValidationError,
    AccountingInconsistencyError,
    compute_deterministic_evidence_content_hash
)
from research.research_registry import (
    TransactionalResearchRegistry,
    DuplicateCommitError,
    WorkerOwnershipError,
    StaleGenerationError,
    LeaseExpiredError
)


def make_64hex(seed: str) -> str:
    return hashlib.sha256(seed.encode('utf-8')).hexdigest()


@pytest.fixture
def ephemeral_registry(tmp_path):
    db_file = str(tmp_path / "test_research_registry.db")
    return TransactionalResearchRegistry(db_path=db_file)


@pytest.fixture
def sample_12d_lineage():
    return ResearchLineage(
        datasetHash=make_64hex("dataset_nse_eod_v5"),
        universeHash=make_64hex("universe_nifty500_pit"),
        featureHash=make_64hex("features_25_indicators"),
        modelHash=make_64hex("model_onnx_5d_lgbm"),
        calibrationHash=make_64hex("calibration_isotonic_pav"),
        distributionHash=make_64hex("distribution_empirical_returns"),
        strategyHash=make_64hex("strategy_cross_sectional_rank"),
        portfolioHash=make_64hex("portfolio_max_sharpe_5pos"),
        executionHash=make_64hex("execution_market_adverse_slippage"),
        benchmarkHash=make_64hex("benchmark_nifty50_tri"),
        environmentHash=make_64hex("environment_py312_onnx127"),
        experimentConfigHash=make_64hex("config_hyperparams_v5")
    )


@pytest.fixture
def sample_evidence():
    return ResearchEvidence(
        tradeCount=45,
        dailyObservationCount=252,
        predictionCount=520,
        effectiveSampleSize=210.5,
        profitFactorStatus="FINITE",
        grossProfitFactor=2.15,
        netProfitFactor=1.42,
        netCagr=18.4,
        sharpe=1.12,
        sortino=1.58,
        maxDrawdown=-12.3,
        turnoverAnnual=2.4,
        totalCosts=1420.50,
        totalGrossPnl=10000.0,
        totalNetPnl=8579.50,
        pbo=0.18,
        dsr=0.82,
        isAlphaSignificant=True,
        hasAlphaDecay=False,
        partition="TEST",
        status="COMMITTED"
    )


class TestTransactionalResearchRegistry:
    def test_atomic_claim_and_generation_fencing(self, ephemeral_registry, sample_12d_lineage):
        reg = ephemeral_registry
        exp_id = "EXP_ALPHA_001"
        worker_1 = "worker_node_1:pid_1001"
        worker_2 = "worker_node_2:pid_1002"

        # Worker 1 claims experiment
        claim_1 = reg.claim_experiment(exp_id, worker_id=worker_1, lease_ttl_seconds=10, lineage=sample_12d_lineage)
        assert claim_1["status"] == "CLAIMED"
        assert claim_1["claim"]["claimGeneration"] == 1
        assert claim_1["claim"]["workerId"] == worker_1

        # Worker 2 attempts immediate concurrent claim -> rejected
        with pytest.raises(WorkerOwnershipError) as excinfo:
            reg.claim_experiment(exp_id, worker_id=worker_2)
        assert "actively claimed by worker" in str(excinfo.value)

    def test_heartbeat_lease_extension(self, ephemeral_registry):
        reg = ephemeral_registry
        exp_id = "EXP_ALPHA_002"
        worker = "worker_node_1:pid_1001"

        claim = reg.claim_experiment(exp_id, worker_id=worker, lease_ttl_seconds=5)
        claim_id = claim["claim"]["claimId"]
        gen = claim["claim"]["claimGeneration"]

        # Heartbeat renewal
        renewed = reg.heartbeat_claim(exp_id, claim_id=claim_id, claim_generation=gen, extension_seconds=20, worker_id=worker)
        assert renewed is True

        exp_data = reg.get_experiment(exp_id)
        assert exp_data["claim"]["leaseExpiryTs"] > claim["claim"]["leaseExpiryTs"]

    def test_expired_lease_reclamation_and_stale_worker_rejection(self, ephemeral_registry, sample_12d_lineage, sample_evidence):
        reg = ephemeral_registry
        exp_id = "EXP_ALPHA_003"
        worker_1 = "worker_node_1:pid_1001"
        worker_2 = "worker_node_2:pid_1002"

        # Worker 1 claims with 0s lease so it expires immediately
        claim_1 = reg.claim_experiment(exp_id, worker_id=worker_1, lease_ttl_seconds=0)
        claim_id_1 = claim_1["claim"]["claimId"]
        gen_1 = claim_1["claim"]["claimGeneration"]
        time.sleep(0.05)

        # Worker 2 reclaims expired lease
        claim_2 = reg.claim_experiment(exp_id, worker_id=worker_2, lease_ttl_seconds=300)
        assert claim_2["claim"]["claimGeneration"] == 2
        claim_id_2 = claim_2["claim"]["claimId"]
        gen_2 = claim_2["claim"]["claimGeneration"]

        # Worker 1 (stale generation 1) tries to commit evidence -> rejected with StaleGenerationError
        with pytest.raises(StaleGenerationError):
            reg.commit_evidence(
                experiment_id=exp_id,
                claim_id=claim_id_1,
                claim_generation=gen_1,
                evidence=sample_evidence,
                lineage=sample_12d_lineage,
                worker_id=worker_1
            )

        # Worker 2 commits evidence with generation 2 -> succeeds
        committed = reg.commit_evidence(
            experiment_id=exp_id,
            claim_id=claim_id_2,
            claim_generation=gen_2,
            evidence=sample_evidence,
            lineage=sample_12d_lineage,
            worker_id=worker_2
        )
        assert committed["status"] == "COMMITTED"
        assert committed["claimGeneration"] == 2
        assert "evidenceContentHash" in committed

    def test_committed_experiment_cannot_be_deleted(self, ephemeral_registry, sample_12d_lineage, sample_evidence):
        reg = ephemeral_registry
        exp_id = "EXP_ALPHA_004"
        worker = "worker_node_1:pid_1001"

        claim = reg.claim_experiment(exp_id, worker_id=worker, lease_ttl_seconds=300)
        reg.commit_evidence(
            experiment_id=exp_id,
            claim_id=claim["claim"]["claimId"],
            claim_generation=claim["claim"]["claimGeneration"],
            evidence=sample_evidence,
            lineage=sample_12d_lineage,
            worker_id=worker
        )

        # Attempt to delete committed experiment -> raises PermissionError
        with pytest.raises(PermissionError):
            reg.delete_experiment(exp_id)

        # Attempt to re-claim -> DuplicateCommitError
        with pytest.raises(DuplicateCommitError):
            reg.claim_experiment(exp_id, worker_id=worker)


class TestEvidenceSchemaValidation:
    def test_valid_evidence_and_content_hashing(self, sample_12d_lineage, sample_evidence):
        content_hash = compute_deterministic_evidence_content_hash(sample_12d_lineage, sample_evidence)
        assert isinstance(content_hash, str)
        assert len(content_hash) == 64

    def test_non_64hex_lineage_fails(self):
        with pytest.raises(EvidenceValidationError) as excinfo:
            ResearchLineage(
                datasetHash="not_a_64_hex_hash",  # Invalid
                universeHash=make_64hex("u"),
                featureHash=make_64hex("f"),
                modelHash=make_64hex("m"),
                calibrationHash=make_64hex("c"),
                distributionHash=make_64hex("d"),
                strategyHash=make_64hex("s"),
                portfolioHash=make_64hex("p"),
                executionHash=make_64hex("e"),
                benchmarkHash=make_64hex("b"),
                environmentHash=make_64hex("env"),
                experimentConfigHash=make_64hex("cfg")
            )
        assert "LINEAGE_HASH_INVALID" in str(excinfo.value)

    def test_zero_losses_profit_factor_is_none(self, sample_12d_lineage):
        ev = ResearchEvidence(
            tradeCount=10,
            dailyObservationCount=50,
            predictionCount=50,
            effectiveSampleSize=48.0,
            profitFactorStatus="UNDEFINED_NO_LOSSES",
            grossProfitFactor=None,
            netProfitFactor=None,
            netCagr=15.0,
            sharpe=1.2,
            sortino=1.5,
            maxDrawdown=-2.0,
            turnoverAnnual=1.0,
            totalCosts=50.0,
            totalGrossPnl=500.0,
            totalNetPnl=450.0,
            pbo=0.1,
            dsr=0.9,
            isAlphaSignificant=True,
            hasAlphaDecay=False,
            partition="TEST",
            status="COMMITTED"
        )
        assert ev.grossProfitFactor is None
        assert ev.netProfitFactor is None

    def test_unphysical_profit_factor_raises_inconsistency_error(self):
        with pytest.raises(AccountingInconsistencyError) as excinfo:
            ResearchEvidence(
                tradeCount=10,
                dailyObservationCount=50,
                predictionCount=50,
                effectiveSampleSize=48.0,
                profitFactorStatus="FINITE",
                grossProfitFactor=1.2,
                netProfitFactor=1.8,  # Net PF > Gross PF
                netCagr=10.0,
                sharpe=1.0,
                sortino=1.2,
                maxDrawdown=-5.0,
                turnoverAnnual=1.0,
                totalCosts=100.0,
                totalGrossPnl=1000.0,
                totalNetPnl=900.0,
                pbo=0.2,
                dsr=0.7,
                isAlphaSignificant=True,
                hasAlphaDecay=False,
                partition="TEST",
                status="COMMITTED"
            )
        assert "INCONSISTENT_PROFIT_FACTOR" in str(excinfo.value)

    def test_pnl_mismatch_raises_accounting_error(self):
        with pytest.raises(AccountingInconsistencyError) as excinfo:
            ResearchEvidence(
                tradeCount=10,
                dailyObservationCount=50,
                predictionCount=50,
                effectiveSampleSize=48.0,
                profitFactorStatus="FINITE",
                grossProfitFactor=1.5,
                netProfitFactor=1.3,
                netCagr=10.0,
                sharpe=1.0,
                sortino=1.2,
                maxDrawdown=-5.0,
                turnoverAnnual=1.0,
                totalCosts=100.0,
                totalGrossPnl=1000.0,
                totalNetPnl=500.0,  # Expected 900.0 (1000 - 100)
                pbo=0.2,
                dsr=0.7,
                isAlphaSignificant=True,
                hasAlphaDecay=False,
                partition="TEST",
                status="COMMITTED"
            )
        assert "ACCOUNTING_PNL_MISMATCH" in str(excinfo.value)

    def test_strict_from_dict_rejects_coercion(self):
        with pytest.raises(EvidenceValidationError) as excinfo:
            ResearchEvidence.from_dict({
                "tradeCount": 10,
                "dailyObservationCount": 50,
                "predictionCount": 50,
                "effectiveSampleSize": 48.0,
                "profitFactorStatus": "FINITE",
                "grossProfitFactor": 1.5,
                "netProfitFactor": 1.3,
                "netCagr": 10.0,
                "sharpe": 1.0,
                "sortino": 1.2,
                "maxDrawdown": -5.0,
                "turnoverAnnual": 1.0,
                "totalCosts": 100.0,
                "totalGrossPnl": 1000.0,
                "totalNetPnl": 900.0,
                "pbo": 0.2,
                "dsr": 0.7,
                "isAlphaSignificant": "true",  # String instead of boolean -> rejected
                "hasAlphaDecay": False,
                "partition": "TEST",
                "status": "COMMITTED"
            })
        assert "TYPE_ERROR" in str(excinfo.value)

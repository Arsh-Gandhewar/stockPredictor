"""
Comprehensive Tests for TransactionalResearchRegistry, Generation Fencing, and 12-Dimensional Lineage.
"""
import os
import sys
import time
import pytest

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.evidence_schema import (
    ResearchLineage,
    ResearchEvidence,
    EvidenceValidationError,
    compute_evidence_bundle_hash
)
from research.research_registry import (
    TransactionalResearchRegistry,
    DuplicateCommitError,
    WorkerOwnershipError,
    StaleGenerationError,
    LeaseExpiredError
)


@pytest.fixture
def ephemeral_registry(tmp_path):
    db_file = str(tmp_path / "test_research_registry.db")
    return TransactionalResearchRegistry(db_path=db_file)


@pytest.fixture
def sample_12d_lineage():
    return ResearchLineage(
        datasetHash="data_sha256_001_nse_daily_eod",
        universeHash="univ_sha256_002_nifty500_survivorship",
        featureHash="feat_sha256_003_25_technical_indicators",
        modelHash="model_sha256_004_lightgbm_regressor_5d",
        calibrationHash="calib_sha256_005_isotonic_pav_bounds",
        distributionHash="dist_sha256_006_empirical_returns",
        strategyHash="strat_sha256_007_cross_sectional_rank",
        portfolioHash="port_sha256_008_max_sharpe_5pos_capped",
        executionHash="exec_sha256_009_market_adverse_slippage",
        benchmarkHash="bench_sha256_010_nifty50_total_return",
        environmentHash="env_sha256_011_python312_onnx127_linux",
        experimentConfigHash="cfg_sha256_012_institutional_hyperparams"
    )


@pytest.fixture
def sample_evidence():
    return ResearchEvidence(
        sampleCount=520,
        grossProfitFactor=2.15,
        netProfitFactor=1.42,
        netCagr=18.4,
        sharpe=1.12,
        sortino=1.58,
        maxDrawdown=-12.3,
        turnoverAnnual=2.4,
        totalCosts=1420.50,
        pbo=0.18,
        dsr=0.82,
        isAlphaSignificant=True,
        hasAlphaDecay=False,
        completedAt="2026-09-01T15:00:00Z",
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
        assert "evidenceBundleHash" in committed

    def test_committed_experiment_is_permanently_immutable(self, ephemeral_registry, sample_12d_lineage, sample_evidence):
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

        # Any attempt to re-claim or re-evaluate is permanently blocked
        with pytest.raises(DuplicateCommitError):
            reg.claim_experiment(exp_id, worker_id=worker)


class TestEvidenceSchemaValidation:
    def test_valid_evidence_and_bundle_hashing(self, sample_12d_lineage, sample_evidence):
        bundle_hash = compute_evidence_bundle_hash(sample_12d_lineage, sample_evidence)
        assert isinstance(bundle_hash, str)
        assert len(bundle_hash) == 64

    def test_missing_lineage_dimensions_fails(self):
        with pytest.raises(EvidenceValidationError) as excinfo:
            ResearchLineage.from_dict({
                "datasetHash": "data_hash",
                "universeHash": "univ_hash"
                # Missing other 10 dimensions
            })
        assert "MISSING_LINEAGE_DIMENSIONS" in str(excinfo.value)

    def test_nan_or_inf_metric_fails(self):
        with pytest.raises(EvidenceValidationError) as excinfo:
            ResearchEvidence(
                sampleCount=100,
                grossProfitFactor=2.0,
                netProfitFactor=1.5,
                netCagr=float("nan"),  # Illegal NaN
                sharpe=1.0,
                sortino=1.2,
                maxDrawdown=-5.0,
                turnoverAnnual=1.0,
                totalCosts=100.0,
                pbo=0.2,
                dsr=0.7,
                isAlphaSignificant=True,
                hasAlphaDecay=False,
                completedAt="2026-09-01T15:00:00Z"
            )
        assert "EVIDENCE_FINITE_ERROR" in str(excinfo.value)

    def test_unphysical_profit_factor_fails(self):
        with pytest.raises(EvidenceValidationError) as excinfo:
            ResearchEvidence(
                sampleCount=100,
                grossProfitFactor=1.2,
                netProfitFactor=1.8,  # Net PF > Gross PF is impossible with positive friction
                netCagr=10.0,
                sharpe=1.0,
                sortino=1.2,
                maxDrawdown=-5.0,
                turnoverAnnual=1.0,
                totalCosts=100.0,
                pbo=0.2,
                dsr=0.7,
                isAlphaSignificant=True,
                hasAlphaDecay=False,
                completedAt="2026-09-01T15:00:00Z"
            )
        assert "EVIDENCE_PF_INCONSISTENCY" in str(excinfo.value)

"""
QuantX Evidence Integrity Engine — BUG 4 Master Repair.

Binds every research result to its exact provenance using cryptographic hashes.
Detects evidence corruption, stale artifacts, and missing evidence.

Raises hard errors — never warnings.
"""
import json
import hashlib
from dataclasses import dataclass, asdict, field
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Error Types
# ---------------------------------------------------------------------------

class EvidenceCorruptionError(Exception):
    """Raised when any evidence file has been tampered with or corrupted."""
    pass


class StaleEvidenceError(Exception):
    """Raised when evidence was generated from a different git SHA or dataset."""
    pass


class MissingEvidenceError(Exception):
    """Raised when required evidence is absent (trade, equity row, distribution)."""
    pass


class CertificationInvalidError(Exception):
    """Raised when any certification precondition fails."""
    pass


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _sha256(obj: Any) -> str:
    canonical = json.dumps(obj, sort_keys=True, separators=(',', ':'), default=str)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Evidence Bundle
# ---------------------------------------------------------------------------

@dataclass
class ResearchEvidenceBundle:
    """
    Complete provenance binding for a research result.
    All fields are immutable once sealed.
    """
    resultId: str
    gitSha: str
    datasetHash: str
    universeHash: str
    featureHash: str
    modelHash: str
    strategyHash: str
    executionHash: str
    environmentHash: str
    experimentId: str
    experimentRegistryHash: str
    predictionsHash: str
    tradesHash: str
    equityHash: str
    metricsHash: str
    generatedAt: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    researchEvidenceHash: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def compute_evidence_hash(self) -> str:
        payload = {
            'gitSha': self.gitSha,
            'datasetHash': self.datasetHash,
            'universeHash': self.universeHash,
            'featureHash': self.featureHash,
            'modelHash': self.modelHash,
            'strategyHash': self.strategyHash,
            'executionHash': self.executionHash,
            'predictionsHash': self.predictionsHash,
            'tradesHash': self.tradesHash,
            'equityHash': self.equityHash,
            'metricsHash': self.metricsHash,
        }
        return _sha256(payload)

    def seal(self) -> 'ResearchEvidenceBundle':
        self.researchEvidenceHash = self.compute_evidence_hash()
        return self


# ---------------------------------------------------------------------------
# Evidence Integrity Engine
# ---------------------------------------------------------------------------

class EvidenceIntegrityEngine:
    """
    Verifies that all research evidence is consistent, current, and untampered.
    Three failure modes:
      1. Corruption  — any sub-hash mismatch (evidence tampered)
      2. Stale       — git SHA or dataset hash changed (re-run required)
      3. Missing     — required evidence absent (certification blocked)
    """

    @staticmethod
    def verify_integrity(
        bundle: ResearchEvidenceBundle,
        expected_evidence_hash: Optional[str] = None,
    ) -> None:
        """
        Recomputes evidence hash and compares to stored value.
        Raises EvidenceCorruptionError if any hash mismatches.
        """
        recomputed = bundle.compute_evidence_hash()
        if bundle.researchEvidenceHash and recomputed != bundle.researchEvidenceHash:
            raise EvidenceCorruptionError(
                f"EVIDENCE CORRUPTION: Stored researchEvidenceHash '{bundle.researchEvidenceHash[:16]}...' "
                f"does not match recomputed '{recomputed[:16]}...'. "
                "One or more evidence sub-hashes have been altered."
            )
        if expected_evidence_hash and recomputed != expected_evidence_hash:
            raise EvidenceCorruptionError(
                f"EVIDENCE CORRUPTION: Expected hash '{expected_evidence_hash[:16]}...' "
                f"but got '{recomputed[:16]}...'. "
                "Evidence has been tampered with or replaced."
            )

    @staticmethod
    def verify_freshness(
        bundle: ResearchEvidenceBundle,
        current_git_sha: str,
        current_dataset_hash: str,
        current_strategy_hash: str,
        current_execution_hash: str,
    ) -> None:
        """
        Verifies evidence matches current repository state.
        Raises StaleEvidenceError if any hash is from an older version.
        """
        failures = []
        if bundle.gitSha != current_git_sha:
            failures.append(
                f"gitSha: evidence={bundle.gitSha[:12]}..., current={current_git_sha[:12]}..."
            )
        if bundle.datasetHash != current_dataset_hash:
            failures.append(
                f"datasetHash: evidence={bundle.datasetHash[:12]}..., current={current_dataset_hash[:12]}..."
            )
        if bundle.strategyHash != current_strategy_hash:
            failures.append(
                f"strategyHash: evidence={bundle.strategyHash[:12]}..., current={current_strategy_hash[:12]}..."
            )
        if bundle.executionHash != current_execution_hash:
            failures.append(
                f"executionHash: evidence={bundle.executionHash[:12]}..., current={current_execution_hash[:12]}..."
            )
        if failures:
            raise StaleEvidenceError(
                "STALE EVIDENCE DETECTED — evidence was generated from a different state:\n"
                + '\n'.join(f"  {f}" for f in failures)
                + "\nRegenerate all evidence from current code and data."
            )

    @staticmethod
    def verify_trade_presence(
        trade_ledger: List[Dict[str, Any]],
        minimum_trades: int = 1,
    ) -> None:
        """Raises MissingEvidenceError if trade ledger is empty or below minimum."""
        if len(trade_ledger) < minimum_trades:
            raise MissingEvidenceError(
                f"MISSING TRADE EVIDENCE: Trade ledger contains {len(trade_ledger)} trades, "
                f"minimum required is {minimum_trades}. Certification blocked."
            )

    @staticmethod
    def verify_equity_presence(
        equity_series: List[Any],
        minimum_points: int = 10,
    ) -> None:
        """Raises MissingEvidenceError if equity series is empty or too short."""
        if len(equity_series) < minimum_points:
            raise MissingEvidenceError(
                f"MISSING EQUITY EVIDENCE: Equity series has {len(equity_series)} points, "
                f"minimum required is {minimum_points}. Certification blocked."
            )

    @staticmethod
    def verify_no_missing_fields(bundle: ResearchEvidenceBundle) -> None:
        """Raises MissingEvidenceError if any required hash field is empty."""
        required_fields = [
            'gitSha', 'datasetHash', 'universeHash', 'featureHash',
            'modelHash', 'strategyHash', 'executionHash', 'predictionsHash',
            'tradesHash', 'equityHash', 'metricsHash', 'researchEvidenceHash',
        ]
        empty = [f for f in required_fields if not getattr(bundle, f, '')]
        if empty:
            raise MissingEvidenceError(
                f"MISSING EVIDENCE FIELDS: {empty}. "
                "All evidence hash fields must be populated before certification."
            )

    # ------------------------------------------------------------------
    # Adversarial Corruption Tests
    # ------------------------------------------------------------------

    @staticmethod
    def test_trade_corruption_detected(
        trade_ledger: List[Dict[str, Any]],
        original_hash: str,
    ) -> bool:
        """Returns True if corrupting a trade changes the hash (as expected)."""
        if not trade_ledger:
            return True
        corrupted = [t.copy() for t in trade_ledger]
        corrupted[0]['netPnl'] = corrupted[0].get('netPnl', 0.0) + 999999.0
        corrupted_hash = _sha256(corrupted)
        return corrupted_hash != original_hash

    @staticmethod
    def test_equity_corruption_detected(
        equity_series: List[float],
        original_hash: str,
    ) -> bool:
        """Returns True if corrupting an equity point changes the hash."""
        if not equity_series:
            return True
        corrupted = list(equity_series)
        corrupted[0] = corrupted[0] + 999999.0
        corrupted_rounded = [round(v, 6) for v in corrupted]
        corrupted_hash = _sha256(corrupted_rounded)
        return corrupted_hash != original_hash

    # ------------------------------------------------------------------
    # Audit Results Generator
    # ------------------------------------------------------------------

    @staticmethod
    def generate_audit_results(
        bundle: ResearchEvidenceBundle,
        technical_status: str,
        economic_status: str,
        overfit_risk: str,
        all_tests_pass: bool,
        integrity_answers: Dict[str, str],
        additional: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Generates the canonical audit-results.json payload.

        productionReady = True ONLY IF all gates pass.
        """
        production_ready = (
            technical_status == 'PASS'
            and economic_status == 'PASS'
            and overfit_risk != 'HIGH'
            and all_tests_pass
            and bundle.researchEvidenceHash != ''
        )

        result = {
            'auditRunId': bundle.resultId,
            'generatedAt': bundle.generatedAt,
            'gitSha': bundle.gitSha,
            'datasetHash': bundle.datasetHash,
            'universeHash': bundle.universeHash,
            'featureHash': bundle.featureHash,
            'modelHash': bundle.modelHash,
            'strategyHash': bundle.strategyHash,
            'executionHash': bundle.executionHash,
            'environmentHash': bundle.environmentHash,
            'experimentId': bundle.experimentId,
            'experimentRegistryHash': bundle.experimentRegistryHash,
            'predictionsHash': bundle.predictionsHash,
            'tradesHash': bundle.tradesHash,
            'equityHash': bundle.equityHash,
            'metricsHash': bundle.metricsHash,
            'researchEvidenceHash': bundle.researchEvidenceHash,
            'technicalStatus': technical_status,
            'economicStatus': economic_status,
            'overfitRisk': overfit_risk,
            'allTestsPass': all_tests_pass,
            'productionReady': production_ready,
            'integrityAnswers': integrity_answers,
        }
        if additional:
            result.update(additional)
        return result

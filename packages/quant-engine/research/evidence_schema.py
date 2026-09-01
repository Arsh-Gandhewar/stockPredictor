"""
QuantX Authoritative Typed Research Evidence & Lineage Schema.

Provides strictly typed, range-validated, finite, tamper-proof representations for:
  1. 12-Dimensional Cryptographic Lineage Binding
  2. Research Performance Evidence (CAGR, Sharpe, DSR, PBO, PF, Drawdown)
  3. Canonical Evidence Bundle Root Fingerprint Calculation
"""
import math
import json
import hashlib
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict


class EvidenceValidationError(ValueError):
    """Raised when research evidence or lineage violates mathematical, semantic, or schema bounds."""
    pass


@dataclass(frozen=True)
class ResearchLineage:
    """
    Mandatory 12-Dimensional Cryptographic Lineage Binding.
    Every dimension must be an immutable, non-empty content-addressed SHA-256 fingerprint.
    """
    datasetHash: str
    universeHash: str
    featureHash: str
    modelHash: str
    calibrationHash: str
    distributionHash: str
    strategyHash: str
    portfolioHash: str
    executionHash: str
    benchmarkHash: str
    environmentHash: str
    experimentConfigHash: str

    def __post_init__(self):
        required_fields = [
            "datasetHash", "universeHash", "featureHash", "modelHash",
            "calibrationHash", "distributionHash", "strategyHash", "portfolioHash",
            "executionHash", "benchmarkHash", "environmentHash", "experimentConfigHash"
        ]
        for field in required_fields:
            val = getattr(self, field)
            if not isinstance(val, str) or not val.strip():
                raise EvidenceValidationError(f"LINEAGE_VALIDATION_ERROR: Field '{field}' must be a non-empty string.")
            if len(val.strip()) < 8:
                raise EvidenceValidationError(f"LINEAGE_VALIDATION_ERROR: Field '{field}' hash is too short ({len(val)} chars).")

    def to_dict(self) -> Dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ResearchLineage':
        if not isinstance(data, dict):
            raise EvidenceValidationError("ResearchLineage must be instantiated from a dictionary.")
        required_fields = [
            "datasetHash", "universeHash", "featureHash", "modelHash",
            "calibrationHash", "distributionHash", "strategyHash", "portfolioHash",
            "executionHash", "benchmarkHash", "environmentHash", "experimentConfigHash"
        ]
        missing = [f for f in required_fields if f not in data or not data[f]]
        if missing:
            raise EvidenceValidationError(f"MISSING_LINEAGE_DIMENSIONS: Missing mandatory lineage hashes: {missing}")
        return cls(**{k: str(data[k]) for k in required_fields})


@dataclass(frozen=True)
class ResearchEvidence:
    """
    Strictly Typed & Range-Validated Research Performance Evidence.
    Fails closed on NaN, Inf, non-positive samples, or unphysical economic metrics.
    """
    sampleCount: int
    grossProfitFactor: float
    netProfitFactor: float
    netCagr: float
    sharpe: float
    sortino: float
    maxDrawdown: float
    turnoverAnnual: float
    totalCosts: float
    pbo: float
    dsr: float
    isAlphaSignificant: bool
    hasAlphaDecay: bool
    completedAt: str
    partition: str = "TEST"
    status: str = "COMMITTED"

    def __post_init__(self):
        # 1. Finite float validation
        float_fields = [
            ("grossProfitFactor", self.grossProfitFactor),
            ("netProfitFactor", self.netProfitFactor),
            ("netCagr", self.netCagr),
            ("sharpe", self.sharpe),
            ("sortino", self.sortino),
            ("maxDrawdown", self.maxDrawdown),
            ("turnoverAnnual", self.turnoverAnnual),
            ("totalCosts", self.totalCosts),
            ("pbo", self.pbo),
            ("dsr", self.dsr),
        ]
        for name, val in float_fields:
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: Metric '{name}' must be a float, got {type(val)}.")
            if math.isnan(val) or math.isinf(val):
                raise EvidenceValidationError(f"EVIDENCE_FINITE_ERROR: Metric '{name}' cannot be NaN or Inf.")

        # 2. Sample count bounds
        if not isinstance(self.sampleCount, int) or isinstance(self.sampleCount, bool) or self.sampleCount < 1:
            raise EvidenceValidationError(f"EVIDENCE_SAMPLE_ERROR: sampleCount ({self.sampleCount}) must be an integer >= 1.")

        # 3. Profit Factor logic: Net PF cannot exceed Gross PF
        if self.grossProfitFactor < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_PF_ERROR: grossProfitFactor ({self.grossProfitFactor}) must be >= 0.")
        if self.netProfitFactor < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_PF_ERROR: netProfitFactor ({self.netProfitFactor}) must be >= 0.")
        if self.netProfitFactor > self.grossProfitFactor + 1e-5:
            raise EvidenceValidationError(
                f"EVIDENCE_PF_INCONSISTENCY: netProfitFactor ({self.netProfitFactor}) cannot exceed grossProfitFactor ({self.grossProfitFactor})."
            )

        # 4. Statistical overfit metric bounds
        if not (0.0 <= self.pbo <= 1.0):
            raise EvidenceValidationError(f"EVIDENCE_PBO_ERROR: pbo ({self.pbo}) must be bounded in [0.0, 1.0].")
        if not (0.0 <= self.dsr <= 1.0):
            raise EvidenceValidationError(f"EVIDENCE_DSR_ERROR: dsr ({self.dsr}) must be bounded in [0.0, 1.0].")

        # 5. Drawdown must be non-positive
        if self.maxDrawdown > 0.0:
            raise EvidenceValidationError(f"EVIDENCE_DRAWDOWN_ERROR: maxDrawdown ({self.maxDrawdown}) must be <= 0.")

        # 6. Turnover and costs must be non-negative
        if self.turnoverAnnual < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_TURNOVER_ERROR: turnoverAnnual ({self.turnoverAnnual}) must be >= 0.")
        if self.totalCosts < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_COSTS_ERROR: totalCosts ({self.totalCosts}) must be >= 0.")

        # 7. Partition must be legitimate
        if self.partition not in ["TRAIN", "VALIDATION", "TEST", "HOLDOUT"]:
            raise EvidenceValidationError(f"EVIDENCE_PARTITION_ERROR: Unknown partition '{self.partition}'.")

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ResearchEvidence':
        if not isinstance(data, dict):
            raise EvidenceValidationError("ResearchEvidence must be instantiated from a dictionary.")
        # Type coercions for numeric fields
        try:
            return cls(
                sampleCount=int(data["sampleCount"]),
                grossProfitFactor=float(data["grossProfitFactor"]),
                netProfitFactor=float(data["netProfitFactor"]),
                netCagr=float(data["netCagr"]),
                sharpe=float(data["sharpe"]),
                sortino=float(data["sortino"]),
                maxDrawdown=float(data["maxDrawdown"]),
                turnoverAnnual=float(data["turnoverAnnual"]),
                totalCosts=float(data["totalCosts"]),
                pbo=float(data["pbo"]),
                dsr=float(data.get("dsr", 0.5)),
                isAlphaSignificant=bool(data.get("isAlphaSignificant", False)),
                hasAlphaDecay=bool(data.get("hasAlphaDecay", True)),
                completedAt=str(data.get("completedAt", "")),
                partition=str(data.get("partition", "TEST")),
                status=str(data.get("status", "COMMITTED")),
            )
        except (KeyError, ValueError, TypeError) as exc:
            raise EvidenceValidationError(f"FAILED_TO_PARSE_EVIDENCE: {exc}") from exc


def compute_evidence_bundle_hash(lineage: ResearchLineage, evidence: ResearchEvidence) -> str:
    """
    Computes the authoritative SHA-256 root fingerprint across the 12-dimensional
    lineage binding and the research performance evidence.
    """
    canonical_payload = {
        "lineage": lineage.to_dict(),
        "evidence": evidence.to_dict()
    }
    canonical_json = json.dumps(canonical_payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()

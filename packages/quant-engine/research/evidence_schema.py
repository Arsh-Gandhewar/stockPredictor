"""
QuantX Authoritative Typed Research Evidence & Lineage Schema.

Provides strictly typed, range-validated, finite, tamper-proof representations for:
  1. 12-Dimensional Cryptographic Lineage Binding (strict 64-hex SHA-256 validation)
  2. Research Performance Evidence (Daily Equity Returns, Sharpe, Sortino, DSR, PBO, PF, Drawdown)
  3. Strict Type Verification (No semantic coercions or fallback defaults)
  4. Explicit Zero-Losses Representation (No fabricated 99.0 sentinels)
  5. Canonical Deterministic Evidence Content Hash
"""
import re
import math
import json
import hashlib
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict


class EvidenceValidationError(ValueError):
    """Raised when research evidence or lineage violates mathematical, semantic, or schema bounds."""
    pass


class AccountingInconsistencyError(EvidenceValidationError):
    """Raised when economic accounting invariants (e.g. Net PnL != Gross PnL - Costs) are violated."""
    pass


SHA256_HEX_REGEX = re.compile(r'^[0-9a-fA-F]{64}$')


@dataclass(frozen=True)
class ResearchLineage:
    """
    Mandatory 12-Dimensional Cryptographic Lineage Binding.
    Every dimension MUST be a genuine, 64-character hexadecimal SHA-256 digest.
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
            if not isinstance(val, str):
                raise EvidenceValidationError(f"LINEAGE_TYPE_ERROR: Field '{field}' must be a string, got {type(val)}.")
            val_clean = val.strip()
            if not SHA256_HEX_REGEX.match(val_clean):
                raise EvidenceValidationError(
                    f"LINEAGE_HASH_INVALID: Field '{field}' ('{val}') must be a 64-character hexadecimal SHA-256 digest."
                )

    def to_dict(self) -> Dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Any) -> 'ResearchLineage':
        if not isinstance(data, dict):
            raise EvidenceValidationError("ResearchLineage must be instantiated from a dictionary.")
        required_fields = [
            "datasetHash", "universeHash", "featureHash", "modelHash",
            "calibrationHash", "distributionHash", "strategyHash", "portfolioHash",
            "executionHash", "benchmarkHash", "environmentHash", "experimentConfigHash"
        ]
        for f in required_fields:
            if f not in data:
                raise EvidenceValidationError(f"MISSING_LINEAGE_DIMENSION: Missing mandatory lineage field '{f}'.")
            if not isinstance(data[f], str):
                raise EvidenceValidationError(f"LINEAGE_TYPE_ERROR: Field '{f}' must be a string.")
            if not SHA256_HEX_REGEX.match(data[f].strip()):
                raise EvidenceValidationError(
                    f"LINEAGE_HASH_INVALID: Field '{f}' must be a 64-character hexadecimal SHA-256 digest."
                )
        return cls(**{k: data[k].strip().lower() for k in required_fields})


@dataclass(frozen=True)
class ResearchEvidence:
    """
    Strictly Typed & Range-Validated Research Performance Evidence.
    Enforces exact types, semantic economic consistency, and zero-fake sentinels.
    """
    tradeCount: int
    dailyObservationCount: int
    predictionCount: int
    effectiveSampleSize: float
    profitFactorStatus: str
    grossProfitFactor: Optional[float]
    netProfitFactor: Optional[float]
    netCagr: float
    sharpe: float
    sortino: float
    maxDrawdown: float
    turnoverAnnual: float
    totalCosts: float
    totalGrossPnl: float
    totalNetPnl: float
    pbo: float
    dsr: float
    isAlphaSignificant: bool
    hasAlphaDecay: bool
    partition: str
    status: str

    def __post_init__(self):
        # 1. Exact Type Validation (No Coercions)
        if type(self.tradeCount) is not int or self.tradeCount < 0:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: tradeCount ({self.tradeCount}) must be an int >= 0.")
        if type(self.dailyObservationCount) is not int or self.dailyObservationCount < 1:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: dailyObservationCount ({self.dailyObservationCount}) must be an int >= 1.")
        if type(self.predictionCount) is not int or self.predictionCount < 1:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: predictionCount ({self.predictionCount}) must be an int >= 1.")
        if not isinstance(self.effectiveSampleSize, (int, float)) or type(self.effectiveSampleSize) is bool or self.effectiveSampleSize <= 0.0:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: effectiveSampleSize ({self.effectiveSampleSize}) must be a float > 0.")
        if type(self.isAlphaSignificant) is not bool:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: isAlphaSignificant must be an explicit boolean, got {type(self.isAlphaSignificant)}.")
        if type(self.hasAlphaDecay) is not bool:
            raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: hasAlphaDecay must be an explicit boolean, got {type(self.hasAlphaDecay)}.")

        # 2. Finite Float Checks
        float_fields = [
            ("effectiveSampleSize", self.effectiveSampleSize),
            ("netCagr", self.netCagr),
            ("sharpe", self.sharpe),
            ("sortino", self.sortino),
            ("maxDrawdown", self.maxDrawdown),
            ("turnoverAnnual", self.turnoverAnnual),
            ("totalCosts", self.totalCosts),
            ("totalGrossPnl", self.totalGrossPnl),
            ("totalNetPnl", self.totalNetPnl),
            ("pbo", self.pbo),
            ("dsr", self.dsr),
        ]
        for name, val in float_fields:
            if not isinstance(val, (int, float)) or type(val) is bool:
                raise EvidenceValidationError(f"EVIDENCE_TYPE_ERROR: Metric '{name}' must be a float, got {type(val)}.")
            if math.isnan(val) or math.isinf(val):
                raise EvidenceValidationError(f"EVIDENCE_FINITE_ERROR: Metric '{name}' cannot be NaN or Inf.")

        # 3. Profit Factor Status and Values (No Fake 99.0 Sentinels)
        valid_pf_statuses = ["FINITE", "UNDEFINED_NO_LOSSES", "NO_TRADES"]
        if self.profitFactorStatus not in valid_pf_statuses:
            raise EvidenceValidationError(f"EVIDENCE_PF_STATUS_ERROR: Unknown profitFactorStatus '{self.profitFactorStatus}'.")

        if self.profitFactorStatus == "UNDEFINED_NO_LOSSES":
            if self.grossProfitFactor is not None or self.netProfitFactor is not None:
                raise EvidenceValidationError("EVIDENCE_PF_SENTINEL_ERROR: Profit factors must be None when profitFactorStatus is UNDEFINED_NO_LOSSES.")
        elif self.profitFactorStatus == "NO_TRADES":
            if self.grossProfitFactor is not None or self.netProfitFactor is not None:
                raise EvidenceValidationError("EVIDENCE_PF_SENTINEL_ERROR: Profit factors must be None when profitFactorStatus is NO_TRADES.")
        elif self.profitFactorStatus == "FINITE":
            if self.grossProfitFactor is None or self.netProfitFactor is None:
                raise EvidenceValidationError("EVIDENCE_PF_VALUE_ERROR: Profit factors must be finite floats when profitFactorStatus is FINITE.")
            if math.isnan(self.grossProfitFactor) or math.isinf(self.grossProfitFactor) or self.grossProfitFactor < 0:
                raise EvidenceValidationError(f"EVIDENCE_PF_VALUE_ERROR: grossProfitFactor ({self.grossProfitFactor}) must be finite >= 0.")
            if math.isnan(self.netProfitFactor) or math.isinf(self.netProfitFactor) or self.netProfitFactor < 0:
                raise EvidenceValidationError(f"EVIDENCE_PF_VALUE_ERROR: netProfitFactor ({self.netProfitFactor}) must be finite >= 0.")
            # Fail-closed inconsistency detection (Never silently clip)
            if self.netProfitFactor > self.grossProfitFactor + 1e-5:
                raise AccountingInconsistencyError(
                    f"INCONSISTENT_PROFIT_FACTOR: netProfitFactor ({self.netProfitFactor}) strictly exceeds grossProfitFactor ({self.grossProfitFactor})."
                )

        # 4. Economic Accounting Consistency: Net PnL = Gross PnL - Total Costs (within 0.05 tolerance)
        expected_net_pnl = self.totalGrossPnl - self.totalCosts
        if abs(self.totalNetPnl - expected_net_pnl) > 0.05:
            raise AccountingInconsistencyError(
                f"ACCOUNTING_PNL_MISMATCH: totalNetPnl ({self.totalNetPnl}) does not equal totalGrossPnl ({self.totalGrossPnl}) - totalCosts ({self.totalCosts}) = {expected_net_pnl}."
            )

        # 5. Overfit & Risk Metric Bounds
        if not (0.0 <= self.pbo <= 1.0):
            raise EvidenceValidationError(f"EVIDENCE_PBO_BOUNDS: pbo ({self.pbo}) must be in [0.0, 1.0].")
        if not (0.0 <= self.dsr <= 1.0):
            raise EvidenceValidationError(f"EVIDENCE_DSR_BOUNDS: dsr ({self.dsr}) must be in [0.0, 1.0].")
        if self.maxDrawdown > 0.0:
            raise EvidenceValidationError(f"EVIDENCE_DRAWDOWN_BOUNDS: maxDrawdown ({self.maxDrawdown}) must be <= 0.0.")
        if self.turnoverAnnual < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_TURNOVER_BOUNDS: turnoverAnnual ({self.turnoverAnnual}) must be >= 0.0.")
        if self.totalCosts < 0.0:
            raise EvidenceValidationError(f"EVIDENCE_COSTS_BOUNDS: totalCosts ({self.totalCosts}) must be >= 0.0.")

        # 6. Partition and Status Validations
        if self.partition not in ["TRAIN", "VALIDATION", "TEST", "HOLDOUT"]:
            raise EvidenceValidationError(f"EVIDENCE_PARTITION_ERROR: Unknown partition '{self.partition}'.")
        if self.status not in ["AVAILABLE", "CLAIMED", "EVALUATING", "COMMITTED", "EXPIRED", "ABORTED"]:
            raise EvidenceValidationError(f"EVIDENCE_STATUS_ERROR: Unknown status '{self.status}'.")

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Any) -> 'ResearchEvidence':
        if not isinstance(data, dict):
            raise EvidenceValidationError("ResearchEvidence must be instantiated from a dictionary.")

        required_keys = [
            "tradeCount", "dailyObservationCount", "predictionCount", "effectiveSampleSize",
            "profitFactorStatus", "grossProfitFactor", "netProfitFactor", "netCagr",
            "sharpe", "sortino", "maxDrawdown", "turnoverAnnual", "totalCosts",
            "totalGrossPnl", "totalNetPnl", "pbo", "dsr", "isAlphaSignificant",
            "hasAlphaDecay", "partition", "status"
        ]
        for k in required_keys:
            if k not in data:
                raise EvidenceValidationError(f"MISSING_EVIDENCE_FIELD: Required field '{k}' is missing from evidence dictionary.")

        # Strict type check without silent coercions
        if type(data["isAlphaSignificant"]) is not bool:
            raise EvidenceValidationError(f"TYPE_ERROR: 'isAlphaSignificant' must be a boolean, got {type(data['isAlphaSignificant'])}.")
        if type(data["hasAlphaDecay"]) is not bool:
            raise EvidenceValidationError(f"TYPE_ERROR: 'hasAlphaDecay' must be a boolean, got {type(data['hasAlphaDecay'])}.")
        if type(data["tradeCount"]) is not int:
            raise EvidenceValidationError(f"TYPE_ERROR: 'tradeCount' must be an integer, got {type(data['tradeCount'])}.")
        if type(data["dailyObservationCount"]) is not int:
            raise EvidenceValidationError(f"TYPE_ERROR: 'dailyObservationCount' must be an integer, got {type(data['dailyObservationCount'])}.")
        if type(data["predictionCount"]) is not int:
            raise EvidenceValidationError(f"TYPE_ERROR: 'predictionCount' must be an integer, got {type(data['predictionCount'])}.")

        return cls(
            tradeCount=data["tradeCount"],
            dailyObservationCount=data["dailyObservationCount"],
            predictionCount=data["predictionCount"],
            effectiveSampleSize=float(data["effectiveSampleSize"]),
            profitFactorStatus=str(data["profitFactorStatus"]),
            grossProfitFactor=float(data["grossProfitFactor"]) if data["grossProfitFactor"] is not None else None,
            netProfitFactor=float(data["netProfitFactor"]) if data["netProfitFactor"] is not None else None,
            netCagr=float(data["netCagr"]),
            sharpe=float(data["sharpe"]),
            sortino=float(data["sortino"]),
            maxDrawdown=float(data["maxDrawdown"]),
            turnoverAnnual=float(data["turnoverAnnual"]),
            totalCosts=float(data["totalCosts"]),
            totalGrossPnl=float(data["totalGrossPnl"]),
            totalNetPnl=float(data["totalNetPnl"]),
            pbo=float(data["pbo"]),
            dsr=float(data["dsr"]),
            isAlphaSignificant=data["isAlphaSignificant"],
            hasAlphaDecay=data["hasAlphaDecay"],
            partition=str(data["partition"]),
            status=str(data["status"]),
        )


def compute_deterministic_evidence_content_hash(lineage: ResearchLineage, evidence: ResearchEvidence) -> str:
    """
    Computes a deterministic SHA-256 hash over purely mathematical content
    with a strict numeric precision policy (6 decimal places).
    Excludes non-deterministic wall-clock timestamps and worker IDs.
    """
    ev_dict = evidence.to_dict()
    # Format floating point numbers to fixed 6 decimal precision
    normalized_evidence = {}
    for k, v in sorted(ev_dict.items()):
        if isinstance(v, float):
            normalized_evidence[k] = f"{v:.6f}"
        else:
            normalized_evidence[k] = v

    canonical_payload = {
        "lineage": {k: v.lower() for k, v in sorted(lineage.to_dict().items())},
        "evidence": normalized_evidence
    }
    canonical_json = json.dumps(canonical_payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()

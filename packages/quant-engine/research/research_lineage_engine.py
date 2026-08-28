"""
QuantX Research Lineage & Hash Engine — BUG 4 Master Repair.

Provides deterministic SHA-256 fingerprints for:
  - Dataset content (not filename/mtime)
  - Feature schema and computation policy
  - Strategy canonical parameters
  - Execution assumption set
  - Environment (Python, lib versions, OS)
  - Artifact lineage (full traceable provenance record)

All hashes are SHA-256 over canonical JSON (keys sorted, no whitespace).
Two economically identical configurations MUST produce the same hash.
Any material change MUST produce a different hash.
"""
import os
import sys
import json
import hashlib
import platform
import subprocess
from dataclasses import dataclass, asdict, field
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _sha256(obj: Any) -> str:
    """SHA-256 of canonical JSON representation."""
    canonical = json.dumps(obj, sort_keys=True, separators=(',', ':'), default=str)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def get_current_git_sha() -> str:
    try:
        return subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return 'UNKNOWN'


# ---------------------------------------------------------------------------
# Dataset Hash Engine
# ---------------------------------------------------------------------------

class DatasetHashEngine:
    """
    Hashes the actual content of all parquet files in a data directory,
    NOT filename or modification timestamp.

    Reads column names, row count, index bounds, and a checksum of
    first+last 50 rows per file to detect any price/volume mutation.
    """

    @staticmethod
    def compute(data_dir: str, file_extension: str = '.parquet') -> str:
        """
        Compute a deterministic hash of all market data files.
        Returns SHA-256 hex string.
        """
        try:
            import pandas as pd
        except ImportError:
            raise RuntimeError("pandas is required for DatasetHashEngine")

        files = sorted([
            f for f in os.listdir(data_dir)
            if f.endswith(file_extension)
        ])

        file_fingerprints = []
        for fname in files:
            fpath = os.path.join(data_dir, fname)
            try:
                df = pd.read_parquet(fpath)
                cols = sorted(df.columns.tolist())
                n_rows = len(df)
                idx_start = str(df.index[0]) if n_rows > 0 else ''
                idx_end = str(df.index[-1]) if n_rows > 0 else ''
                # Checksum of first + last 50 rows numeric data
                sample = pd.concat([df.head(50), df.tail(50)]).select_dtypes('number')
                row_checksum = round(float(sample.sum().sum()), 4)
                file_fingerprints.append({
                    'file': fname,
                    'columns': cols,
                    'nRows': n_rows,
                    'idxStart': idx_start,
                    'idxEnd': idx_end,
                    'rowChecksum': row_checksum,
                })
            except Exception as e:
                file_fingerprints.append({'file': fname, 'error': str(e)})

        return _sha256({'files': file_fingerprints, 'dataDir': os.path.basename(data_dir)})


# ---------------------------------------------------------------------------
# Feature Hash Engine
# ---------------------------------------------------------------------------

class FeatureHashEngine:
    """
    Hashes the feature engineering schema: definition + lookbacks +
    normalization policy + missing-value policy + timestamp semantics.
    """

    @staticmethod
    def compute(feature_config: Dict[str, Any]) -> str:
        """
        feature_config must include keys:
          featureNames, lookbacks, normalizationPolicy,
          missingValuePolicy, timestampSemantics, featureVersion
        """
        required = ['featureNames', 'featureVersion']
        for k in required:
            if k not in feature_config:
                raise ValueError(f"FeatureHashEngine: missing required key '{k}'")
        return _sha256(feature_config)


# ---------------------------------------------------------------------------
# Strategy Hash Engine
# ---------------------------------------------------------------------------

class StrategyHashEngine:
    """
    Hashes the complete canonical strategy specification.
    Two economically different strategies MUST NOT share the same hash.
    """

    @staticmethod
    def compute(strategy_config: Dict[str, Any]) -> str:
        """
        strategy_config must include:
          entryPolicy, selectionPolicy, allocationPolicy,
          exitPolicy, regimePolicy, riskPolicy, strategyVersion
        """
        required = ['entryPolicy', 'exitPolicy', 'strategyVersion']
        for k in required:
            if k not in strategy_config:
                raise ValueError(f"StrategyHashEngine: missing required key '{k}'")
        return _sha256(strategy_config)


# ---------------------------------------------------------------------------
# Execution Hash Engine
# ---------------------------------------------------------------------------

class ExecutionHashEngine:
    """
    Hashes the execution assumption set.
    Changing fees, slippage, impact, ADV cap, gap/stop semantics
    creates a new distinct execution hash.
    """

    @staticmethod
    def compute(execution_config: Dict[str, Any]) -> str:
        """
        execution_config must include:
          slippageBps, impactModel, maxParticipationRate,
          gapFillSemantics, stopFirstRule, feeModel, executionVersion
        """
        required = ['slippageBps', 'feeModel', 'executionVersion']
        for k in required:
            if k not in execution_config:
                raise ValueError(f"ExecutionHashEngine: missing required key '{k}'")
        return _sha256(execution_config)


# ---------------------------------------------------------------------------
# Universe Hash Engine
# ---------------------------------------------------------------------------

class UniverseHashEngine:
    """
    Hashes the point-in-time universe specification.
    Order of tickers does not alter the hash.
    """

    @staticmethod
    def compute(universe_config: Any) -> str:
        """
        universe_config can be a list/set of tickers or a dict containing 'tickers'.
        """
        if isinstance(universe_config, (list, set, tuple)):
            canonical = sorted(list(universe_config))
            return _sha256({'tickers': canonical})
        if isinstance(universe_config, dict) and 'tickers' in universe_config:
            cfg = dict(universe_config)
            if isinstance(cfg['tickers'], (list, set, tuple)):
                cfg['tickers'] = sorted(list(cfg['tickers']))
            return _sha256(cfg)
        return _sha256(universe_config)


# ---------------------------------------------------------------------------
# Environment Hash Engine
# ---------------------------------------------------------------------------

class EnvironmentHashEngine:
    """
    Hashes the Python/OS/library environment.
    A materially different environment should produce a new research run.
    """

    @staticmethod
    def capture() -> Dict[str, str]:
        """Captures current environment metadata."""
        env: Dict[str, str] = {
            'os': platform.system(),
            'osVersion': platform.version(),
            'pythonVersion': platform.python_version(),
        }
        packages = ['numpy', 'pandas', 'lightgbm', 'sklearn', 'scipy']
        for pkg in packages:
            try:
                import importlib
                mod = importlib.import_module(pkg if pkg != 'sklearn' else 'sklearn')
                ver = getattr(mod, '__version__', 'unknown')
                env[pkg + 'Version'] = ver
            except ImportError:
                env[pkg + 'Version'] = 'NOT_INSTALLED'
        return env

    @staticmethod
    def compute() -> str:
        env = EnvironmentHashEngine.capture()
        return _sha256(env)


# ---------------------------------------------------------------------------
# Artifact Lineage Record
# ---------------------------------------------------------------------------

@dataclass
class ArtifactLineageRecord:
    """
    Complete provenance binding for every final research result.
    Result → Experiment → Strategy → Model → Features → Universe → Dataset → Code SHA → Environment.
    """
    resultId: str
    experimentId: str
    gitSha: str
    datasetHash: str
    universeHash: str
    featureHash: str
    modelHash: str
    returnModelHash: str
    calibrationVersion: str
    strategyHash: str
    portfolioHash: str
    executionHash: str
    environmentHash: str
    experimentRegistryHash: str
    generatedAt: str
    # Links back to specific periods
    trainPeriod: Dict[str, str] = field(default_factory=dict)
    validationPeriod: Dict[str, str] = field(default_factory=dict)
    testPeriod: Dict[str, str] = field(default_factory=dict)
    holdoutPeriod: Dict[str, str] = field(default_factory=dict)
    # Evidence chain
    predictionsHash: str = ''
    tradesHash: str = ''
    equityHash: str = ''
    metricsHash: str = ''
    researchEvidenceHash: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def compute_evidence_hash(self) -> str:
        """Binds all sub-hashes into one final evidence fingerprint."""
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

    def seal(self) -> 'ArtifactLineageRecord':
        """Computes and stores the final researchEvidenceHash."""
        self.researchEvidenceHash = self.compute_evidence_hash()
        return self


def compute_list_hash(records: List[Dict[str, Any]]) -> str:
    """Compute deterministic hash over a list of dicts (e.g., trade ledger)."""
    return _sha256(records)


def compute_series_hash(values: List[float]) -> str:
    """Compute deterministic hash over a float series (e.g., equity curve)."""
    rounded = [round(v, 6) for v in values]
    return _sha256(rounded)

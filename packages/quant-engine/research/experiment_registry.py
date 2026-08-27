"""
QuantX Formal Experiment Registry & Parameter Hashing Engine.
Enforces pre-registration of all economic experiments, deterministic parameter hashing,
family-wise multiple-hypothesis tracking, and strict research immutability.
"""
import os
import json
import hashlib
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

def compute_parameter_hash(parameters: Dict[str, Any]) -> str:
    """
    Computes deterministic canonical SHA-256 fingerprint for any parameter set.
    Two strategy runs with identical parameters have identical hash;
    altering any economic parameter produces a distinct hash.
    """
    canonical_json = json.dumps(parameters, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()

@dataclass
class ExperimentRecord:
    experimentId: str
    parentExperimentId: Optional[str]
    createdAt: str
    gitSha: str
    datasetHash: str
    featureVersion: str
    modelVersion: str
    returnModelVersion: str
    strategyVersion: str
    parameterHash: str
    parameterSet: Dict[str, Any]
    strategyDefinition: Dict[str, Any]
    validationPeriod: Dict[str, str]
    candidateNumber: int
    totalCandidatesInFamily: int
    selectionMetric: str
    selectionMethod: str
    randomSeed: int
    family: str
    status: str
    selected: bool
    selectionReason: Optional[str]
    metrics: Optional[Dict[str, Any]] = None
    foldMetrics: Optional[List[Dict[str, Any]]] = None
    robustValidationScore: Optional[float] = None
    complexityPenalty: Optional[float] = None
    selectionMargin: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ExperimentRegistry:
    """
    Authoritative ledger of all strategy experiments, protecting QuantX
    against selective reporting, multiple-testing bias, and post-hoc manipulation.
    """
    DEFAULT_STORAGE_PATH = os.path.join(os.path.dirname(__file__), 'experiment_registry.json')

    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = storage_path or self.DEFAULT_STORAGE_PATH
        self.experiments: Dict[str, Dict[str, Any]] = {}
        self.load()

    def load(self) -> None:
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.experiments = data.get('experiments', {})
            except Exception:
                self.experiments = {}

    def save(self) -> None:
        payload = {
            'lastUpdated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'totalExperiments': len(self.experiments),
            'familyCandidateCounts': self.get_family_counts(),
            'experiments': self.experiments
        }
        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)

    def register_experiment(
        self,
        experiment_id: str,
        family: str,
        parameter_set: Dict[str, Any],
        strategy_definition: Dict[str, Any],
        candidate_number: int,
        total_candidates: int,
        parent_id: Optional[str] = None,
        git_sha: str = "1ec34fb",
        dataset_hash: str = "a65a2b18852442d6ae94ef8392fa9d8a73f3f95eb322ecc9e20a3040b2dae3d5",
        selection_metric: str = "ROBUST_VALIDATION_SCORE",
        selection_method: str = "OUT_OF_SAMPLE_CROSS_VALIDATION"
    ) -> ExperimentRecord:
        """Pre-registers an experiment before execution."""
        if experiment_id in self.experiments:
            rec = self.experiments[experiment_id]
            if rec.get('status') == 'COMPLETED':
                raise ValueError(
                    f"IMMUTABILITY_VIOLATION: Experiment '{experiment_id}' is completed and immutable. "
                    "Create a new experiment ID rather than overwriting."
                )

        param_hash = compute_parameter_hash(parameter_set)
        record = ExperimentRecord(
            experimentId=experiment_id,
            parentExperimentId=parent_id,
            createdAt=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            gitSha=git_sha,
            datasetHash=dataset_hash,
            featureVersion="5.0.0",
            modelVersion="5.0.0",
            returnModelVersion="v5.0.0-supervised-quantile",
            strategyVersion=f"v7.0.0-{family.lower()}-{candidate_number}",
            parameterHash=param_hash,
            parameterSet=parameter_set,
            strategyDefinition=strategy_definition,
            validationPeriod={"start": "2023-07-04", "end": "2024-01-24"},
            candidateNumber=candidate_number,
            totalCandidatesInFamily=total_candidates,
            selectionMetric=selection_metric,
            selectionMethod=selection_method,
            randomSeed=42,
            family=family.upper(),
            status="REGISTERED",
            selected=False,
            selectionReason=None
        )
        self.experiments[experiment_id] = record.to_dict()
        self.save()
        return record

    def complete_experiment(
        self,
        experiment_id: str,
        metrics: Dict[str, Any],
        fold_metrics: Optional[List[Dict[str, Any]]] = None,
        robust_score: Optional[float] = None,
        complexity_penalty: Optional[float] = None
    ) -> None:
        """Records finalized results for an experiment. Enforces immutability thereafter."""
        if experiment_id not in self.experiments:
            raise KeyError(f"Experiment '{experiment_id}' must be pre-registered before completion.")

        rec = self.experiments[experiment_id]
        if rec.get('status') == 'COMPLETED':
            raise ValueError(f"IMMUTABILITY_VIOLATION: Experiment '{experiment_id}' has already finalized results!")

        rec['metrics'] = metrics
        rec['foldMetrics'] = fold_metrics or []
        rec['robustValidationScore'] = robust_score
        rec['complexityPenalty'] = complexity_penalty
        rec['status'] = 'COMPLETED'
        rec['completedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        self.save()

    def mark_selected(self, winner_id: str, runner_up_id: Optional[str] = None, selection_margin: Optional[float] = None, reason: str = "HIGHEST_ROBUST_VALIDATION_SCORE") -> None:
        """Marks winning candidate in registry with runner-up audit margin."""
        if winner_id not in self.experiments:
            raise KeyError(f"Winner '{winner_id}' not found in registry.")

        self.experiments[winner_id]['selected'] = True
        self.experiments[winner_id]['selectionReason'] = reason
        self.experiments[winner_id]['selectionMargin'] = selection_margin
        self.experiments[winner_id]['runnerUpId'] = runner_up_id
        self.save()

    def get_family_counts(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for exp in self.experiments.values():
            fam = exp.get('family', 'UNKNOWN')
            counts[fam] = counts.get(fam, 0) + 1
        return counts

    def get_cumulative_search_footprint(self) -> Dict[str, int]:
        return {
            'totalStrategiesTested': len(self.experiments),
            'totalParametersTested': sum(len(e.get('parameterSet', {})) for e in self.experiments.values()),
            'familyCandidateCounts': self.get_family_counts()
        }

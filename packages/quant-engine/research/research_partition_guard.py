"""
QuantX Research Partition Guard & Holdout Absolute Lock.
Enforces strict boundary isolation between TRAIN, VALIDATION, TEST, and HOLDOUT partitions.
Prevents parameter search, threshold tuning, and strategy selection on unseen partitions.
"""
from typing import Optional, Set
import threading

class OptimizationLeakageError(Exception):
    """Raised when optimization, hyperparameter tuning, or candidate selection is attempted on TEST or HOLDOUT."""
    pass

class HoldoutMutationError(Exception):
    """Raised when any strategy parameter, feature schema, or model state is mutated after HOLDOUT has begun."""
    pass

class TestSelectionLockError(Exception):
    """Raised when multiple candidate strategies are evaluated on TEST to pick a winner."""
    __test__ = False
    pass


class ResearchPartitionGuard:
    """
    Authoritative code-level guard preventing research selection leakage
    and data snooping across model/strategy evaluation partitions.
    """
    _holdout_active: bool = False
    _evaluated_test_experiments: Set[str] = set()
    _lock = threading.Lock()

    @classmethod
    def enforce_partition(cls, partition: Optional[str], operation_name: str = "Optimization") -> None:
        """
        Guarantees that optimization, parameter tuning, threshold search,
        feature selection, holding-period selection, or strategy selection
        is NEVER executed on TEST or HOLDOUT partitions.
        """
        if partition is not None:
            p_upper = str(partition).upper().strip()
            if p_upper in ['TEST', 'HOLDOUT']:
                raise OptimizationLeakageError(
                    f"CRITICAL RESEARCH LEAKAGE: {operation_name} is strictly forbidden on {p_upper} partition!"
                )

    @classmethod
    def activate_holdout(cls) -> None:
        """Locks the system into immutable HOLDOUT execution state."""
        with cls._lock:
            cls._holdout_active = True

    @classmethod
    def release_holdout(cls) -> None:
        """Releases the HOLDOUT lock (for test harness cleanup)."""
        with cls._lock:
            cls._holdout_active = False

    @classmethod
    def is_holdout_active(cls) -> bool:
        with cls._lock:
            return cls._holdout_active

    @classmethod
    def assert_not_in_holdout(cls, operation_name: str = "Parameter modification") -> None:
        """
        Verifies that no strategy parameter, model state, or configuration
        is being altered once HOLDOUT evaluation has begun.
        """
        with cls._lock:
            if cls._holdout_active:
                raise HoldoutMutationError(
                    f"CRITICAL HOLDOUT LOCK VIOLATION: {operation_name} is strictly prohibited after HOLDOUT has begun!"
                )

    @classmethod
    def record_test_run(cls, experiment_id: str) -> None:
        """Records that an experiment has executed its single allowed TEST evaluation."""
        with cls._lock:
            cls._evaluated_test_experiments.add(experiment_id)

    @classmethod
    def assert_test_not_repeated(cls, experiment_id: str) -> None:
        """Prevents repeated optimization / re-selection on TEST."""
        with cls._lock:
            if experiment_id in cls._evaluated_test_experiments:
                raise TestSelectionLockError(
                    f"CRITICAL TEST SELECTION LOCK: Experiment '{experiment_id}' has already been evaluated on TEST. "
                    "Cannot re-tune or re-select. A new research cycle must be created."
                )

    @classmethod
    def reset_locks(cls) -> None:
        """Harness reset for isolated regression testing."""
        with cls._lock:
            cls._holdout_active = False
            cls._evaluated_test_experiments.clear()

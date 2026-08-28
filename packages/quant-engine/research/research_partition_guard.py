"""
QuantX Research Partition Guard — BUG 4 Full Upgrade.

Enforces strict boundary isolation between TRAIN, VALIDATION, TEST, and HOLDOUT.
Prevents optimization, selection, tuning, calibration, and parameter search on
unseen evaluation partitions.

BUG 4 Additions:
  - OperationType enum with 10 operation classes
  - BenchmarkMutationError, PeriodMutationError, CostAssumptionMutationError
  - LabelTimestampViolationError, CalibrationLeakageError
  - enforce_partition now enforces per operation type
  - Benchmark and period immutability registry
"""
from typing import Optional, Set, Dict
from enum import Enum
import threading


# ---------------------------------------------------------------------------
# Error Types
# ---------------------------------------------------------------------------

class OptimizationLeakageError(Exception):
    """Raised when optimization, tuning, or selection is attempted on TEST or HOLDOUT."""
    pass


class HoldoutMutationError(Exception):
    """Raised when model, strategy, or config is mutated after HOLDOUT has begun."""
    pass


class TestSelectionLockError(Exception):
    """Raised when multiple candidates are evaluated on TEST to pick a winner."""
    __test__ = False
    pass


class BenchmarkMutationError(Exception):
    """Raised when benchmark definition changes after evaluation begins."""
    pass


class PeriodMutationError(Exception):
    """Raised when TEST or HOLDOUT period boundaries change after registration."""
    pass


class CostAssumptionMutationError(Exception):
    """Raised when cost/execution assumptions change after TEST evaluation begins."""
    pass


class LabelTimestampViolationError(Exception):
    """Raised when predictionTimestamp >= entryTimestamp (non-causal label)."""
    pass


class CalibrationLeakageError(Exception):
    """Raised when calibrator quality is evaluated on its own fitting sample."""
    pass


class RegistryDeleteError(Exception):
    """Raised when attempt is made to delete a completed experiment record."""
    pass


# ---------------------------------------------------------------------------
# Operation Types
# ---------------------------------------------------------------------------

class OperationType(Enum):
    FIT = 'FIT'
    OPTIMIZE = 'OPTIMIZE'
    SELECT = 'SELECT'
    TUNE = 'TUNE'
    CALIBRATE = 'CALIBRATE'
    THRESHOLD_SEARCH = 'THRESHOLD_SEARCH'
    FEATURE_SELECT = 'FEATURE_SELECT'
    STRATEGY_SELECT = 'STRATEGY_SELECT'
    PORTFOLIO_SELECT = 'PORTFOLIO_SELECT'
    REGIME_SELECT = 'REGIME_SELECT'
    EVALUATE = 'EVALUATE'   # allowed on all partitions (read-only)


# Operations that require at least TRAIN or VALIDATION partition
_SELECTION_OPERATIONS = {
    OperationType.OPTIMIZE,
    OperationType.SELECT,
    OperationType.TUNE,
    OperationType.CALIBRATE,
    OperationType.THRESHOLD_SEARCH,
    OperationType.FEATURE_SELECT,
    OperationType.STRATEGY_SELECT,
    OperationType.PORTFOLIO_SELECT,
    OperationType.REGIME_SELECT,
}

# Any mutation/fit on HOLDOUT is forbidden
_FORBIDDEN_ON_HOLDOUT = _SELECTION_OPERATIONS | {OperationType.FIT}


class Partition(str, Enum):
    TRAIN = 'TRAIN'
    VALIDATION = 'VALIDATION'
    TEST = 'TEST'
    HOLDOUT = 'HOLDOUT'


# ---------------------------------------------------------------------------
# Main Guard
# ---------------------------------------------------------------------------

class ResearchPartitionGuard:
    """
    Authoritative code-level guard preventing research selection leakage
    and data snooping across model/strategy evaluation partitions.

    Thread-safe. Class-level state for process-wide enforcement.
    """
    _holdout_active: bool = False
    _evaluated_test_experiments: Set[str] = set()
    _registered_benchmarks: Dict[str, str] = {}         # name -> hash
    _registered_periods: Dict[str, Dict[str, str]] = {} # name -> {start, end}
    _registered_cost_hash: Optional[str] = None
    _cost_frozen: bool = False
    _lock = threading.Lock()

    # ------------------------------------------------------------------
    # Partition Enforcement (Core BUG 4 operation-type enforcement)
    # ------------------------------------------------------------------

    @classmethod
    def enforce_partition(
        cls,
        partition: Optional[str],
        operation_type: OperationType = OperationType.OPTIMIZE,
        operation_name: str = 'Operation'
    ) -> bool:
        """
        Guarantees that selection/optimization operations are NEVER
        executed on TEST or HOLDOUT partitions.

        - Selection or FIT on TEST  → OptimizationLeakageError
        - Any mutation on HOLDOUT → HoldoutMutationError (if active)
        - FIT on HOLDOUT → HoldoutMutationError
        """
        if partition is None:
            return True
        p_str = partition.value if hasattr(partition, 'value') else str(partition)
        p_upper = p_str.upper().strip()

        if p_upper == 'HOLDOUT':
            if operation_type in _FORBIDDEN_ON_HOLDOUT:
                raise HoldoutMutationError(
                    f"HOLDOUT VIOLATION: {operation_type.value} '{operation_name}' is strictly "
                    "forbidden on HOLDOUT partition. HOLDOUT is immutable once activated."
                )
            return True  # EVALUATE is allowed on HOLDOUT

        if p_upper == 'TEST':
            if operation_type in _SELECTION_OPERATIONS or operation_type == OperationType.FIT:
                raise OptimizationLeakageError(
                    f"CRITICAL RESEARCH LEAKAGE: {operation_type.value} '{operation_name}' is "
                    "strictly forbidden on TEST partition. Selection must be done on VALIDATION only."
                )
        return True

    # ------------------------------------------------------------------
    # Holdout Lock
    # ------------------------------------------------------------------

    @classmethod
    def activate_holdout(cls) -> None:
        """Locks the system into immutable HOLDOUT execution state."""
        with cls._lock:
            cls._holdout_active = True

    @classmethod
    def release_holdout(cls) -> None:
        """Releases the HOLDOUT lock (for test harness cleanup only)."""
        with cls._lock:
            cls._holdout_active = False

    @classmethod
    def is_holdout_active(cls) -> bool:
        with cls._lock:
            return cls._holdout_active

    @classmethod
    def assert_not_in_holdout(cls, operation_name: str = 'Parameter modification') -> None:
        """Verifies no state is being mutated after HOLDOUT has begun."""
        with cls._lock:
            if cls._holdout_active:
                raise HoldoutMutationError(
                    f"HOLDOUT LOCK VIOLATION: '{operation_name}' is prohibited after HOLDOUT has begun!"
                )

    # ------------------------------------------------------------------
    # Test Experiment Lock
    # ------------------------------------------------------------------

    @classmethod
    def record_test_run(cls, experiment_id: str) -> None:
        """Records that an experiment has executed its single allowed TEST evaluation."""
        with cls._lock:
            cls._evaluated_test_experiments.add(experiment_id)

    @classmethod
    def assert_test_not_repeated(cls, experiment_id: str) -> None:
        """Prevents repeated evaluation/optimization on TEST."""
        with cls._lock:
            if experiment_id in cls._evaluated_test_experiments:
                raise TestSelectionLockError(
                    f"TEST SELECTION LOCK: Experiment '{experiment_id}' has already been evaluated "
                    "on TEST. Cannot re-tune or re-select. Create a new research cycle."
                )

    # ------------------------------------------------------------------
    # Benchmark Immutability
    # ------------------------------------------------------------------

    @classmethod
    def register_benchmark(cls, name: str, benchmark_hash: str) -> None:
        """Register a benchmark definition before evaluation begins."""
        with cls._lock:
            if name in cls._registered_benchmarks:
                if cls._registered_benchmarks[name] != benchmark_hash:
                    raise BenchmarkMutationError(
                        f"BENCHMARK MUTATION: Benchmark '{name}' was changed after registration. "
                        "Original hash does not match. This is a research integrity violation."
                    )
            cls._registered_benchmarks[name] = benchmark_hash

    @classmethod
    def assert_benchmark_unchanged(cls, name: str, current_hash: str) -> None:
        """Asserts benchmark has not been changed since registration."""
        with cls._lock:
            if name in cls._registered_benchmarks:
                if cls._registered_benchmarks[name] != current_hash:
                    raise BenchmarkMutationError(
                        f"BENCHMARK MUTATION DETECTED: '{name}' benchmark definition changed "
                        "after initial registration. Research integrity violation."
                    )

    # ------------------------------------------------------------------
    # Period Immutability
    # ------------------------------------------------------------------

    @classmethod
    def register_period(cls, partition_name: str, start: str, end: str) -> None:
        """Register evaluation period boundaries. Once set, cannot change."""
        with cls._lock:
            if partition_name in cls._registered_periods:
                reg = cls._registered_periods[partition_name]
                if reg['start'] != start or reg['end'] != end:
                    raise PeriodMutationError(
                        f"PERIOD MUTATION: '{partition_name}' period boundaries changed after "
                        f"registration ({reg['start']}-{reg['end']} → {start}-{end}). "
                        "Changing evaluation windows creates a new experiment."
                    )
            cls._registered_periods[partition_name] = {'start': start, 'end': end}

    # ------------------------------------------------------------------
    # Cost Assumption Immutability
    # ------------------------------------------------------------------

    @classmethod
    def freeze_cost_assumptions(cls, cost_hash: str) -> None:
        """Freeze cost/execution assumptions after TEST evaluation begins."""
        with cls._lock:
            if cls._cost_frozen and cls._registered_cost_hash != cost_hash:
                raise CostAssumptionMutationError(
                    "COST ASSUMPTION MUTATION: Cost model changed after TEST evaluation began. "
                    "Any new cost model requires a new experiment."
                )
            cls._registered_cost_hash = cost_hash
            cls._cost_frozen = True

    @classmethod
    def assert_cost_unchanged(cls, current_cost_hash: str) -> None:
        """Assert cost assumptions have not changed since freezing."""
        with cls._lock:
            if cls._cost_frozen and cls._registered_cost_hash != current_cost_hash:
                raise CostAssumptionMutationError(
                    "COST ASSUMPTION MUTATION DETECTED after freeze. New experiment required."
                )

    # ------------------------------------------------------------------
    # Harness Reset
    # ------------------------------------------------------------------

    @classmethod
    def reset_locks(cls) -> None:
        """Full reset for isolated regression testing."""
        with cls._lock:
            cls._holdout_active = False
            cls._evaluated_test_experiments.clear()
            cls._registered_benchmarks.clear()
            cls._registered_periods.clear()
            cls._registered_cost_hash = None
            cls._cost_frozen = False

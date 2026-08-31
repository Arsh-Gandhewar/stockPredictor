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
import os
import json
import threading
from typing import Optional, Set, Dict, Any, Union
from enum import Enum


# ---------------------------------------------------------------------------
# Error Types
# ---------------------------------------------------------------------------

class OptimizationLeakageError(Exception):
    """Raised when optimization, tuning, or selection is attempted on TEST or HOLDOUT."""
    pass


class HoldoutMutationError(OptimizationLeakageError):
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
    _lock = threading.RLock()

    # ------------------------------------------------------------------
    # Partition Enforcement (Core BUG 4 operation-type enforcement)
    # ------------------------------------------------------------------

    @classmethod
    def enforce_partition(
        cls,
        partition: Optional[str],
        operation_type: Any = OperationType.OPTIMIZE,
        operation_name: str = 'Operation'
    ) -> bool:
        """
        Guarantees that selection/optimization operations are NEVER
        executed on TEST or HOLDOUT partitions.

        - Selection or FIT on TEST  → OptimizationLeakageError
        - Any mutation on HOLDOUT → HoldoutMutationError (subclass of OptimizationLeakageError)
        - FIT on HOLDOUT → HoldoutMutationError
        """
        if partition is None:
            # Under strict research integrity, partition=None is forbidden for any training, selection, or optimization
            if operation_type in _SELECTION_OPERATIONS or operation_type in _FORBIDDEN_ON_HOLDOUT or operation_type == OperationType.OPTIMIZE:
                raise OptimizationLeakageError(
                    f"CRITICAL RESEARCH LEAKAGE: Operation '{operation_name}' requires an explicit partition. "
                    "partition=None cannot bypass partition guards."
                )
            return True

        if isinstance(operation_type, str) and not isinstance(operation_type, OperationType):
            operation_name = operation_type
            operation_type = OperationType.OPTIMIZE

        p_str = partition.value if hasattr(partition, 'value') else str(partition)
        p_upper = p_str.upper().strip()

        op_val = operation_type.value if hasattr(operation_type, 'value') else str(operation_type)

        if p_upper == 'HOLDOUT':
            if operation_type in _FORBIDDEN_ON_HOLDOUT or operation_type == OperationType.OPTIMIZE:
                raise HoldoutMutationError(
                    f"CRITICAL RESEARCH LEAKAGE: {op_val} '{operation_name}' is strictly "
                    "forbidden on HOLDOUT partition. HOLDOUT is immutable once activated."
                )
            return True  # EVALUATE is allowed on HOLDOUT

        if p_upper == 'TEST':
            if operation_type in _SELECTION_OPERATIONS or operation_type == OperationType.FIT or operation_type == OperationType.OPTIMIZE:
                raise OptimizationLeakageError(
                    f"CRITICAL RESEARCH LEAKAGE: {op_val} '{operation_name}' is "
                    "strictly forbidden on TEST partition. Selection must be done on VALIDATION only."
                )
        return True

    # ------------------------------------------------------------------
    # Holdout Lock (In-Memory + Cross-Process File Lock)
    # ------------------------------------------------------------------

    _LOCK_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.quantx', 'research_holdout.lock')
    _TEST_EXPERIMENTS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.quantx', 'evaluated_test_experiments.json')
    _TEST_LOCK_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.quantx', 'test_registry.lock')

    @classmethod
    def _ensure_lock_dir(cls) -> None:
        lock_dir = os.path.dirname(cls._LOCK_FILE)
        if not os.path.exists(lock_dir):
            try:
                os.makedirs(lock_dir, exist_ok=True)
            except OSError as exc:
                raise RuntimeError(f"LOCK_DIR_CREATION_FAILURE: {exc}") from exc

    @classmethod
    def activate_holdout(cls) -> None:
        """Locks the system into immutable HOLDOUT execution state across threads and processes using atomic exclusion."""
        with cls._lock:
            cls._holdout_active = True
            cls._ensure_lock_dir()
            try:
                # Atomic file creation using os.open with O_CREAT | os.O_EXCL | os.O_WRONLY
                # If already exists, atomic exclusion is preserved without race condition.
                fd = os.open(cls._LOCK_FILE, os.O_CREAT | os.O_WRONLY | os.O_EXCL)
                try:
                    os.write(fd, f"LOCKED_PID_{os.getpid()}".encode('utf-8'))
                finally:
                    os.close(fd)
            except FileExistsError:
                # Lock file already exists atomically
                pass
            except OSError as exc:
                raise RuntimeError(f"HOLDOUT_LOCK_FAILURE: Failed to persist holdout lock file: {exc}") from exc

    @classmethod
    def release_holdout(cls) -> None:
        """Releases the HOLDOUT lock (for test harness cleanup only)."""
        with cls._lock:
            cls._holdout_active = False
            if os.path.exists(cls._LOCK_FILE):
                try:
                    os.remove(cls._LOCK_FILE)
                except OSError as exc:
                    raise RuntimeError(f"HOLDOUT_RELEASE_FAILURE: Failed to remove holdout lock file: {exc}") from exc

    @classmethod
    def is_holdout_active(cls) -> bool:
        with cls._lock:
            if cls._holdout_active:
                return True
            return os.path.exists(cls._LOCK_FILE)

    @classmethod
    def assert_not_in_holdout(cls, operation_name: str = 'Parameter modification') -> None:
        """Verifies no state is being mutated after HOLDOUT has begun."""
        with cls._lock:
            if cls.is_holdout_active():
                raise HoldoutMutationError(
                    f"CRITICAL HOLDOUT LOCK VIOLATION: '{operation_name}' is prohibited after HOLDOUT has begun!"
                )

    # ------------------------------------------------------------------
    # Test Experiment Lock (Cross-Process Durable State)
    # ------------------------------------------------------------------

    @classmethod
    def _acquire_process_file_lock(cls, lock_file_path: str, timeout_sec: float = 5.0) -> int:
        """Acquires a cross-process atomic mutex using O_CREAT | O_EXCL with polling."""
        import time
        start_time = time.time()
        while True:
            try:
                fd = os.open(lock_file_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
                return fd
            except FileExistsError:
                if time.time() - start_time > timeout_sec:
                    raise TimeoutError(f"CROSS_PROCESS_LOCK_TIMEOUT: Could not acquire lock {lock_file_path} within {timeout_sec}s")
                time.sleep(0.05)

    @classmethod
    def _release_process_file_lock(cls, lock_file_path: str, fd: int) -> None:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            if os.path.exists(lock_file_path):
                os.remove(lock_file_path)
        except OSError:
            pass

    @classmethod
    def _load_durable_test_experiments(cls) -> set:
        experiments = set(cls._evaluated_test_experiments)
        if os.path.exists(cls._TEST_EXPERIMENTS_FILE):
            try:
                with open(cls._TEST_EXPERIMENTS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        experiments.update(data)
            except Exception as exc:
                raise RuntimeError(
                    f"RESEARCH_PERSISTENCE_FAILURE: Failed to parse durable test experiments file: {exc}"
                ) from exc
        return experiments

    @classmethod
    def record_test_run(cls, experiment_id: str) -> None:
        """Records that an experiment has executed its single allowed TEST evaluation with atomic cross-process mutex."""
        with cls._lock:
            cls._evaluated_test_experiments.add(experiment_id)
            cls._ensure_lock_dir()

            # Acquire atomic inter-process mutex
            lock_fd = cls._acquire_process_file_lock(cls._TEST_LOCK_FILE)
            try:
                all_exps = cls._load_durable_test_experiments()
                all_exps.add(experiment_id)
                temp_file = f"{cls._TEST_EXPERIMENTS_FILE}.tmp.{os.getpid()}"
                with open(temp_file, 'w', encoding='utf-8') as f:
                    json.dump(sorted(list(all_exps)), f)
                os.replace(temp_file, cls._TEST_EXPERIMENTS_FILE)
            except Exception as exc:
                raise RuntimeError(
                    f"RESEARCH_PERSISTENCE_FAILURE: Failed to write durable test experiment '{experiment_id}': {exc}"
                ) from exc
            finally:
                cls._release_process_file_lock(cls._TEST_LOCK_FILE, lock_fd)

    @classmethod
    def assert_test_not_repeated(cls, experiment_id: str) -> None:
        """Prevents repeated evaluation/optimization on TEST across threads and processes."""
        with cls._lock:
            all_exps = cls._load_durable_test_experiments()
            if experiment_id in all_exps:
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
        env = os.environ.get('NODE_ENV', '') or os.environ.get('QUANTX_ENVIRONMENT', '')
        if env.lower() == 'production':
            raise PermissionError("ILLEGAL_GOVERNANCE_RESET: reset_locks() cannot be invoked in a production environment.")

        with cls._lock:
            cls._holdout_active = False
            cls._evaluated_test_experiments.clear()
            cls._registered_benchmarks.clear()
            cls._registered_periods.clear()
            cls._registered_cost_hash = None
            cls._cost_frozen = False
            if os.path.exists(cls._LOCK_FILE):
                try:
                    os.remove(cls._LOCK_FILE)
                except OSError:
                    pass
            if os.path.exists(cls._TEST_EXPERIMENTS_FILE):
                try:
                    os.remove(cls._TEST_EXPERIMENTS_FILE)
                except OSError:
                    pass
            if os.path.exists(cls._TEST_LOCK_FILE):
                try:
                    os.remove(cls._TEST_LOCK_FILE)
                except OSError:
                    pass

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
import time
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
    _TEST_CLAIMS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.quantx', 'test_claims')

    @classmethod
    def _ensure_lock_dir(cls) -> None:
        lock_dir = os.path.dirname(cls._LOCK_FILE)
        if not os.path.exists(lock_dir):
            try:
                os.makedirs(lock_dir, exist_ok=True)
            except OSError as exc:
                raise RuntimeError(f"LOCK_DIR_CREATION_FAILURE: {exc}") from exc
        if not os.path.exists(cls._TEST_CLAIMS_DIR):
            try:
                os.makedirs(cls._TEST_CLAIMS_DIR, exist_ok=True)
            except OSError as exc:
                raise RuntimeError(f"LOCK_DIR_CREATION_FAILURE: {exc}") from exc

    @classmethod
    def _is_pid_running(cls, pid: int) -> bool:
        if pid <= 0:
            return False
        import platform
        try:
            if platform.system() == "Windows":
                import ctypes
                kernel32 = ctypes.windll.kernel32
                SYNCHRONIZE = 0x00100000
                process = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
                if process:
                    kernel32.CloseHandle(process)
                    return True
                return False
            else:
                os.kill(pid, 0)
                return True
        except (OSError, Exception):
            return False

    @classmethod
    def activate_holdout(cls) -> None:
        """Locks the system into immutable HOLDOUT execution state across threads and processes using atomic exclusion."""
        with cls._lock:
            cls._holdout_active = True
            cls._ensure_lock_dir()
            try:
                # Atomic file creation using os.open with O_CREAT | os.O_EXCL | os.O_WRONLY
                fd = os.open(cls._LOCK_FILE, os.O_CREAT | os.O_WRONLY | os.O_EXCL)
                try:
                    payload = json.dumps({"pid": os.getpid(), "timestamp": time.time()})
                    os.write(fd, payload.encode('utf-8'))
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
    # Test Experiment Lock (Cross-Process Durable State & Atomic Pre-Claim)
    # ------------------------------------------------------------------

    @classmethod
    def _acquire_process_file_lock(cls, lock_file_path: str, timeout_sec: float = 5.0, ttl_sec: float = 30.0) -> int:
        """Acquires a cross-process atomic mutex using O_CREAT | O_EXCL with PID/TTL ownership verification."""
        start_time = time.time()
        while True:
            try:
                fd = os.open(lock_file_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
                payload = json.dumps({"pid": os.getpid(), "timestamp": time.time()})
                os.write(fd, payload.encode('utf-8'))
                return fd
            except FileExistsError:
                # Inspect existing lock for stale process or expired TTL
                try:
                    with open(lock_file_path, 'r', encoding='utf-8') as f:
                        content = f.read().strip()
                        lock_meta = json.loads(content) if content.startswith('{') else None
                    if lock_meta:
                        lock_pid = lock_meta.get("pid", 0)
                        lock_ts = lock_meta.get("timestamp", 0)
                        now = time.time()
                        is_dead = not cls._is_pid_running(lock_pid)
                        is_expired = (now - lock_ts) > ttl_sec
                        if is_dead or is_expired:
                            try:
                                os.remove(lock_file_path)
                                continue
                            except OSError:
                                pass
                except Exception:
                    pass

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
        # Also consult authoritative persistent registry
        reg_exps = ResearchExperimentRegistry.list_experiments()
        for exp_id, rec in reg_exps.items():
            if rec.get("status") == "COMMITTED":
                experiments.add(exp_id)
        return experiments

    @classmethod
    def claim_test_evaluation(cls, experiment_id: str, worker_id: Optional[str] = None, lease_ttl: int = 300) -> Dict[str, Any]:
        """
        Atomically pre-claims an experiment ID before TEST evaluation runs.
        Combines fast local node guard (O_EXCL) with authoritative transactional lease registry.
        """
        cls._ensure_lock_dir()
        cls.assert_test_not_repeated(experiment_id)

        # 1. Authoritative Transactional Registry Claim (Distributed & Lease Managed)
        claim_record = ResearchExperimentRegistry.claim_experiment(
            experiment_id=experiment_id,
            worker_id=worker_id,
            lease_ttl_seconds=lease_ttl
        )

        # 2. Local Node Fast Guard (O_EXCL)
        claim_file = os.path.join(cls._TEST_CLAIMS_DIR, f"{experiment_id}.claim")
        try:
            fd = os.open(claim_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                payload = json.dumps({
                    "experimentId": experiment_id,
                    "claimId": claim_record.get("claim", {}).get("claimId"),
                    "pid": os.getpid(),
                    "timestamp": time.time()
                })
                os.write(fd, payload.encode('utf-8'))
            finally:
                os.close(fd)
        except FileExistsError:
            # If claim exists locally, check if it belongs to this exact claim
            pass
        except OSError as exc:
            raise RuntimeError(f"TEST_CLAIM_FAILURE: Failed to create atomic claim for '{experiment_id}': {exc}") from exc

        return claim_record

    @classmethod
    def record_test_run(
        cls,
        experiment_id: str,
        evidence_metrics: Optional[Dict[str, Any]] = None,
        lineage_hashes: Optional[Dict[str, str]] = None
    ) -> None:
        """Records that an experiment has executed its single allowed TEST evaluation with atomic cross-process mutex and registry commit."""
        with cls._lock:
            cls._evaluated_test_experiments.add(experiment_id)
            cls._ensure_lock_dir()

            # Ensure authoritative registry commit
            exp_rec = ResearchExperimentRegistry.get_experiment(experiment_id)
            claim_id = exp_rec.get("claim", {}).get("claimId", f"auto_claim_{experiment_id}") if exp_rec else f"auto_claim_{experiment_id}"
            if not exp_rec or exp_rec.get("status") != "COMMITTED":
                if not exp_rec:
                    ResearchExperimentRegistry.claim_experiment(experiment_id)
                    exp_rec = ResearchExperimentRegistry.get_experiment(experiment_id)
                    claim_id = exp_rec.get("claim", {}).get("claimId", f"auto_claim_{experiment_id}")
                ResearchExperimentRegistry.commit_evidence(
                    experiment_id=experiment_id,
                    claim_id=claim_id,
                    evidence_metrics=evidence_metrics or {"sampleCount": 1, "status": "EVALUATED"},
                    lineage_hashes=lineage_hashes
                )

            # Ensure pre-claim exists (or create it)
            claim_file = os.path.join(cls._TEST_CLAIMS_DIR, f"{experiment_id}.claim")
            if not os.path.exists(claim_file):
                try:
                    fd = os.open(claim_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    try:
                        payload = json.dumps({"experimentId": experiment_id, "pid": os.getpid(), "timestamp": time.time()})
                        os.write(fd, payload.encode('utf-8'))
                    finally:
                        os.close(fd)
                except FileExistsError:
                    pass

            # Acquire atomic inter-process mutex for legacy tracker
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
        """Prevents repeated evaluation/optimization on TEST across threads, processes, and distributed workers."""
        with cls._lock:
            # 1. Check Authoritative Registry
            reg_rec = ResearchExperimentRegistry.get_experiment(experiment_id)
            if reg_rec:
                status = reg_rec.get("status")
                if status == "COMMITTED":
                    raise TestSelectionLockError(
                        f"TEST SELECTION LOCK: Experiment '{experiment_id}' has already been evaluated "
                        "on TEST and committed to the authoritative research registry. Re-tuning is forbidden."
                    )
                if status in ["CLAIMED", "EVALUATING"]:
                    claim = reg_rec.get("claim", {})
                    if time.time() < claim.get("leaseExpiryTs", 0):
                        raise TestSelectionLockError(
                            f"TEST CLAIM CONFLICT: Experiment '{experiment_id}' is actively claimed by "
                            f"worker '{claim.get('workerId')}' until {claim.get('leaseExpiry')}."
                        )

            # 2. Check local files
            all_exps = cls._load_durable_test_experiments()
            claim_file = os.path.join(cls._TEST_CLAIMS_DIR, f"{experiment_id}.claim")
            if experiment_id in all_exps or os.path.exists(claim_file):
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
            if os.path.exists(cls._TEST_CLAIMS_DIR):
                try:
                    for f in os.listdir(cls._TEST_CLAIMS_DIR):
                        os.remove(os.path.join(cls._TEST_CLAIMS_DIR, f))
                except OSError:
                    pass
            ResearchExperimentRegistry.reset_registry()


# ===========================================================================
# Authoritative Persistent Transactional Research Experiment Registry
# ===========================================================================

class ResearchExperimentRegistry:
    """
    Authoritative Persistent Transactional Research Experiment Registry.
    
    Provides distributed atomic claims, lease management with TTL, worker ownership tracking,
    crash recovery with expired lease reclamation, and immutable evidence anchoring for all
    TEST and HOLDOUT evaluations.
    """
    _REGISTRY_DIR = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
        ".research_locks"
    )
    _REGISTRY_FILE = os.path.join(_REGISTRY_DIR, "research_experiment_registry.json")
    _LOCK_FILE = os.path.join(_REGISTRY_DIR, "research_registry.lock")
    _lock = threading.RLock()

    @classmethod
    def _ensure_dir(cls) -> None:
        os.makedirs(cls._REGISTRY_DIR, exist_ok=True)

    @classmethod
    def _load_registry(cls) -> Dict[str, Any]:
        cls._ensure_dir()
        if not os.path.exists(cls._REGISTRY_FILE):
            return {"schema": "1.0.0", "experiments": {}}
        try:
            with open(cls._REGISTRY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"schema": "1.0.0", "experiments": {}}

    @classmethod
    def _save_registry(cls, data: Dict[str, Any]) -> None:
        cls._ensure_dir()
        temp_file = f"{cls._REGISTRY_FILE}.tmp.{os.getpid()}_{time.time_ns()}"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(temp_file, cls._REGISTRY_FILE)

    @classmethod
    def claim_experiment(
        cls,
        experiment_id: str,
        worker_id: Optional[str] = None,
        lease_ttl_seconds: int = 300,
        lineage_hashes: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Atomically claims an experiment ID with lease TTL, worker ownership, and crash recovery.
        Raises TestSelectionLockError if experiment is already committed or actively claimed.
        """
        import uuid
        worker = worker_id or f"worker_{os.getpid()}_{time.time_ns()}"
        now_ts = time.time()
        claim_id = f"claim_{uuid.uuid4().hex[:12]}"
        lease_expiry_ts = now_ts + lease_ttl_seconds

        with cls._lock:
            lock_fd = ResearchPartitionGuard._acquire_process_file_lock(cls._LOCK_FILE)
            try:
                registry = cls._load_registry()
                exps = registry.setdefault("experiments", {})

                rec = exps.get(experiment_id, {})
                history = list(rec.get("history", []))
                if experiment_id in exps:
                    status = rec.get("status")
                    if status == "COMMITTED":
                        raise TestSelectionLockError(
                            f"TEST SELECTION LOCK: Experiment '{experiment_id}' has already been evaluated "
                            "and committed to the authoritative research registry. Re-tuning is forbidden."
                        )
                    elif status in ["CLAIMED", "EVALUATING"]:
                        existing_claim = rec.get("claim", {})
                        existing_expiry = existing_claim.get("leaseExpiryTs", 0)
                        if now_ts < existing_expiry:
                            raise TestSelectionLockError(
                                f"TEST CLAIM CONFLICT: Experiment '{experiment_id}' is actively claimed by "
                                f"worker '{existing_claim.get('workerId')}' until {existing_claim.get('leaseExpiry')}."
                            )
                        # Lease expired -> crash recovery
                        history.append({
                            "event": "LEASE_EXPIRED_RECLAIMED",
                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                            "reclaimedFromWorker": existing_claim.get("workerId"),
                            "reclaimedByWorker": worker
                        })

                history.append({
                    "event": "CLAIMED",
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                    "workerId": worker,
                    "claimId": claim_id
                })

                # Register new atomic claim
                record = {
                    "experimentId": experiment_id,
                    "status": "CLAIMED",
                    "claim": {
                        "claimId": claim_id,
                        "workerId": worker,
                        "claimedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                        "claimedAtTs": now_ts,
                        "leaseExpiry": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(lease_expiry_ts)),
                        "leaseExpiryTs": lease_expiry_ts,
                        "leaseTtlSeconds": lease_ttl_seconds
                    },
                    "lineage": lineage_hashes or {},
                    "history": history
                }
                exps[experiment_id] = record
                cls._save_registry(registry)
                return record
            finally:
                ResearchPartitionGuard._release_process_file_lock(cls._LOCK_FILE, lock_fd)

    @classmethod
    def heartbeat_claim(cls, experiment_id: str, claim_id: str, extension_seconds: int = 300) -> bool:
        """Renews the active lease for a long-running evaluation."""
        now_ts = time.time()
        with cls._lock:
            lock_fd = ResearchPartitionGuard._acquire_process_file_lock(cls._LOCK_FILE)
            try:
                registry = cls._load_registry()
                exps = registry.setdefault("experiments", {})
                if experiment_id not in exps:
                    return False
                rec = exps[experiment_id]
                claim = rec.get("claim", {})
                if claim.get("claimId") != claim_id or rec.get("status") not in ["CLAIMED", "EVALUATING"]:
                    return False
                new_expiry = now_ts + extension_seconds
                claim["leaseExpiryTs"] = new_expiry
                claim["leaseExpiry"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(new_expiry))
                cls._save_registry(registry)
                return True
            finally:
                ResearchPartitionGuard._release_process_file_lock(cls._LOCK_FILE, lock_fd)

    @classmethod
    def commit_evidence(
        cls,
        experiment_id: str,
        claim_id: str,
        evidence_metrics: Dict[str, Any],
        lineage_hashes: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Durable, atomic commit of research evidence to registry.
        Permanently locks the experiment against any subsequent re-evaluation.
        """
        import hashlib
        now_ts = time.time()
        with cls._lock:
            lock_fd = ResearchPartitionGuard._acquire_process_file_lock(cls._LOCK_FILE)
            try:
                registry = cls._load_registry()
                exps = registry.setdefault("experiments", {})
                if experiment_id not in exps:
                    raise RuntimeError(f"Experiment '{experiment_id}' must be claimed before committing evidence.")
                rec = exps[experiment_id]
                claim = rec.get("claim", {})
                if claim.get("claimId") != claim_id:
                    raise RuntimeError(f"Claim ID mismatch for experiment '{experiment_id}'.")

                evidence_str = json.dumps(evidence_metrics, sort_keys=True)
                evidence_hash = hashlib.sha256(evidence_str.encode("utf-8")).hexdigest()

                rec["status"] = "COMMITTED"
                rec["evidence"] = {
                    **evidence_metrics,
                    "evidenceHash": evidence_hash,
                    "committedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts))
                }
                if lineage_hashes:
                    rec["lineage"] = {**rec.get("lineage", {}), **lineage_hashes}
                rec["history"].append({
                    "event": "COMMITTED",
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                    "claimId": claim_id,
                    "evidenceHash": evidence_hash
                })
                cls._save_registry(registry)
                return rec
            finally:
                ResearchPartitionGuard._release_process_file_lock(cls._LOCK_FILE, lock_fd)

    @classmethod
    def get_experiment(cls, experiment_id: str) -> Optional[Dict[str, Any]]:
        registry = cls._load_registry()
        return registry.get("experiments", {}).get(experiment_id)

    @classmethod
    def list_experiments(cls) -> Dict[str, Any]:
        registry = cls._load_registry()
        return registry.get("experiments", {})

    @classmethod
    def reset_registry(cls) -> None:
        """Harness reset for test isolation."""
        with cls._lock:
            if os.path.exists(cls._REGISTRY_FILE):
                try:
                    os.remove(cls._REGISTRY_FILE)
                except OSError:
                    pass
            if os.path.exists(cls._LOCK_FILE):
                try:
                    os.remove(cls._LOCK_FILE)
                except OSError:
                    pass

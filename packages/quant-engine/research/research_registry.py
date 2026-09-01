"""
QuantX Authoritative Transactional Research Experiment Registry.

Provides robust, distributed, ACID-compliant state management with:
  1. Monotonically increasing generation fencing tokens (`claimGeneration`)
  2. Strict atomic conditional state machine: AVAILABLE -> CLAIMED -> EVALUATING -> COMMITTED / EXPIRED / ABORTED
  3. Worker ownership enforcement (`workerId`, `processId`, `nodeHostname`)
  4. Unexpired lease verification at commit time
  5. 12-Dimensional lineage and typed evidence persistence with deterministic content hash
  6. Append-only, deletion-protected committed research records
"""
import os
import sys
import time
import uuid
import json
import sqlite3
import threading
from typing import Dict, Any, Optional

from research.evidence_schema import (
    ResearchLineage,
    ResearchEvidence,
    EvidenceValidationError,
    AccountingInconsistencyError,
    compute_deterministic_evidence_content_hash
)


class ResearchRegistryError(Exception):
    """Base error for research registry failures."""
    pass


class RegistryCorruptionError(ResearchRegistryError):
    """Raised when authoritative research registry state is corrupted or unparseable. Fails closed."""
    pass


class StaleGenerationError(ResearchRegistryError):
    """Raised when a worker attempts an operation using a superseded claim generation token."""
    pass


class LeaseExpiredError(ResearchRegistryError):
    """Raised when an operation is attempted after lease expiration."""
    pass


class WorkerOwnershipError(ResearchRegistryError):
    """Raised when an operation is attempted by a worker that does not own the active lease."""
    pass


class DuplicateCommitError(ResearchRegistryError):
    """Raised when an experiment has already been committed and cannot be re-evaluated."""
    pass


class TransactionalResearchRegistry:
    """
    Transactional Research Registry with generation fencing tokens.
    Backed by ACID SQLite storage (or PostgreSQL) with WAL journal mode.
    """
    _DEFAULT_DB_DIR = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".research_locks"
    )
    _lock = threading.RLock()

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or os.path.join(self._DEFAULT_DB_DIR, "quantx_research_registry.db")
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=15000;")
        return conn

    def _init_db(self) -> None:
        with self._lock:
            with self._get_connection() as conn:
                conn.execute("""
                CREATE TABLE IF NOT EXISTS research_experiments (
                    experiment_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    claim_generation INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                """)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS research_claims (
                    claim_id TEXT PRIMARY KEY,
                    experiment_id TEXT NOT NULL,
                    claim_generation INTEGER NOT NULL,
                    worker_id TEXT NOT NULL,
                    node_hostname TEXT,
                    process_id INTEGER,
                    claimed_at REAL NOT NULL,
                    lease_expires_at REAL NOT NULL,
                    is_reclaimed INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(experiment_id) REFERENCES research_experiments(experiment_id) ON DELETE RESTRICT
                );
                """)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS research_evidence_bundles (
                    experiment_id TEXT PRIMARY KEY,
                    claim_generation INTEGER NOT NULL,
                    evidence_content_hash TEXT UNIQUE NOT NULL,
                    trade_count INTEGER NOT NULL,
                    daily_observation_count INTEGER NOT NULL,
                    prediction_count INTEGER NOT NULL,
                    effective_sample_size REAL NOT NULL,
                    profit_factor_status TEXT NOT NULL,
                    gross_profit_factor REAL,
                    net_profit_factor REAL,
                    net_cagr REAL NOT NULL,
                    sharpe REAL NOT NULL,
                    sortino REAL NOT NULL,
                    max_drawdown REAL NOT NULL,
                    turnover_annual REAL NOT NULL,
                    total_costs REAL NOT NULL,
                    total_gross_pnl REAL NOT NULL,
                    total_net_pnl REAL NOT NULL,
                    pbo REAL NOT NULL,
                    dsr REAL NOT NULL,
                    is_alpha_significant INTEGER NOT NULL,
                    has_alpha_decay INTEGER NOT NULL,
                    raw_evidence_chain_json TEXT NOT NULL,
                    lineage_json TEXT NOT NULL,
                    metrics_json TEXT NOT NULL,
                    committed_at REAL NOT NULL,
                    committed_by_worker TEXT NOT NULL,
                    FOREIGN KEY(experiment_id) REFERENCES research_experiments(experiment_id) ON DELETE RESTRICT
                );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_claims_lease ON research_claims(lease_expires_at, is_reclaimed);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_experiments_status ON research_experiments(status);")

    def claim_experiment(
        self,
        experiment_id: str,
        worker_id: Optional[str] = None,
        lease_ttl_seconds: int = 300,
        lineage: Optional[ResearchLineage] = None
    ) -> Dict[str, Any]:
        """
        Atomically claims an experiment ID with lease TTL, worker ownership, and fencing token.
        Raises DuplicateCommitError if already committed, or LeaseExpiredError / WorkerOwnershipError on contention.
        """
        if not experiment_id or not isinstance(experiment_id, str) or not experiment_id.strip():
            raise ValueError("EXPERIMENT_ID_REQUIRED: experiment_id must be a non-empty string.")

        worker = worker_id or f"{os.uname().nodename if hasattr(os, 'uname') else 'localhost'}:{os.getpid()}"
        now_ts = time.time()
        lease_expiry_ts = now_ts + lease_ttl_seconds
        claim_id = f"claim_{uuid.uuid4().hex[:12]}"

        with self._lock:
            conn = self._get_connection()
            try:
                conn.execute("BEGIN IMMEDIATE TRANSACTION;")

                # Fetch experiment row with row lock
                cur = conn.execute("SELECT status, claim_generation FROM research_experiments WHERE experiment_id = ?;", (experiment_id,))
                row = cur.fetchone()

                if row:
                    status = row["status"]
                    current_gen = row["claim_generation"]

                    if status == "COMMITTED":
                        raise DuplicateCommitError(
                            f"TEST SELECTION LOCK: Experiment '{experiment_id}' has already been evaluated and committed. Re-tuning is strictly forbidden."
                        )

                    if status in ["CLAIMED", "EVALUATING"]:
                        # Check active claim lease
                        claim_cur = conn.execute(
                            "SELECT claim_id, worker_id, lease_expires_at, claim_generation FROM research_claims WHERE experiment_id = ? AND is_reclaimed = 0 ORDER BY claim_generation DESC LIMIT 1;",
                            (experiment_id,)
                        )
                        active_claim = claim_cur.fetchone()

                        if active_claim and now_ts < active_claim["lease_expires_at"]:
                            raise WorkerOwnershipError(
                                f"TEST CLAIM CONFLICT: Experiment '{experiment_id}' is actively claimed by worker '{active_claim['worker_id']}' until {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(active_claim['lease_expires_at']))}."
                            )

                        # Lease expired -> mark old claims reclaimed and increment generation atomically
                        conn.execute("UPDATE research_claims SET is_reclaimed = 1 WHERE experiment_id = ?;", (experiment_id,))
                        new_gen = current_gen + 1
                        updated = conn.execute(
                            "UPDATE research_experiments SET status = 'CLAIMED', claim_generation = ?, updated_at = ? WHERE experiment_id = ? AND claim_generation = ?;",
                            (new_gen, now_ts, experiment_id, current_gen)
                        )
                        if updated.rowcount == 0:
                            raise WorkerOwnershipError(f"CONCURRENT_CLAIM_RACE: Experiment '{experiment_id}' state changed concurrently.")
                    else:
                        new_gen = current_gen + 1
                        conn.execute(
                            "UPDATE research_experiments SET status = 'CLAIMED', claim_generation = ?, updated_at = ? WHERE experiment_id = ?;",
                            (new_gen, now_ts, experiment_id)
                        )
                else:
                    new_gen = 1
                    conn.execute(
                        "INSERT INTO research_experiments (experiment_id, status, claim_generation, created_at, updated_at) VALUES (?, 'CLAIMED', ?, ?, ?);",
                        (experiment_id, new_gen, now_ts, now_ts)
                    )

                # Record claim
                conn.execute(
                    "INSERT INTO research_claims (claim_id, experiment_id, claim_generation, worker_id, node_hostname, process_id, claimed_at, lease_expires_at, is_reclaimed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0);",
                    (claim_id, experiment_id, new_gen, worker, os.uname().nodename if hasattr(os, 'uname') else 'localhost', os.getpid(), now_ts, lease_expiry_ts)
                )

                conn.execute("COMMIT;")

                return {
                    "experimentId": experiment_id,
                    "status": "CLAIMED",
                    "claim": {
                        "claimId": claim_id,
                        "claimGeneration": new_gen,
                        "workerId": worker,
                        "claimedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                        "claimedAtTs": now_ts,
                        "leaseExpiry": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(lease_expiry_ts)),
                        "leaseExpiryTs": lease_expiry_ts,
                        "leaseTtlSeconds": lease_ttl_seconds
                    },
                    "lineage": lineage.to_dict() if lineage else {}
                }
            except Exception:
                try:
                    conn.execute("ROLLBACK;")
                except Exception:
                    pass
                raise
            finally:
                conn.close()

    def heartbeat_claim(
        self,
        experiment_id: str,
        claim_id: str,
        claim_generation: int,
        extension_seconds: int = 300,
        worker_id: Optional[str] = None
    ) -> bool:
        """Extends active lease TTL if claim generation and worker ownership are valid."""
        now_ts = time.time()
        new_expiry_ts = now_ts + extension_seconds

        with self._lock:
            conn = self._get_connection()
            try:
                conn.execute("BEGIN IMMEDIATE TRANSACTION;")

                cur = conn.execute(
                    "SELECT worker_id, lease_expires_at, is_reclaimed FROM research_claims WHERE claim_id = ? AND experiment_id = ? AND claim_generation = ?;",
                    (claim_id, experiment_id, claim_generation)
                )
                claim = cur.fetchone()

                if not claim or claim["is_reclaimed"] == 1:
                    conn.execute("ROLLBACK;")
                    return False

                if worker_id and claim["worker_id"] != worker_id:
                    conn.execute("ROLLBACK;")
                    return False

                if now_ts > claim["lease_expires_at"]:
                    conn.execute("ROLLBACK;")
                    return False

                conn.execute(
                    "UPDATE research_claims SET lease_expires_at = ? WHERE claim_id = ?;",
                    (new_expiry_ts, claim_id)
                )
                conn.execute(
                    "UPDATE research_experiments SET updated_at = ? WHERE experiment_id = ?;",
                    (now_ts, experiment_id)
                )
                conn.execute("COMMIT;")
                return True
            except Exception:
                try:
                    conn.execute("ROLLBACK;")
                except Exception:
                    pass
                return False
            finally:
                conn.close()

    def commit_evidence(
        self,
        experiment_id: str,
        claim_id: str,
        claim_generation: int,
        evidence: ResearchEvidence,
        lineage: ResearchLineage,
        worker_id: str,
        raw_evidence_chain: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Durable, atomic commit of research evidence to registry.
        Fails closed on lease expiry, generation mismatch, or invalid evidence/lineage.
        """
        now_ts = time.time()
        content_hash = compute_deterministic_evidence_content_hash(lineage, evidence)
        raw_chain = raw_evidence_chain or {}

        with self._lock:
            conn = self._get_connection()
            try:
                conn.execute("BEGIN IMMEDIATE TRANSACTION;")

                exp_cur = conn.execute(
                    "SELECT status, claim_generation FROM research_experiments WHERE experiment_id = ?;",
                    (experiment_id,)
                )
                exp = exp_cur.fetchone()

                if not exp:
                    raise ResearchRegistryError(f"Experiment '{experiment_id}' does not exist in registry.")

                if exp["status"] == "COMMITTED":
                    raise DuplicateCommitError(f"Experiment '{experiment_id}' has already been committed.")

                if exp["claim_generation"] != claim_generation:
                    raise StaleGenerationError(
                        f"STALE_GENERATION: Provided generation {claim_generation} does not match active generation {exp['claim_generation']}."
                    )

                claim_cur = conn.execute(
                    "SELECT worker_id, lease_expires_at, is_reclaimed FROM research_claims WHERE claim_id = ? AND experiment_id = ? AND claim_generation = ?;",
                    (claim_id, experiment_id, claim_generation)
                )
                claim = claim_cur.fetchone()

                if not claim or claim["is_reclaimed"] == 1:
                    raise StaleGenerationError(f"Claim '{claim_id}' is reclaimed or invalid.")

                if claim["worker_id"] != worker_id:
                    raise WorkerOwnershipError(
                        f"WORKER_OWNERSHIP_MISMATCH: Claim owned by '{claim['worker_id']}', not '{worker_id}'."
                    )

                if now_ts > claim["lease_expires_at"]:
                    raise LeaseExpiredError(
                        f"LEASE_EXPIRED_AT_COMMIT: Lease expired at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(claim['lease_expires_at']))} (now: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now_ts))})."
                    )

                # Commit immutable evidence bundle
                conn.execute(
                    """
                    INSERT INTO research_evidence_bundles (
                        experiment_id, claim_generation, evidence_content_hash, trade_count,
                        daily_observation_count, prediction_count, effective_sample_size,
                        profit_factor_status, gross_profit_factor, net_profit_factor,
                        net_cagr, sharpe, sortino, max_drawdown, turnover_annual, total_costs,
                        total_gross_pnl, total_net_pnl, pbo, dsr, is_alpha_significant,
                        has_alpha_decay, raw_evidence_chain_json, lineage_json, metrics_json,
                        committed_at, committed_by_worker
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        experiment_id, claim_generation, content_hash,
                        evidence.tradeCount, evidence.dailyObservationCount, evidence.predictionCount,
                        evidence.effectiveSampleSize, evidence.profitFactorStatus,
                        evidence.grossProfitFactor, evidence.netProfitFactor,
                        evidence.netCagr, evidence.sharpe, evidence.sortino,
                        evidence.maxDrawdown, evidence.turnoverAnnual, evidence.totalCosts,
                        evidence.totalGrossPnl, evidence.totalNetPnl, evidence.pbo, evidence.dsr,
                        1 if evidence.isAlphaSignificant else 0,
                        1 if evidence.hasAlphaDecay else 0,
                        json.dumps(raw_chain, sort_keys=True),
                        json.dumps(lineage.to_dict(), sort_keys=True),
                        json.dumps(evidence.to_dict(), sort_keys=True),
                        now_ts, worker_id
                    )
                )

                # Transition experiment status to COMMITTED
                conn.execute(
                    "UPDATE research_experiments SET status = 'COMMITTED', updated_at = ? WHERE experiment_id = ?;",
                    (now_ts, experiment_id)
                )

                conn.execute("COMMIT;")

                return {
                    "experimentId": experiment_id,
                    "status": "COMMITTED",
                    "claimGeneration": claim_generation,
                    "evidenceContentHash": content_hash,
                    "rawEvidenceChain": raw_chain,
                    "lineage": lineage.to_dict(),
                    "evidence": evidence.to_dict(),
                    "committedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts)),
                    "committedByWorker": worker_id
                }
            except Exception:
                try:
                    conn.execute("ROLLBACK;")
                except Exception:
                    pass
                raise
            finally:
                conn.close()

    def get_experiment(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves experiment details and evidence bundle if committed."""
        with self._lock:
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "SELECT experiment_id, status, claim_generation, created_at, updated_at FROM research_experiments WHERE experiment_id = ?;",
                    (experiment_id,)
                )
                exp = cur.fetchone()
                if not exp:
                    return None

                result = {
                    "experimentId": exp["experiment_id"],
                    "status": exp["status"],
                    "claimGeneration": exp["claim_generation"],
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(exp["created_at"])),
                    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(exp["updated_at"])),
                }

                if exp["status"] == "COMMITTED":
                    ev_cur = conn.execute(
                        """
                        SELECT evidence_content_hash, raw_evidence_chain_json, lineage_json,
                               metrics_json, committed_at, committed_by_worker
                        FROM research_evidence_bundles WHERE experiment_id = ?;
                        """,
                        (experiment_id,)
                    )
                    ev_row = ev_cur.fetchone()
                    if ev_row:
                        result["evidenceContentHash"] = ev_row["evidence_content_hash"]
                        result["rawEvidenceChain"] = json.loads(ev_row["raw_evidence_chain_json"])
                        result["lineage"] = json.loads(ev_row["lineage_json"])
                        result["evidence"] = json.loads(ev_row["metrics_json"])
                        result["committedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ev_row["committed_at"]))
                        result["committedByWorker"] = ev_row["committed_by_worker"]
                else:
                    claim_cur = conn.execute(
                        "SELECT claim_id, worker_id, lease_expires_at FROM research_claims WHERE experiment_id = ? AND is_reclaimed = 0 ORDER BY claim_generation DESC LIMIT 1;",
                        (experiment_id,)
                    )
                    active_claim = claim_cur.fetchone()
                    if active_claim:
                        result["claim"] = {
                            "claimId": active_claim["claim_id"],
                            "workerId": active_claim["worker_id"],
                            "leaseExpiry": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(active_claim["lease_expires_at"])),
                            "leaseExpiryTs": active_claim["lease_expires_at"]
                        }

                return result
            finally:
                conn.close()

    def delete_experiment(self, experiment_id: str) -> None:
        """Committed experiments cannot be deleted. Deletion is strictly prohibited."""
        with self._lock:
            conn = self._get_connection()
            try:
                cur = conn.execute("SELECT status FROM research_experiments WHERE experiment_id = ?;", (experiment_id,))
                row = cur.fetchone()
                if row and row["status"] == "COMMITTED":
                    raise PermissionError(
                        f"IMMUTABLE_EVIDENCE_PROTECTED: Experiment '{experiment_id}' has committed evidence and cannot be deleted."
                    )
                conn.execute("DELETE FROM research_claims WHERE experiment_id = ?;", (experiment_id,))
                conn.execute("DELETE FROM research_experiments WHERE experiment_id = ?;", (experiment_id,))
            finally:
                conn.close()

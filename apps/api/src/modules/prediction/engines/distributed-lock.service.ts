import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  OnModuleInit,
} from '@nestjs/common';
import * as os from 'os';
import * as crypto from 'crypto';
import { DatabaseService } from '../../../database/database.service';

export interface LockAcquisitionResult {
  acquired: boolean;
  ownerId: string;
  fencingToken?: number;
  isSingleInstanceBypass?: boolean;
}

@Injectable()
export class DistributedLockService implements OnModuleInit {
  private readonly logger = new Logger(DistributedLockService.name);
  private tableInitialized = false;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.ensureTableExists();
  }

  private isReady = false;

  public isServiceReady(): boolean {
    return this.isReady;
  }

  async ensureTableExists(): Promise<void> {
    if (this.tableInitialized) return;
    if (!this.db?.client?.$executeRawUnsafe) return;

    try {
      // Non-destructive schema verification probe
      await this.db.client.$queryRawUnsafe(
        `SELECT lock_key FROM distributed_locks LIMIT 0;`,
      );
      this.tableInitialized = true;
      this.isReady = true;
      return;
    } catch {
      // Fallback schema bootstrap for local dev/testing environments
      try {
        await this.db.client.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS distributed_locks (
            lock_key VARCHAR(128) PRIMARY KEY,
            owner_id VARCHAR(256) NOT NULL,
            acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lease_expires_at TIMESTAMPTZ NOT NULL,
            fencing_token BIGINT NOT NULL DEFAULT 1,
            released_at TIMESTAMPTZ
          );
        `);
        this.tableInitialized = true;
        this.isReady = true;
      } catch (err: any) {
        this.isReady = false;
        this.logger.warn(
          `Could not verify distributed_locks table schema on init: ${err.message}`,
        );
      }
    }
  }

  /**
   * Generates a globally unique owner ID for this specific worker execution.
   */
  public generateOwnerId(): string {
    return `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  }

  /**
   * Atomically acquires a distributed lease lock for the specified lockKey.
   *
   * @param lockKey Unique lock identifier (e.g. 'training_pipeline')
   * @param leaseDurationMs Lease expiration duration in milliseconds (default: 10 minutes)
   * @param customOwnerId Optional custom owner identifier
   * @returns LockAcquisitionResult with acquired status, ownerId, and fencing token
   * @throws ServiceUnavailableException on database timeout, connection error, or outage (Fail-Closed)
   */
  async acquireLock(
    lockKey: string,
    leaseDurationMs: number = 600_000,
    customOwnerId?: string,
  ): Promise<LockAcquisitionResult> {
    const ownerId = customOwnerId || this.generateOwnerId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseDurationMs);

    if (!this.db?.client?.$queryRawUnsafe) {
      if (
        process.env.ALLOW_UNSAFE_SINGLE_INSTANCE_LOCK === 'true' &&
        process.env.NODE_ENV !== 'production'
      ) {
        this.logger.warn(
          `UNSAFE_LOCK_BYPASS: Single-instance lock bypass permitted for key '${lockKey}'.`,
        );
        return { acquired: true, ownerId, isSingleInstanceBypass: true };
      }
      throw new ServiceUnavailableException(
        'DISTRIBUTED_LOCK_UNAVAILABLE: Database client is uninitialized. Lock acquisition failed closed.',
      );
    }

    try {
      const rows = await this.db.client.$queryRawUnsafe<any[]>(
        `INSERT INTO distributed_locks (lock_key, owner_id, acquired_at, lease_expires_at, fencing_token, released_at)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, 1, NULL)
         ON CONFLICT (lock_key) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             acquired_at = EXCLUDED.acquired_at,
             lease_expires_at = EXCLUDED.lease_expires_at,
             fencing_token = distributed_locks.fencing_token + 1,
             released_at = NULL
         WHERE distributed_locks.released_at IS NOT NULL
            OR distributed_locks.lease_expires_at < NOW()
         RETURNING lock_key, owner_id, fencing_token;`,
        lockKey,
        ownerId,
        now.toISOString(),
        expiresAt.toISOString(),
      );

      if (rows && rows.length > 0) {
        const fencingToken = Number(rows[0].fencing_token || 1);
        this.logger.log(
          `Distributed lock acquired: '${lockKey}' by owner '${ownerId}' (fencingToken: ${fencingToken})`,
        );
        return { acquired: true, ownerId, fencingToken };
      }

      this.logger.warn(
        `Distributed lock acquisition rejected: '${lockKey}' is currently held by another instance.`,
      );
      return { acquired: false, ownerId };
    } catch (err: any) {
      this.logger.error(
        `Distributed lock error on '${lockKey}': ${err.message}`,
      );

      if (
        process.env.ALLOW_UNSAFE_SINGLE_INSTANCE_LOCK === 'true' &&
        process.env.NODE_ENV !== 'production'
      ) {
        this.logger.warn(
          `UNSAFE_LOCK_BYPASS: Falling back to single-instance mode due to explicit override.`,
        );
        return { acquired: true, ownerId, isSingleInstanceBypass: true };
      }

      // Mandatory Fail-Closed Guarantee (sanitized message without leaking internal DB strings)
      throw new ServiceUnavailableException(
        'DISTRIBUTED_LOCK_UNAVAILABLE: Database lock provider is unreachable or failed. Operation rejected to prevent split-brain execution.',
      );
    }
  }

  /**
   * Atomically releases a held lease lock.
   * Safe under connection pooling because ownership is verified via ownerId, not physical DB connection.
   * Optionally verifies fencingToken to prevent superseded workers from releasing a newer lease.
   */
  async releaseLock(
    lockKey: string,
    ownerId: string,
    fencingToken?: number,
  ): Promise<boolean> {
    if (!this.db?.client?.$queryRawUnsafe) return false;

    try {
      const rows = await this.db.client.$queryRawUnsafe<any[]>(
        `UPDATE distributed_locks
         SET released_at = NOW()
         WHERE lock_key = $1
           AND owner_id = $2
           AND released_at IS NULL
           AND ($3::bigint IS NULL OR fencing_token = $3::bigint)
         RETURNING lock_key;`,
        lockKey,
        ownerId,
        fencingToken ?? null,
      );

      const released = !!(rows && rows.length > 0);
      if (released) {
        this.logger.log(
          `Distributed lock released: '${lockKey}' by owner '${ownerId}' (token: ${fencingToken ?? 'any'})`,
        );
      } else {
        this.logger.warn(
          `Distributed lock release skipped: '${lockKey}' was not held by owner '${ownerId}' or was superseded.`,
        );
      }
      return released;
    } catch (err: any) {
      this.logger.error(
        `Distributed lock release error on '${lockKey}': ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Cryptographically / monotonically validates that the fencing token is still active,
   * unreleased, and currently holds the valid lease.
   */
  async validateFencingToken(
    lockKey: string,
    ownerId: string,
    fencingToken: number,
  ): Promise<boolean> {
    if (!this.db?.client?.$queryRawUnsafe) {
      return process.env.ALLOW_UNSAFE_SINGLE_INSTANCE_LOCK === 'true';
    }

    try {
      const rows = await this.db.client.$queryRawUnsafe<any[]>(
        `SELECT lock_key, owner_id, fencing_token
         FROM distributed_locks
         WHERE lock_key = $1
           AND owner_id = $2
           AND fencing_token = $3::bigint
           AND released_at IS NULL
           AND lease_expires_at >= NOW();`,
        lockKey,
        ownerId,
        fencingToken,
      );

      return !!(rows && rows.length > 0);
    } catch (err: any) {
      this.logger.error(
        `Fencing token validation error on '${lockKey}': ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Renews/heartbeats an existing active lease.
   */
  async renewLease(
    lockKey: string,
    ownerId: string,
    additionalMs: number = 300_000,
  ): Promise<boolean> {
    if (!this.db?.client?.$queryRawUnsafe) return false;

    try {
      const newExpiry = new Date(Date.now() + additionalMs);
      const rows = await this.db.client.$queryRawUnsafe<any[]>(
        `UPDATE distributed_locks
         SET lease_expires_at = $3::timestamptz
         WHERE lock_key = $1 AND owner_id = $2 AND released_at IS NULL AND lease_expires_at >= NOW()
         RETURNING lock_key;`,
        lockKey,
        ownerId,
        newExpiry.toISOString(),
      );
      return !!(rows && rows.length > 0);
    } catch {
      return false;
    }
  }
}

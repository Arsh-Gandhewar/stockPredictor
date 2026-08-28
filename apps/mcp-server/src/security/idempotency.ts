import { McpError } from '../errors/mcp-errors.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StoredExecution {
  result: unknown;
  timestamp: number;
  payloadHash: string;
  operation: string;
  userId: string;
}

export class IdempotencyManager {
  private cache = new Map<string, StoredExecution>();
  private inFlight = new Map<string, Promise<any>>();
  private readonly ttlMs: number;
  private readonly persistenceFile: string;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.persistenceFile = path.resolve(process.cwd(), '.quantx/idempotency-store.json');
    this.loadFromDisk();

    setInterval(() => {
      this.purgeExpired();
    }, 5 * 60 * 1000).unref();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.persistenceFile)) {
        const raw = fs.readFileSync(this.persistenceFile, 'utf-8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this.cache.set(k, v as StoredExecution);
        }
      }
    } catch {
      // Best-effort local persistence
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.persistenceFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj: Record<string, StoredExecution> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.persistenceFile, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
      // Best-effort local persistence
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.saveToDisk();
    }
  }

  /**
   * Computes deterministic SHA-256 canonical hash of the request payload.
   */
  static computePayloadHash(payload: unknown): string {
    const canonicalString = IdempotencyManager.canonicalize(payload);
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  private static canonicalize(obj: any): string {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map((x) => IdempotencyManager.canonicalize(x)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + IdempotencyManager.canonicalize(obj[k])).join(',') + '}';
  }

  /**
   * Validates format of idempotency key.
   */
  static validateKey(key: string | undefined): string {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new McpError('INVALID_INPUT', 'idempotencyKey is required for write operations to prevent duplicate trades.');
    }
    const cleanKey = key.trim();
    if (cleanKey.length < 8 || cleanKey.length > 128) {
      throw new McpError('INVALID_INPUT', 'idempotencyKey must be between 8 and 128 characters.');
    }
    if (!/^[A-Za-z0-9_\-:]+$/.test(cleanKey)) {
      throw new McpError('INVALID_INPUT', 'idempotencyKey can only contain alphanumeric characters, hyphens, colons, and underscores.');
    }
    return cleanKey;
  }

  /**
   * Checks if an idempotency key was previously processed for this user.
   * If payload matches -> returns original result.
   * If payload differs -> throws CONFLICT.
   */
  getExisting(key: string, userId: string, currentPayloadHash?: string): unknown | null {
    const fullKey = `${userId}:${key}`;
    const entry = this.cache.get(fullKey);
    if (!entry) return null;

    if (currentPayloadHash && entry.payloadHash && entry.payloadHash !== currentPayloadHash) {
      throw new McpError(
        'CONFLICT',
        `Idempotency Conflict: Key '${key}' was already processed with a different request payload. Reusing keys with different parameters is forbidden.`
      );
    }

    return entry.result;
  }

  /**
   * Concurrently coalesces identical in-flight requests and returns cached results for duplicates.
   */
  async runOnce<T>(
    key: string,
    userId: string,
    payloadHash: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const existing = this.getExisting(key, userId, payloadHash);
    if (existing) {
      return { ...(existing as any), isDuplicate: true };
    }

    const fullKey = `${userId}:${key}`;
    if (this.inFlight.has(fullKey)) {
      const result = await this.inFlight.get(fullKey);
      return { ...(result as any), isDuplicate: true };
    }

    const promise = (async () => {
      try {
        const res = await fn();
        this.record(key, userId, res, payloadHash, operation);
        return res;
      } finally {
        this.inFlight.delete(fullKey);
      }
    })();

    this.inFlight.set(fullKey, promise);
    return promise;
  }

  /**
   * Stores execution result durably.
   */
  record(key: string, userId: string, result: unknown, payloadHash: string = '', operation: string = 'TRADE'): void {
    const fullKey = `${userId}:${key}`;
    this.cache.set(fullKey, {
      result,
      timestamp: Date.now(),
      payloadHash,
      operation,
      userId,
    });
    this.saveToDisk();
  }

  clear(): void {
    this.cache.clear();
    try {
      if (fs.existsSync(this.persistenceFile)) {
        fs.unlinkSync(this.persistenceFile);
      }
    } catch {
      // Ignored
    }
  }
}

export const idempotencyManager = new IdempotencyManager();

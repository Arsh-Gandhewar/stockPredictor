import { McpError } from '../errors/mcp-errors.js';

interface CachedExecution {
  result: unknown;
  timestamp: number;
  hash: string;
}

export class IdempotencyManager {
  private cache = new Map<string, CachedExecution>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    // 24-hour default retention for idempotency keys
    this.ttlMs = ttlMs;

    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.ttlMs) {
          this.cache.delete(key);
        }
      }
    }, 5 * 60 * 1000).unref();
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
   * Checks if an idempotency key was previously processed.
   * If yes, returns the previously saved result.
   */
  getExisting(key: string, userScope: string): unknown | null {
    const fullKey = `${userScope}:${key}`;
    const entry = this.cache.get(fullKey);
    if (!entry) return null;
    return entry.result;
  }

  /**
   * Stores the successful execution result against the idempotency key.
   */
  record(key: string, userScope: string, result: unknown, payloadHash: string = ''): void {
    const fullKey = `${userScope}:${key}`;
    this.cache.set(fullKey, {
      result,
      timestamp: Date.now(),
      hash: payloadHash,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const idempotencyManager = new IdempotencyManager();

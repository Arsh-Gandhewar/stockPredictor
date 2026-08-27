import { McpError } from '../errors/mcp-errors.js';

export type RateLimitTier = 'HEALTH' | 'READ_LIGHT' | 'READ_MODERATE' | 'READ_HEAVY' | 'BACKTEST' | 'WRITE';

interface TierPolicy {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT_TIER_POLICIES: Record<RateLimitTier, TierPolicy> = {
  HEALTH: { maxRequests: 120, windowMs: 60_000 },
  READ_LIGHT: { maxRequests: 60, windowMs: 60_000 },
  READ_MODERATE: { maxRequests: 30, windowMs: 60_000 },
  READ_HEAVY: { maxRequests: 20, windowMs: 60_000 },
  BACKTEST: { maxRequests: 5, windowMs: 60_000 },
  WRITE: { maxRequests: 10, windowMs: 60_000 },
};

export class RateLimiter {
  private requestLog = new Map<string, number[]>();
  private activeConcurrency = 0;
  private maxConcurrency = 8;

  constructor(maxConcurrency: number = 8) {
    this.maxConcurrency = maxConcurrency;

    // Periodic cleanup of stale timestamps every 60 seconds
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.requestLog.entries()) {
        const valid = timestamps.filter((t) => now - t < 120_000);
        if (valid.length === 0) {
          this.requestLog.delete(key);
        } else {
          this.requestLog.set(key, valid);
        }
      }
    }, 60_000).unref();
  }

  /**
   * Evaluates rate limit for a given caller/tool and tier.
   * Throws RATE_LIMITED McpError if limit is breached.
   */
  checkRateLimit(key: string, tier: RateLimitTier): void {
    const policy = DEFAULT_TIER_POLICIES[tier] || DEFAULT_TIER_POLICIES.READ_MODERATE;
    const now = Date.now();
    const timestamps = this.requestLog.get(key) || [];

    // Filter to requests within current window
    const recent = timestamps.filter((t) => now - t < policy.windowMs);

    if (recent.length >= policy.maxRequests) {
      const oldest = recent[0];
      const retryAfterSec = Math.ceil((policy.windowMs - (now - oldest)) / 1000);
      throw new McpError(
        'RATE_LIMITED',
        `Rate limit exceeded for ${tier} operations. Limit: ${policy.maxRequests} requests per ${policy.windowMs / 1000}s. Please retry after ${retryAfterSec}s.`,
        {
          details: { tier, limit: policy.maxRequests, windowMs: policy.windowMs, retryAfterSec },
          retryable: true,
          httpStatus: 429,
        }
      );
    }

    recent.push(now);
    this.requestLog.set(key, recent);
  }

  /**
   * Acquire a concurrency token. Throws RATE_LIMITED if max concurrent tasks reached.
   */
  acquireConcurrency(toolName: string): () => void {
    if (this.activeConcurrency >= this.maxConcurrency) {
      throw new McpError(
        'RATE_LIMITED',
        `Maximum concurrent upstream requests reached (${this.maxConcurrency}). Please retry when active requests complete.`,
        { details: { tool: toolName, activeConcurrency: this.activeConcurrency }, retryable: true, httpStatus: 429 }
      );
    }

    this.activeConcurrency++;
    let released = false;

    return () => {
      if (!released) {
        released = true;
        this.activeConcurrency = Math.max(0, this.activeConcurrency - 1);
      }
    };
  }

  getActiveConcurrency(): number {
    return this.activeConcurrency;
  }

  reset(): void {
    this.requestLog.clear();
    this.activeConcurrency = 0;
  }
}

export const rateLimiter = new RateLimiter();

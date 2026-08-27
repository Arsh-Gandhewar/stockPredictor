import { RateLimiter } from '../src/security/rate-limiter.js';
import { McpError } from '../src/errors/mcp-errors.js';

describe('Rate Limiter & Concurrency Suite', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3); // Max concurrency = 3
  });

  afterEach(() => {
    limiter.reset();
  });

  it('allows requests within the tier threshold', () => {
    expect(() => {
      for (let i = 0; i < 5; i++) {
        limiter.checkRateLimit('user_1:test_tool', 'BACKTEST');
      }
    }).not.toThrow();
  });

  it('throws RATE_LIMITED McpError when tier limit is breached', () => {
    // BACKTEST tier allows 5 requests per minute
    for (let i = 0; i < 5; i++) {
      limiter.checkRateLimit('user_limited:test_tool', 'BACKTEST');
    }

    expect(() => {
      limiter.checkRateLimit('user_limited:test_tool', 'BACKTEST');
    }).toThrow(McpError);

    try {
      limiter.checkRateLimit('user_limited:test_tool', 'BACKTEST');
    } catch (err: any) {
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.httpStatus).toBe(429);
      expect(err.retryable).toBe(true);
    }
  });

  it('enforces concurrency token limits', () => {
    const release1 = limiter.acquireConcurrency('heavy_tool');
    const release2 = limiter.acquireConcurrency('heavy_tool');
    const release3 = limiter.acquireConcurrency('heavy_tool');

    expect(limiter.getActiveConcurrency()).toBe(3);

    // 4th request must be rejected
    expect(() => {
      limiter.acquireConcurrency('heavy_tool');
    }).toThrow(McpError);

    // Release one token and acquire again
    release1();
    expect(limiter.getActiveConcurrency()).toBe(2);

    const release4 = limiter.acquireConcurrency('heavy_tool');
    expect(limiter.getActiveConcurrency()).toBe(3);

    release2();
    release3();
    release4();
    expect(limiter.getActiveConcurrency()).toBe(0);
  });
});

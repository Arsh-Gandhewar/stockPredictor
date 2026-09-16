/**
 * Authoritative Canonical Throttle Policies for QuantX Institutional API
 * Eliminates duplicate decorator overrides and guarantees strict deterministic rate limiting.
 */
export const THROTTLE_POLICIES = {
  /**
   * Training Throttle Policy: 3 executions per 10 minutes (600,000 ms)
   * Protects heavy model fitting and backtest walk-forward recomputation.
   */
  TRAINING: {
    training: { limit: 3, ttl: 600000 },
  },

  /**
   * Expensive Endpoints Policy: 30 requests per minute (60,000 ms)
   * Applied to audit decks, governance checks, model scorecards, and walk-forward verification.
   */
  EXPENSIVE: {
    expensive: { limit: 30, ttl: 60000 },
  },

  /**
   * Auth-Sensitive Endpoints: 20 requests per minute (60,000 ms)
   */
  AUTH_SENSITIVE: {
    default: { limit: 20, ttl: 60000 },
  },

  /**
   * Default Baseline Policy: 300 requests per minute (60,000 ms)
   * High-throughput baseline for UI polling, live quote feeds, and ticker searches.
   */
  DEFAULT: {
    default: { limit: 300, ttl: 60000 },
  },
} as const;

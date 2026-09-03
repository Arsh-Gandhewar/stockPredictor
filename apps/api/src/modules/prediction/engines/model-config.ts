/**
 * QuantX Quantitative Model Configuration
 * Centralized governance repository for all quantitative parameters,
 * lookbacks, statistical thresholds, trading frictions, and risk constraints.
 * (Eliminates dispersed magic numbers across the prediction framework)
 */

export const MODEL_CONFIG = {
  VERSION: '5.1.0',
  CALIBRATION_VERSION: 'v5.1.0-isotonic-hac',
  FEATURE_SCHEMA_VERSION: 'v5.1.0-multi-factor-25',
  POLICY_VERSION: 'v5.1.0-mvo-constrained',

  // ── Technical & Statistical Feature Parameters ──
  FEATURES: {
    WARMUP_MIN_CANDLES: 50,
    RSI_PERIOD: 14,
    MACD: {
      FAST_PERIOD: 12,
      SLOW_PERIOD: 26,
      SIGNAL_PERIOD: 9,
    },
    SMA: {
      SHORT_PERIOD: 20,
      LONG_PERIOD: 50,
    },
    EMA: {
      FAST_PERIOD: 12,
      MEDIUM_PERIOD: 20,
      SLOW_PERIOD: 26,
    },
    ATR_PERIOD: 14,
    BOLLINGER: {
      PERIOD: 20,
      STD_DEV: 2.0,
    },
    STOCHASTIC: {
      K_PERIOD: 14,
      D_PERIOD: 3,
    },
    LOOKBACKS: {
      VOLATILITY_20D: 20,
      BETA_60D: 60,
      DRAWDOWN_20D: 20,
      DRAWDOWN_60D: 60,
      VOLUME_ZSCORE: 20,
      GAP_RISK: 20,
      TAIL_RISK: 60,
      MOMENTUM_SHORT: 5,
      MOMENTUM_MID: 10,
      MOMENTUM_LONG: 20,
      ANNUALIZATION_FACTOR: 252,
    },
  },

  // ── Multi-Dimensional Risk Metrics & Weights ──
  RISK: {
    STOP_LOSS_ATR_MULTIPLIER: 2.0,
    TARGET_ATR_MULTIPLIER: 3.0,
    MIN_ASSET_VOLATILITY_FLOOR: 0.012, // 1.2% daily floor
    MAX_ASSET_VOLATILITY_CAP: 0.08,   // 8.0% daily cap
    DOWNSIDE_PROBABILITY_BOUNDS: {
      MIN: 0.05,
      MAX: 0.95,
    },
    // Position sizing (Quarter-Kelly inspired)
    KELLY_FRACTION: 0.25,
    MAX_PORTFOLIO_WEIGHT_PER_STOCK: 0.15, // 15% max allocation
    MIN_PORTFOLIO_WEIGHT_PER_STOCK: 0.02, // 2% min allocation
    SECTOR_CONCENTRATION_LIMIT: 0.40,     // 40% max in single sector
    POSITION_CONCENTRATION_LIMIT: 0.20,   // 20% concentration alert
    // Multi-factor RiskScore component weights (normalized to 1.0)
    SCORE_WEIGHTS: {
      VOLATILITY: 0.18,
      DOWNSIDE_DEV: 0.18,
      MAX_DRAWDOWN: 0.15,
      BETA: 0.12,
      ATR_PERCENT: 0.12,
      GAP_RISK: 0.08,
      ILLIQUIDITY: 0.07,
      TAIL_RISK: 0.10,
    },
    // Dynamic Position Risk States (0 - 100)
    STATE_THRESHOLDS: {
      NORMAL: 25,
      CAUTION: 45,
      HIGH_RISK: 65,
      EXIT: 85,
      EMERGENCY: 100,
    },
  },

  // ── Market Regime Parameters ──
  REGIME: {
    NIFTY_SYMBOL: '^NSEI',
    INDIA_VIX_SYMBOL: '^INDIAVIX',
    VIX_PANIC_THRESHOLD: 28.0,
    VIX_ELEVATED_THRESHOLD: 22.0,
    PANIC_VOLATILITY_ANNUALIZED: 0.30, // 30% annualized vol
    BULL_VOLATILITY_CEILING: 0.25,
    BEAR_MOMENTUM_20D_THRESHOLD: -0.03, // -3% over 20d
    // Multipliers for directional signals conditioned on regime
    SIGNAL_MULTIPLIERS: {
      BULL_TREND: { UP: 1.15, DOWN: 0.85 },
      BULL_VOLATILE: { UP: 1.00, DOWN: 0.95 },
      SIDEWAYS: { UP: 1.00, DOWN: 1.00 },
      BEAR_TREND: { UP: 0.80, DOWN: 1.20 },
      PANIC: { UP: 0.50, DOWN: 1.35 },
    },
  },

  // ── Inference & Multi-Factor Blending ──
  INFERENCE: {
    BASE_PRIOR_PROBABILITY: 0.50,
    HORIZONS: {
      '1d': {
        DAYS: 1,
        MOMENTUM_WEIGHT: 0.40,
        TREND_WEIGHT: 0.20,
        VOL_PENALTY_WEIGHT: -0.15,
        MEAN_REV_WEIGHT: 0.25,
        ESTIMATED_STD_SCALE: 1.0,
      },
      '5d': {
        DAYS: 5,
        MOMENTUM_WEIGHT: 0.30,
        TREND_WEIGHT: 0.35,
        VOL_PENALTY_WEIGHT: -0.10,
        MEAN_REV_WEIGHT: 0.25,
        ESTIMATED_STD_SCALE: 1.9,
      },
      '20d': {
        DAYS: 20,
        MOMENTUM_WEIGHT: 0.15,
        TREND_WEIGHT: 0.50,
        VOL_PENALTY_WEIGHT: -0.05,
        MEAN_REV_WEIGHT: 0.30,
        ESTIMATED_STD_SCALE: 3.6,
      },
    },
    CONFIDENCE_INTERVAL_Z_SCORE: 1.645, // 90% two-sided normal quantile
  },

  // ── Ranking & Selection Objectives ──
  RANKING: {
    LOW_RISK: {
      MAX_DOWNSIDE_PROBABILITY: 0.55,
      MAX_ATR_PERCENT: 0.040,
      MAX_MAX_DRAWDOWN: 0.20,
      WEIGHT_EXPECTED_VALUE: 0.30,
      WEIGHT_SORTINO: 0.30,
      WEIGHT_RISK_SAFETY: 0.25,
      WEIGHT_LIQUIDITY: 0.15,
    },
    HIGH_ALPHA: {
      MIN_ATR_PERCENT: 0.015,
      MIN_REWARD_RISK_RATIO: 1.4,
      WEIGHT_EXPECTED_VALUE: 0.30,
      WEIGHT_REWARD_RISK: 0.25,
      WEIGHT_ASYMMETRY: 0.20,
      WEIGHT_MOMENTUM_CONFIRMATION: 0.15,
      WEIGHT_RELATIVE_STRENGTH: 0.10,
      PENALTY_EXCESSIVE_VOLATILITY: 0.15,
      PENALTY_DRAWDOWN: 0.15,
    },
  },

  // ── Decision Boundaries & Execution Rules ──
  DECISION: {
    PROBABILITY_THRESHOLDS: {
      STRONG_BUY: 0.75,
      BUY: 0.62,
      ACCUMULATE: 0.54,
      REDUCE: 0.46,
      SELL: 0.38,
      STRONG_SELL: 0.26,
    },
    REWARD_RISK_THRESHOLDS: {
      STRONG_BUY: 2.4,
      BUY: 1.8,
    },
    DOWNSIDE_THRESHOLDS: {
      STRONG_SELL: 0.75,
      SELL: 0.60,
      REDUCE: 0.50,
    },
    DATA_QUALITY_MIN_SCORE: 0.50,
  },

  // ── Institutional Trading Friction & Cost Modeling (NSE Reality) ──
  COSTS: {
    BROKERAGE_PCT: 0.0003,      // 0.03% institutional / discount broker rate
    STT_SELL_PCT: 0.0010,       // 0.10% Securities Transaction Tax on delivery sell
    EXCHANGE_TURNOVER_PCT: 0.0000345, // NSE turnover charges
    SEBI_TURNOVER_PCT: 0.000001,      // SEBI regulatory charges
    GST_ON_CHARGES_PCT: 0.18,   // 18% GST on brokerage + exchange fees
    SLIPPAGE_BPS: 5,            // 5 bps (0.05%) average market execution slippage
    // Total estimated one-way friction ~ 0.065%, round-trip ~ 0.13%
    TOTAL_ROUNDTRIP_FRICTION_PCT: 0.0013,
  },

  // ── Backtesting & Walk-Forward Validation Engine ──
  BACKTEST: {
    EVALUATION_STEP_DAYS: 3,     // Evaluate every 3 trading days for richer trade universe
    WARMUP_PERIOD_DAYS: 55,
    LOOKBACK_DATA_RANGE: '1y',
    MIN_CANDLES_REQUIRED: 75,
  },

  // ── Portfolio Construction & Sizing Bounds ──
  PORTFOLIO: {
    MAX_SINGLE_STOCK_WEIGHT: 0.10, // Max 10% allocation in any single stock (institutional standard)
    SECTOR_CONCENTRATION_CAP: 0.25, // Max 25% allocation in any single sector
    MAX_GROSS_EXPOSURE: 1.0,        // Max 100% gross exposure
    MAX_CONCURRENT_POSITIONS: 10,
    COST_PER_TRADE_PERCENT: 0.0013, // 0.13% round-trip friction
  },
} as const;

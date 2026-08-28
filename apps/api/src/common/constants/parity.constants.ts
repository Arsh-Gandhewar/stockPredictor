/**
 * QuantX Runtime Parity Constants & Numerical Tolerances — BUG 5 Mandate.
 * TypeScript mirror of packages/quant-engine/research/parity_constants.py.
 */

export const MODEL_PARITY_TOLERANCE = 1e-5;
export const CALIBRATION_PARITY_TOLERANCE = 1e-6;
export const ACCOUNTING_TOLERANCE = 1e-8;
export const SCHEMA_EXACT = true;
export const CANONICAL_FEATURE_COUNT = 25;

export const CANONICAL_FEATURE_SCHEMA: readonly string[] = [
  'rsi_14',
  'macd_hist',
  'sma_20_dist',
  'sma_50_dist',
  'ema_20_dist',
  'atr_percent',
  'bb_width',
  'stoch_k',
  'volume_z_score',
  'annualized_volatility',
  'downside_deviation',
  'beta_nifty',
  'relative_strength_nifty',
  'momentum_5',
  'momentum_20',
  'ret_1d',
  'ret_5d',
  'ret_20d',
  'gap_pct',
  'dist_52w_high',
  'dist_52w_low',
  'roc_12',
  'rel_volume',
  'vol_20d',
  'vol_60d',
] as const;

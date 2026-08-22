import { MODEL_CONFIG } from './model-config';

/**
 * Model Governance & Registry Specification
 * Tracks version history, training validation test boundaries,
 * parameter lineage, calibration states, and model operational health.
 */

export interface ModelMetadata {
  modelVersion: string;
  calibrationVersion: string;
  featureSchemaVersion: string;
  status: 'ACTIVE' | 'CANDIDATE' | 'DEPRECATED';
  description: string;
  trainingWindow: string;
  validationWindow: string;
  testWindow: string;
  holdoutWindow: string;
  calibrationMethod: string;
  registeredAt: string;
  activeFeatures: string[];
  parameters: typeof MODEL_CONFIG;
}

export class ModelRegistry {
  private static readonly ACTIVE_MODEL: ModelMetadata = {
    modelVersion: MODEL_CONFIG.VERSION,
    calibrationVersion: MODEL_CONFIG.CALIBRATION_VERSION,
    featureSchemaVersion: MODEL_CONFIG.FEATURE_SCHEMA_VERSION,
    status: 'ACTIVE',
    description: 'QuantX Multi-Factor Probabilistic Empirical Framework v4.0 with Walk-Forward Optimization and Friction Modeling',
    trainingWindow: 'Rolling 120-day walk-forward window',
    validationWindow: 'Rolling 60-day parameter selection window',
    testWindow: 'Rolling 40-day out-of-sample forward step',
    holdoutWindow: 'Final 40-day untouched verification partition',
    calibrationMethod: 'Isotonic Regression with Piecewise Linear PAV Interpolation',
    registeredAt: '2026-08-22T00:00:00.000Z',
    activeFeatures: [
      'rsi_14',
      'macd_hist',
      'sma_20_dist',
      'sma_50_dist',
      'ema_20_dist',
      'atr_14',
      'atr_percent',
      'bb_width',
      'stoch_k',
      'stoch_d',
      'volume_z_score',
      'volume_stability',
      'liquidity_score',
      'annualized_volatility',
      'downside_deviation',
      'max_drawdown_20d',
      'max_drawdown_60d',
      'gap_risk',
      'tail_risk_5pct',
      'beta_nifty',
      'relative_strength_nifty',
      'momentum_5',
      'momentum_10',
      'momentum_20',
      'news_sentiment',
    ],
    parameters: MODEL_CONFIG,
  };

  static getActiveModel(): ModelMetadata {
    return this.ACTIVE_MODEL;
  }

  static getModelVersion(): string {
    return this.ACTIVE_MODEL.modelVersion;
  }

  static getCalibrationVersion(): string {
    return this.ACTIVE_MODEL.calibrationVersion;
  }
}

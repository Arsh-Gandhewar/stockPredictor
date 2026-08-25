import { MODEL_CONFIG } from './model-config';

/**
 * Model Governance & Registry Specification
 * Tracks version history, training validation test boundaries,
 * parameter lineage, calibration states, and model operational health.
 */

export type ModelType = 'BASELINE_HEURISTIC' | 'LEARNED_LIGHTGBM';

export interface ModelMetadata {
  modelVersion: string;
  modelType: ModelType;
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
    modelType: 'LEARNED_LIGHTGBM',
    calibrationVersion: MODEL_CONFIG.CALIBRATION_VERSION,
    featureSchemaVersion: MODEL_CONFIG.FEATURE_SCHEMA_VERSION,
    status: 'ACTIVE',
    description: 'QuantX Institutional Multi-Horizon LightGBM Engine with Out-of-Sample Isotonic Calibration and ONNX Runtime Inference (v5.0.0)',
    trainingWindow: 'Rolling 24-month walk-forward train window',
    validationWindow: 'Rolling 6-month calibration and hyperparameter validation window',
    testWindow: 'Rolling 6-month out-of-sample forward step',
    holdoutWindow: 'Final 6-month untouched verification partition',
    calibrationMethod: 'Monotonic Isotonic Regression (PAV) with Empirical-Bayes tail shrinkage fitted out-of-sample',
    registeredAt: '2026-08-22T08:00:00.000Z',
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

  static getModelType(): ModelType {
    return this.ACTIVE_MODEL.modelType;
  }

  static getCalibrationVersion(): string {
    return this.ACTIVE_MODEL.calibrationVersion;
  }
}

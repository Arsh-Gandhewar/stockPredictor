export interface TrainingSample {
  features: Record<string, number | null>;
  outcome: number; // 1 if positive return by horizon, 0 otherwise
}

export interface IQuantitativeModel {
  name: string;
  version: string;
  modelType: 'BASELINE_HEURISTIC' | 'LEARNED_BASELINE';
  fit(samples: TrainingSample[]): void;
  predict(features: Record<string, number | null>): number;
  getWeights(): Record<string, number>;
  serialize(): any;
  deserialize(data: any): void;
}

/**
 * Learned Model: Ridge L2-Regularized Logistic Regression on Standardized Multi-Factor Features
 */
export class LogisticRegressionModel implements IQuantitativeModel {
  readonly name = 'RidgeLogisticRegression';
  readonly version = 'v1.0.0-learned';
  readonly modelType = 'LEARNED_BASELINE' as const;

  private weights: Record<string, number> = {};
  private bias: number = 0;
  private featureMeans: Record<string, number> = {};
  private featureStdDevs: Record<string, number> = {};
  private isFitted: boolean = false;

  private readonly featureKeys = [
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
  ];

  constructor() {
    // Initialize default small weights
    this.featureKeys.forEach((key) => {
      this.weights[key] = 0;
      this.featureMeans[key] = 0;
      this.featureStdDevs[key] = 1;
    });
  }

  fit(samples: TrainingSample[], learningRate: number = 0.05, lambda: number = 0.01, epochs: number = 100): void {
    if (!samples || samples.length < 20) return;

    // 1. Calculate Feature Means and Standard Deviations from Training Samples Only
    this.featureKeys.forEach((key) => {
      const validVals = samples
        .map((s) => s.features[key])
        .filter((v): v is number => v !== null && v !== undefined && !isNaN(v));

      if (validVals.length > 0) {
        const mean = validVals.reduce((a, b) => a + b, 0) / validVals.length;
        const variance = validVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validVals.length;
        this.featureMeans[key] = mean;
        this.featureStdDevs[key] = Math.sqrt(variance) || 1.0;
      }
    });

    // 2. Standardize Features for Training
    const X: number[][] = [];
    const y: number[] = [];

    samples.forEach((sample) => {
      const row: number[] = [];
      this.featureKeys.forEach((key) => {
        const val = sample.features[key];
        const num = val !== null && val !== undefined && !isNaN(val) ? val : this.featureMeans[key];
        const normalized = (num - this.featureMeans[key]) / (this.featureStdDevs[key] || 1.0);
        row.push(normalized);
      });
      X.push(row);
      y.push(sample.outcome);
    });

    // 3. Gradient Descent Optimization with L2 Regularization
    const nSamples = X.length;
    const nFeatures = this.featureKeys.length;
    const w = new Array(nFeatures).fill(0);
    let b = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const dw = new Array(nFeatures).fill(0);
      let db = 0;

      for (let i = 0; i < nSamples; i++) {
        let z = b;
        for (let j = 0; j < nFeatures; j++) {
          z += w[j] * X[i][j];
        }
        const p = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, z))));
        const err = p - y[i];

        for (let j = 0; j < nFeatures; j++) {
          dw[j] += err * X[i][j];
        }
        db += err;
      }

      // Update parameters with L2 penalty
      for (let j = 0; j < nFeatures; j++) {
        w[j] -= learningRate * (dw[j] / nSamples + lambda * w[j]);
      }
      b -= learningRate * (db / nSamples);
    }

    // Save Fitted Weights
    this.featureKeys.forEach((key, idx) => {
      this.weights[key] = parseFloat(w[idx].toFixed(4));
    });
    this.bias = parseFloat(b.toFixed(4));
    this.isFitted = true;
  }

  predict(features: Record<string, number | null>): number {
    let z = this.bias;
    this.featureKeys.forEach((key) => {
      const val = features[key];
      const num = val !== null && val !== undefined && !isNaN(val) ? val : this.featureMeans[key] || 0;
      const normalized = (num - (this.featureMeans[key] || 0)) / (this.featureStdDevs[key] || 1.0);
      z += (this.weights[key] || 0) * normalized;
    });

    const prob = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, z))));
    return parseFloat(Math.max(0.05, Math.min(0.95, prob)).toFixed(4));
  }

  getWeights(): Record<string, number> {
    return { ...this.weights, bias: this.bias };
  }

  getIsFitted(): boolean {
    return this.isFitted;
  }

  serialize(): any {
    return {
      name: this.name,
      version: this.version,
      modelType: this.modelType,
      weights: this.weights,
      bias: this.bias,
      featureMeans: this.featureMeans,
      featureStdDevs: this.featureStdDevs,
      isFitted: this.isFitted,
    };
  }

  deserialize(data: any): void {
    if (data && data.weights) {
      this.weights = data.weights;
      this.bias = data.bias || 0;
      this.featureMeans = data.featureMeans || {};
      this.featureStdDevs = data.featureStdDevs || {};
      this.isFitted = data.isFitted || false;
    }
  }
}

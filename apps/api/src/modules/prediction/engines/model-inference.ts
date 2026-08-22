import { Injectable, Logger } from '@nestjs/common';
import { ModelRegistry } from './model-registry';
import { MODEL_CONFIG } from './model-config';
import { LogisticRegressionModel } from './learned-model';
import { EmpiricalDistributionBucket, STATISTICAL_GATES } from './model-artifact.service';

export interface ExpectedReturnEstimation {
  probability: number;
  expectedGainConditionalUp: number;
  expectedLossConditionalDown: number;
  expectedValue: number;
  expectedVolatility: number;
  confidenceInterval: [number, number];
  marketVolatility: number;
  estimationUncertainty: number;
  uncertainty: number;
  sampleCount: number;
  method: 'EMPIRICAL_FINE_BUCKET' | 'EMPIRICAL_BROAD_BUCKET' | 'EMPIRICAL_HORIZON_WIDE' | 'FALLBACK_DIFFUSION';
  reason?: string;
}

@Injectable()
export class ModelInferenceEngine {
  private readonly logger = new Logger(ModelInferenceEngine.name);

  // Active learned model instance (Ridge Logistic Regression)
  private readonly learnedModel = new LogisticRegressionModel();

  // Fitted empirical conditional return distributions
  private empiricalBuckets: EmpiricalDistributionBucket[] = [];

  private calculateTrimmedMean(values: number[], trimRatio: number = 0.10): number {
    if (!values || values.length === 0) return 0;
    if (values.length < 5) return values.reduce((s, x) => s + x, 0) / values.length;

    const sorted = [...values].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * trimRatio);
    const trimmed = sorted.slice(k, sorted.length - k);
    return trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  }

  private calculateStandardDeviation(values: number[]): number {
    if (!values || values.length < 2) return 0.015;
    const mean = values.reduce((s, x) => s + x, 0) / values.length;
    const variance = values.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Evaluates multi-factor score to generate raw directional probability for BASELINE_HEURISTIC
   */
  evaluate(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): number {
    const weights: Record<string, number> = {
      momentum_5: 0.18,
      momentum_20: 0.12,
      sma_50_dist: 0.16,
      rsi_14: 0.12,
      macd_hist: 0.14,
      volume_z_score: 0.08,
      relative_strength_nifty: 0.12,
      news_sentiment: 0.08,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [feat, weight] of Object.entries(weights)) {
      const val = features[feat];
      if (val !== null && val !== undefined && !isNaN(val)) {
        let normVal = 0;
        if (feat === 'rsi_14') {
          normVal = (val - 50) / 25;
        } else if (feat === 'momentum_5' || feat === 'momentum_20') {
          normVal = val / 0.05;
        } else if (feat === 'sma_50_dist') {
          normVal = val / 0.06;
        } else if (feat === 'macd_hist') {
          normVal = val / 0.02;
        } else if (feat === 'volume_z_score') {
          normVal = val / 2.0;
        } else if (feat === 'relative_strength_nifty') {
          normVal = val / 0.04;
        } else if (feat === 'news_sentiment') {
          normVal = val;
        }

        const clippedNorm = Math.max(-2.5, Math.min(2.5, normVal));
        weightedSum += clippedNorm * weight;
        totalWeight += weight;
      }
    }

    const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const horizonScaling = horizon === '1d' ? 0.60 : horizon === '5d' ? 1.0 : 1.35;
    const scaledScore = rawScore * horizonScaling;
    const probability = 1 / (1 + Math.exp(-scaledScore));

    return parseFloat(Math.max(0.05, Math.min(0.95, probability)).toFixed(4));
  }

  /**
   * Evaluates probability using the learned Ridge Logistic Regression model
   */
  evaluateLearned(features: Record<string, number | null>): number {
    return this.learnedModel.predict(features);
  }

  getLearnedModel(): LogisticRegressionModel {
    return this.learnedModel;
  }

  /**
   * Populates empirical conditional return distributions from validation trade outcomes.
   */
  fitEmpiricalDistributions(
    samples: { prob: number; horizon: '1d' | '5d' | '20d'; actualReturn: number }[]
  ) {
    if (!samples || samples.length < STATISTICAL_GATES.MIN_EMPIRICAL_RETURN_SAMPLES) {
      this.logger.warn(`Empirical return fitting rejected: insufficient samples (${samples?.length || 0} < ${STATISTICAL_GATES.MIN_EMPIRICAL_RETURN_SAMPLES})`);
      return;
    }

    const horizons: ('1d' | '5d' | '20d')[] = ['1d', '5d', '20d'];
    const updatedBuckets: EmpiricalDistributionBucket[] = [];

    for (const h of horizons) {
      const hSamples = samples.filter((s) => s.horizon === h);
      if (hSamples.length < STATISTICAL_GATES.MIN_HORIZON_WIDE_SAMPLES) continue;

      // 1. Horizon-wide bucket
      const posWide = hSamples.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
      const negWide = hSamples.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));
      const wideDispersion = this.calculateStandardDeviation(hSamples.map((s) => s.actualReturn));

      updatedBuckets.push({
        horizon: h,
        probLower: 0.0,
        probUpper: 1.0,
        bucketType: 'HORIZON_WIDE',
        meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(posWide) || 0.02).toFixed(4)),
        meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(negWide) || 0.015).toFixed(4)),
        dispersion: parseFloat(wideDispersion.toFixed(4)),
        sampleCount: hSamples.length,
        uncertainty: parseFloat((wideDispersion / Math.sqrt(hSamples.length)).toFixed(4)),
        fittedAt: new Date().toISOString(),
      });

      // 2. Broad probability buckets ([0, 0.45), [0.45, 0.55], (0.55, 1.0])
      const broadRanges: [number, number][] = [[0.0, 0.45], [0.45, 0.55], [0.55, 1.0]];
      for (const [low, high] of broadRanges) {
        const bSamples = hSamples.filter((s) => s.prob >= low && s.prob <= high);
        if (bSamples.length >= STATISTICAL_GATES.MIN_BROAD_BUCKET_SAMPLES) {
          const pos = bSamples.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
          const neg = bSamples.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));
          const dispersion = this.calculateStandardDeviation(bSamples.map((s) => s.actualReturn));

          updatedBuckets.push({
            horizon: h,
            probLower: low,
            probUpper: high,
            bucketType: 'BROAD',
            meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(pos) || 0.02).toFixed(4)),
            meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(neg) || 0.015).toFixed(4)),
            dispersion: parseFloat(dispersion.toFixed(4)),
            sampleCount: bSamples.length,
            uncertainty: parseFloat((dispersion / Math.sqrt(bSamples.length)).toFixed(4)),
            fittedAt: new Date().toISOString(),
          });
        }
      }

      // 3. Fine probability buckets (width 0.10)
      for (let p = 0.20; p < 0.80; p += 0.10) {
        const low = parseFloat(p.toFixed(2));
        const high = parseFloat((p + 0.10).toFixed(2));
        const fSamples = hSamples.filter((s) => s.prob >= low && s.prob < high);

        if (fSamples.length >= STATISTICAL_GATES.MIN_FINE_BUCKET_SAMPLES) {
          const pos = fSamples.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
          const neg = fSamples.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));
          const dispersion = this.calculateStandardDeviation(fSamples.map((s) => s.actualReturn));

          updatedBuckets.push({
            horizon: h,
            probLower: low,
            probUpper: high,
            bucketType: 'FINE',
            meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(pos) || 0.02).toFixed(4)),
            meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(neg) || 0.015).toFixed(4)),
            dispersion: parseFloat(dispersion.toFixed(4)),
            sampleCount: fSamples.length,
            uncertainty: parseFloat((dispersion / Math.sqrt(fSamples.length)).toFixed(4)),
            fittedAt: new Date().toISOString(),
          });
        }
      }
    }

    if (updatedBuckets.length > 0) {
      this.empiricalBuckets = updatedBuckets;
      this.logger.log(`Fitted ${updatedBuckets.length} empirical conditional return buckets from ${samples.length} out-of-sample observations.`);
    }
  }

  setEmpiricalBuckets(buckets: EmpiricalDistributionBucket[]) {
    this.empiricalBuckets = buckets || [];
  }

  getEmpiricalBuckets(): EmpiricalDistributionBucket[] {
    return this.empiricalBuckets;
  }

  /**
   * Hierarchically estimates conditional expected returns and separates market volatility from estimation uncertainty.
   */
  estimateExpectedReturn(
    probability: number,
    horizon: '1d' | '5d' | '20d',
    assetVolatility: number
  ): ExpectedReturnEstimation {
    const p = Math.max(0.01, Math.min(0.99, probability));
    const horizonDays = horizon === '1d' ? 1 : horizon === '5d' ? 5 : 20;
    const marketVol = parseFloat((assetVolatility * Math.sqrt(horizonDays)).toFixed(4));

    // Hierarchical search: FINE -> BROAD -> HORIZON_WIDE -> FALLBACK_DIFFUSION
    const fineBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'FINE' && p >= b.probLower && p < b.probUpper && b.sampleCount >= STATISTICAL_GATES.MIN_FINE_BUCKET_SAMPLES
    );

    if (fineBucket) {
      const expGain = fineBucket.meanGainConditionalUp;
      const expLoss = fineBucket.meanLossConditionalDown;
      const ev = p * expGain - (1 - p) * expLoss;
      const estUncertainty = fineBucket.uncertainty;

      return {
        probability: p,
        expectedGainConditionalUp: expGain,
        expectedLossConditionalDown: expLoss,
        expectedValue: parseFloat(ev.toFixed(4)),
        expectedVolatility: marketVol,
        confidenceInterval: [
          parseFloat((ev - 1.96 * marketVol).toFixed(4)),
          parseFloat((ev + 1.96 * marketVol).toFixed(4)),
        ],
        marketVolatility: marketVol,
        estimationUncertainty: estUncertainty,
        uncertainty: estUncertainty,
        sampleCount: fineBucket.sampleCount,
        method: 'EMPIRICAL_FINE_BUCKET',
      };
    }

    const broadBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'BROAD' && p >= b.probLower && p <= b.probUpper && b.sampleCount >= STATISTICAL_GATES.MIN_BROAD_BUCKET_SAMPLES
    );

    if (broadBucket) {
      const expGain = broadBucket.meanGainConditionalUp;
      const expLoss = broadBucket.meanLossConditionalDown;
      const ev = p * expGain - (1 - p) * expLoss;
      const estUncertainty = broadBucket.uncertainty;

      return {
        probability: p,
        expectedGainConditionalUp: expGain,
        expectedLossConditionalDown: expLoss,
        expectedValue: parseFloat(ev.toFixed(4)),
        expectedVolatility: marketVol,
        confidenceInterval: [
          parseFloat((ev - 1.96 * marketVol).toFixed(4)),
          parseFloat((ev + 1.96 * marketVol).toFixed(4)),
        ],
        marketVolatility: marketVol,
        estimationUncertainty: estUncertainty,
        uncertainty: estUncertainty,
        sampleCount: broadBucket.sampleCount,
        method: 'EMPIRICAL_BROAD_BUCKET',
        reason: 'Sparse fine bucket; using empirical broad interval',
      };
    }

    const wideBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'HORIZON_WIDE' && b.sampleCount >= STATISTICAL_GATES.MIN_HORIZON_WIDE_SAMPLES
    );

    if (wideBucket) {
      const expGain = wideBucket.meanGainConditionalUp;
      const expLoss = wideBucket.meanLossConditionalDown;
      const ev = p * expGain - (1 - p) * expLoss;
      const estUncertainty = wideBucket.uncertainty;

      return {
        probability: p,
        expectedGainConditionalUp: expGain,
        expectedLossConditionalDown: expLoss,
        expectedValue: parseFloat(ev.toFixed(4)),
        expectedVolatility: marketVol,
        confidenceInterval: [
          parseFloat((ev - 1.96 * marketVol).toFixed(4)),
          parseFloat((ev + 1.96 * marketVol).toFixed(4)),
        ],
        marketVolatility: marketVol,
        estimationUncertainty: estUncertainty,
        uncertainty: estUncertainty,
        sampleCount: wideBucket.sampleCount,
        method: 'EMPIRICAL_HORIZON_WIDE',
        reason: 'Sparse probability bucket; using horizon-wide empirical estimate',
      };
    }

    // Explicit Diffusion Fallback
    const drift = (p - 0.50) * 2 * (assetVolatility * Math.sqrt(horizonDays));
    const defaultEv = parseFloat(drift.toFixed(4));
    const conditionalDiff = parseFloat((assetVolatility * Math.sqrt(horizonDays) * 0.90).toFixed(4));
    const diffusionUncertainty = parseFloat((marketVol * 0.35).toFixed(4));

    return {
      probability: p,
      expectedGainConditionalUp: conditionalDiff,
      expectedLossConditionalDown: conditionalDiff,
      expectedValue: defaultEv,
      expectedVolatility: marketVol,
      confidenceInterval: [
        parseFloat((defaultEv - 1.96 * marketVol).toFixed(4)),
        parseFloat((defaultEv + 1.96 * marketVol).toFixed(4)),
      ],
      marketVolatility: marketVol,
      estimationUncertainty: diffusionUncertainty,
      uncertainty: diffusionUncertainty,
      sampleCount: 0,
      method: 'FALLBACK_DIFFUSION',
      reason: 'No empirical distribution fitted for this horizon; using Brownian diffusion fallback',
    };
  }

  calculateFeatureContributions(
    features: Record<string, number | null>
  ): { feature: string; contribution: number }[] {
    const names: Record<string, string> = {
      momentum_5: '5-Day Momentum',
      momentum_20: '20-Day Momentum',
      sma_50_dist: '50-day SMA Distance',
      rsi_14: 'RSI (14)',
      macd_hist: 'MACD Momentum',
      volume_z_score: 'Volume Z-Score',
      relative_strength_nifty: 'Relative Strength vs Nifty',
      news_sentiment: 'News Sentiment',
    };

    const contributions: { feature: string; contribution: number }[] = [];
    for (const [key, label] of Object.entries(names)) {
      const val = features[key];
      let contr = 0;
      if (val !== null && val !== undefined && !isNaN(val)) {
        if (key === 'rsi_14') contr = (val - 50) * 0.005;
        else if (key === 'news_sentiment') contr = val * 0.12;
        else contr = val * 1.2;
      }
      contributions.push({
        feature: label,
        contribution: parseFloat(Math.max(-0.25, Math.min(0.25, contr)).toFixed(3)),
      });
    }

    return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  getModelVersion(): string {
    return ModelRegistry.getModelVersion();
  }
}

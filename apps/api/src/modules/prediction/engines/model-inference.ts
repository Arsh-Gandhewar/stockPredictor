import { Injectable, Logger } from '@nestjs/common';
import { ModelRegistry } from './model-registry';
import { MODEL_CONFIG } from './model-config';
import { LogisticRegressionModel } from './learned-model';
import { EmpiricalDistributionBucket, STATISTICAL_GATES } from './model-artifact.service';
import { ModelFeatureVector25 } from './feature-engine';

export interface ExpectedReturnEstimation {
  probability?: number | null;
  expectedGainConditionalUp?: number | null;
  expectedLossConditionalDown?: number | null;
  expectedValue?: number | null;
  expectedVolatility?: number | null;
  confidenceInterval?: [number, number] | null;
  marketVolatility?: number | null;
  estimationUncertainty?: number | null;
  uncertainty?: number | null;
  sampleCount?: number;
  method: 'EMPIRICAL_FINE_BUCKET' | 'EMPIRICAL_BROAD_BUCKET' | 'EMPIRICAL_HORIZON_WIDE' | 'FALLBACK_DIFFUSION' | 'INSUFFICIENT_DATA';
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

  private calculateStandardDeviation(values: number[]): number | null {
    if (!values || values.length < 2) return null;
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
        meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(posWide)).toFixed(4)),
        meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(negWide)).toFixed(4)),
        dispersion: wideDispersion !== null ? parseFloat(wideDispersion.toFixed(4)) : 0,
        sampleCount: hSamples.length,
        uncertainty: wideDispersion !== null ? parseFloat((wideDispersion / Math.sqrt(hSamples.length)).toFixed(4)) : 0,
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
            meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(pos)).toFixed(4)),
            meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(neg)).toFixed(4)),
            dispersion: dispersion !== null ? parseFloat(dispersion.toFixed(4)) : 0,
            sampleCount: bSamples.length,
            uncertainty: dispersion !== null ? parseFloat((dispersion / Math.sqrt(bSamples.length)).toFixed(4)) : 0,
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
            meanGainConditionalUp: parseFloat((this.calculateTrimmedMean(pos)).toFixed(4)),
            meanLossConditionalDown: parseFloat((this.calculateTrimmedMean(neg)).toFixed(4)),
            dispersion: dispersion !== null ? parseFloat(dispersion.toFixed(4)) : 0,
            sampleCount: fSamples.length,
            uncertainty: dispersion !== null ? parseFloat((dispersion / Math.sqrt(fSamples.length)).toFixed(4)) : 0,
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
    assetVolatility: number = 0.02
  ): ExpectedReturnEstimation | any {
    const p = Math.max(0.01, Math.min(0.99, probability));
    const horizonDays = horizon === '1d' ? 1 : horizon === '5d' ? 5 : 20;
    const marketVol = parseFloat((assetVolatility * Math.sqrt(horizonDays)).toFixed(4));
    const volScale = Math.max(0.35, Math.min(3.5, assetVolatility / 0.020));

    // Hierarchical search: FINE -> BROAD -> HORIZON_WIDE
    const fineBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'FINE' && p >= b.probLower && p < b.probUpper && b.sampleCount >= STATISTICAL_GATES.MIN_FINE_BUCKET_SAMPLES
    );

    if (fineBucket) {
      const expGain = parseFloat((fineBucket.meanGainConditionalUp * volScale).toFixed(4));
      const expLoss = parseFloat((fineBucket.meanLossConditionalDown * volScale).toFixed(4));
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
      const expGain = parseFloat((broadBucket.meanGainConditionalUp * volScale).toFixed(4));
      const expLoss = parseFloat((broadBucket.meanLossConditionalDown * volScale).toFixed(4));
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

    const horizonWide = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'HORIZON_WIDE' && b.sampleCount >= STATISTICAL_GATES.MIN_HORIZON_WIDE_SAMPLES
    );

    if (horizonWide) {
      const expGain = parseFloat((horizonWide.meanGainConditionalUp * volScale).toFixed(4));
      const expLoss = parseFloat((horizonWide.meanLossConditionalDown * volScale).toFixed(4));
      const ev = p * expGain - (1 - p) * expLoss;
      const estUncertainty = horizonWide.uncertainty;

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
        sampleCount: horizonWide.sampleCount,
        method: 'EMPIRICAL_HORIZON_WIDE',
        reason: 'Sparse broad bucket; using horizon aggregate',
      };
    }

    return {
      method: 'INSUFFICIENT_DATA',
      expectedReturn: null,
      uncertainty: null,
    };
  }

  calculateFeatureContributions(
    features: ModelFeatureVector25
  ): { feature: string; contribution: number }[] {
    return [];
  }

  getModelVersion(): string {
    return ModelRegistry.getModelVersion();
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { FeatureContribution } from '../prediction.types';
import { MODEL_CONFIG } from './model-config';
import { ModelRegistry } from './model-registry';
import { LogisticRegressionModel } from './learned-model';

export type EstimationMethod =
  | 'EMPIRICAL_FINE_BUCKET'
  | 'EMPIRICAL_BROAD_BUCKET'
  | 'EMPIRICAL_HORIZON_WIDE'
  | 'FALLBACK_DIFFUSION';

export interface EmpiricalDistributionBucket {
  horizon: '1d' | '5d' | '20d';
  probLower: number;
  probUpper: number;
  bucketType: 'FINE' | 'BROAD' | 'HORIZON_WIDE';
  meanGainConditionalUp: number;
  meanLossConditionalDown: number;
  sampleCount: number;
  uncertainty: number;
  fittedAt: string;
}

export interface ExpectedReturnEstimation {
  probability: number;
  expectedGainConditionalUp: number;
  expectedLossConditionalDown: number;
  expectedValue: number;
  expectedVolatility: number;
  uncertainty: number;
  sampleCount: number;
  confidenceInterval: [number, number];
  method: EstimationMethod;
}

@Injectable()
export class ModelInferenceEngine {
  private readonly logger = new Logger(ModelInferenceEngine.name);

  // Dynamic empirical conditional return distributions (Initialized empty - populated strictly via fitting)
  private empiricalBuckets: EmpiricalDistributionBucket[] = [];
  private learnedModel: LogisticRegressionModel = new LogisticRegressionModel();

  /**
   * Evaluates statistical probability of price appreciation using baseline multi-factor model.
   * Model Type: BASELINE_HEURISTIC
   */
  evaluate(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): number {
    const horizonConfig = MODEL_CONFIG.INFERENCE.HORIZONS[horizon] || MODEL_CONFIG.INFERENCE.HORIZONS['5d'];
    let logit = 0;

    // 1. Momentum Signal Component (-1.0 to +1.0)
    let momentumScore = 0;
    const rsi = features['rsi_14'];
    if (rsi !== null && rsi !== undefined) {
      momentumScore += ((rsi - 50) / 50) * 0.40;
    }

    const macdHist = features['macd_hist'];
    const atr14 = features['atr_14'] || 1.0;
    if (macdHist !== null && macdHist !== undefined) {
      momentumScore += Math.tanh(macdHist / Math.max(0.1, atr14)) * 0.35;
    }

    const stochK = features['stoch_k'];
    if (stochK !== null && stochK !== undefined) {
      momentumScore += ((stochK - 50) / 50) * 0.25;
    }

    // 2. Trend Alignment Component (-1.0 to +1.0)
    let trendScore = 0;
    const sma50Dist = features['sma_50_dist'];
    if (sma50Dist !== null && sma50Dist !== undefined) {
      trendScore += Math.tanh(sma50Dist * 12.0) * 0.45;
    }

    const sma20Dist = features['sma_20_dist'];
    if (sma20Dist !== null && sma20Dist !== undefined) {
      trendScore += Math.tanh(sma20Dist * 15.0) * 0.35;
    }

    const relStrength = features['relative_strength_nifty'];
    if (relStrength !== null && relStrength !== undefined) {
      trendScore += Math.tanh(relStrength * 10.0) * 0.20;
    }

    // 3. Mean-Reversion Component (-1.0 to +1.0)
    let meanRevScore = 0;
    if (rsi !== null && rsi !== undefined) {
      if (rsi < 30) meanRevScore += (30 - rsi) / 30;
      else if (rsi > 70) meanRevScore -= (rsi - 70) / 30;
    }

    // 4. Volatility Penalty (-1.0 to 0)
    const annualizedVol = features['annualized_volatility'] || 0.20;
    const volPenalty = Math.min(1.0, annualizedVol / 0.40);

    // 5. News Sentiment Impact (-1.0 to +1.0)
    const sentiment = features['news_sentiment'];
    let sentimentScore = 0;
    if (sentiment !== null && sentiment !== undefined) {
      sentimentScore = Math.tanh(sentiment / 20.0);
    }

    // Multi-Factor Composite Logit Blending
    logit =
      horizonConfig.MOMENTUM_WEIGHT * momentumScore +
      horizonConfig.TREND_WEIGHT * trendScore +
      horizonConfig.MEAN_REV_WEIGHT * meanRevScore +
      horizonConfig.VOL_PENALTY_WEIGHT * volPenalty +
      0.15 * sentimentScore;

    const rawProb = 1 / (1 + Math.exp(-logit * 2.0));
    return parseFloat(Math.min(0.95, Math.max(0.05, rawProb)).toFixed(4));
  }

  /**
   * Predicts probability using the learned logistic regression model.
   */
  evaluateLearned(features: Record<string, number | null>): number {
    return this.learnedModel.predict(features);
  }

  getLearnedModel(): LogisticRegressionModel {
    return this.learnedModel;
  }

  /**
   * Fits robust empirical conditional gain and loss distributions from out-of-sample observations.
   * Computes trimmed mean (discarding top/bottom 10% outliers) for stability.
   */
  fitEmpiricalDistributions(
    samples: { prob: number; horizon: '1d' | '5d' | '20d'; actualReturn: number }[]
  ) {
    if (!samples || samples.length < 5) return;

    const horizons: ('1d' | '5d' | '20d')[] = ['1d', '5d', '20d'];
    const updatedBuckets: EmpiricalDistributionBucket[] = [];
    const timestamp = new Date().toISOString();

    for (const h of horizons) {
      const hSamples = samples.filter((s) => s.horizon === h);
      if (hSamples.length === 0) continue;

      // 1. Horizon-Wide Estimate
      const hGains = hSamples.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
      const hLosses = hSamples.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));

      const meanHGain = this.computeTrimmedMean(hGains, 0.015);
      const meanHLoss = this.computeTrimmedMean(hLosses, 0.015);
      const hUncertainty = this.computeStandardError(hSamples.map((s) => s.actualReturn));

      updatedBuckets.push({
        horizon: h,
        probLower: 0.0,
        probUpper: 1.0,
        bucketType: 'HORIZON_WIDE',
        meanGainConditionalUp: parseFloat(meanHGain.toFixed(4)),
        meanLossConditionalDown: parseFloat(meanHLoss.toFixed(4)),
        sampleCount: hSamples.length,
        uncertainty: parseFloat(hUncertainty.toFixed(4)),
        fittedAt: timestamp,
      });

      // 2. Broad Probability Buckets ([0, 0.45), [0.45, 0.55), [0.55, 1.0])
      const broadDefs = [
        { lower: 0.0, upper: 0.45 },
        { lower: 0.45, upper: 0.55 },
        { lower: 0.55, upper: 1.0 },
      ];

      for (const b of broadDefs) {
        const matching = hSamples.filter((s) => s.prob >= b.lower && s.prob < b.upper);
        if (matching.length >= 3) {
          const gains = matching.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
          const losses = matching.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));
          const meanGain = this.computeTrimmedMean(gains, meanHGain);
          const meanLoss = this.computeTrimmedMean(losses, meanHLoss);
          const se = this.computeStandardError(matching.map((s) => s.actualReturn));

          updatedBuckets.push({
            horizon: h,
            probLower: b.lower,
            probUpper: b.upper,
            bucketType: 'BROAD',
            meanGainConditionalUp: parseFloat(meanGain.toFixed(4)),
            meanLossConditionalDown: parseFloat(meanLoss.toFixed(4)),
            sampleCount: matching.length,
            uncertainty: parseFloat(se.toFixed(4)),
            fittedAt: timestamp,
          });
        }
      }

      // 3. Fine Probability Buckets (Width 0.10: [0, 0.3), [0.3, 0.4), [0.4, 0.5), [0.5, 0.6), [0.6, 0.7), [0.7, 1.0])
      const fineDefs = [
        { lower: 0.0, upper: 0.35 },
        { lower: 0.35, upper: 0.45 },
        { lower: 0.45, upper: 0.55 },
        { lower: 0.55, upper: 0.65 },
        { lower: 0.65, upper: 1.0 },
      ];

      for (const f of fineDefs) {
        const matching = hSamples.filter((s) => s.prob >= f.lower && s.prob < f.upper);
        if (matching.length >= 10) {
          const gains = matching.filter((s) => s.actualReturn > 0).map((s) => s.actualReturn);
          const losses = matching.filter((s) => s.actualReturn <= 0).map((s) => Math.abs(s.actualReturn));
          const meanGain = this.computeTrimmedMean(gains, meanHGain);
          const meanLoss = this.computeTrimmedMean(losses, meanHLoss);
          const se = this.computeStandardError(matching.map((s) => s.actualReturn));

          updatedBuckets.push({
            horizon: h,
            probLower: f.lower,
            probUpper: f.upper,
            bucketType: 'FINE',
            meanGainConditionalUp: parseFloat(meanGain.toFixed(4)),
            meanLossConditionalDown: parseFloat(meanLoss.toFixed(4)),
            sampleCount: matching.length,
            uncertainty: parseFloat(se.toFixed(4)),
            fittedAt: timestamp,
          });
        }
      }
    }

    if (updatedBuckets.length > 0) {
      this.empiricalBuckets = updatedBuckets;
      this.logger.log(`Fitted ${updatedBuckets.length} empirical conditional return buckets from ${samples.length} out-of-sample observations.`);
    }
  }

  /**
   * Hierarchical Conditional Return Estimation:
   * Level 1: Fine Probability Bucket (N >= 15) -> EMPIRICAL_FINE_BUCKET
   * Level 2: Broad Probability Bucket (N >= 5) -> EMPIRICAL_BROAD_BUCKET
   * Level 3: Horizon-Wide Estimate (N >= 5) -> EMPIRICAL_HORIZON_WIDE
   * Level 4: Continuous Diffusion Fallback -> FALLBACK_DIFFUSION
   */
  estimateExpectedReturn(
    prob: number,
    horizon: '1d' | '5d' | '20d',
    assetVolatility: number = 0.02
  ): ExpectedReturnEstimation {
    const pUp = Math.max(0.05, Math.min(0.95, prob));
    const pDown = 1 - pUp;

    const sigma = Math.max(
      MODEL_CONFIG.RISK.MIN_ASSET_VOLATILITY_FLOOR,
      Math.min(MODEL_CONFIG.RISK.MAX_ASSET_VOLATILITY_CAP, assetVolatility)
    );
    const days = MODEL_CONFIG.INFERENCE.HORIZONS[horizon]?.DAYS || 5;
    const sqrtTime = Math.sqrt(days);
    const expectedVol = parseFloat((sigma * sqrtTime).toFixed(4));

    // Level 1: Fine Probability Bucket Check (N >= 15)
    const fineBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'FINE' && pUp >= b.probLower && pUp < b.probUpper && b.sampleCount >= 15
    );
    if (fineBucket) {
      const expVal = parseFloat((pUp * fineBucket.meanGainConditionalUp - pDown * fineBucket.meanLossConditionalDown).toFixed(4));
      return {
        probability: pUp,
        expectedGainConditionalUp: fineBucket.meanGainConditionalUp,
        expectedLossConditionalDown: fineBucket.meanLossConditionalDown,
        expectedValue: expVal,
        expectedVolatility: expectedVol,
        uncertainty: fineBucket.uncertainty,
        sampleCount: fineBucket.sampleCount,
        confidenceInterval: [parseFloat((expVal - 1.645 * expectedVol).toFixed(4)), parseFloat((expVal + 1.645 * expectedVol).toFixed(4))],
        method: 'EMPIRICAL_FINE_BUCKET',
      };
    }

    // Level 2: Broad Probability Bucket Check (N >= 5)
    const broadBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'BROAD' && pUp >= b.probLower && pUp < b.probUpper && b.sampleCount >= 5
    );
    if (broadBucket) {
      const expVal = parseFloat((pUp * broadBucket.meanGainConditionalUp - pDown * broadBucket.meanLossConditionalDown).toFixed(4));
      return {
        probability: pUp,
        expectedGainConditionalUp: broadBucket.meanGainConditionalUp,
        expectedLossConditionalDown: broadBucket.meanLossConditionalDown,
        expectedValue: expVal,
        expectedVolatility: expectedVol,
        uncertainty: broadBucket.uncertainty,
        sampleCount: broadBucket.sampleCount,
        confidenceInterval: [parseFloat((expVal - 1.645 * expectedVol).toFixed(4)), parseFloat((expVal + 1.645 * expectedVol).toFixed(4))],
        method: 'EMPIRICAL_BROAD_BUCKET',
      };
    }

    // Level 3: Horizon-Wide Estimate (N >= 5)
    const horizonBucket = this.empiricalBuckets.find(
      (b) => b.horizon === horizon && b.bucketType === 'HORIZON_WIDE' && b.sampleCount >= 5
    );
    if (horizonBucket) {
      const expVal = parseFloat((pUp * horizonBucket.meanGainConditionalUp - pDown * horizonBucket.meanLossConditionalDown).toFixed(4));
      return {
        probability: pUp,
        expectedGainConditionalUp: horizonBucket.meanGainConditionalUp,
        expectedLossConditionalDown: horizonBucket.meanLossConditionalDown,
        expectedValue: expVal,
        expectedVolatility: expectedVol,
        uncertainty: horizonBucket.uncertainty,
        sampleCount: horizonBucket.sampleCount,
        confidenceInterval: [parseFloat((expVal - 1.645 * expectedVol).toFixed(4)), parseFloat((expVal + 1.645 * expectedVol).toFixed(4))],
        method: 'EMPIRICAL_HORIZON_WIDE',
      };
    }

    // Level 4: Explicit Fallback (Continuous Diffusion)
    const directionalSkew = (pUp - 0.5) * 2;
    const baseReturn = directionalSkew * sigma * sqrtTime;
    const expectedValue = parseFloat(baseReturn.toFixed(4));
    const expectedGain = parseFloat(Math.max(0.01, sigma * sqrtTime * 0.9).toFixed(4));
    const expectedLoss = parseFloat(Math.max(0.01, sigma * sqrtTime * 0.9).toFixed(4));
    const uncertainty = parseFloat((expectedVol * 0.35).toFixed(4));

    return {
      probability: pUp,
      expectedGainConditionalUp: expectedGain,
      expectedLossConditionalDown: expectedLoss,
      expectedValue,
      expectedVolatility: expectedVol,
      uncertainty,
      sampleCount: 0,
      confidenceInterval: [parseFloat((expectedValue - 1.645 * expectedVol).toFixed(4)), parseFloat((expectedValue + 1.645 * expectedVol).toFixed(4))],
      method: 'FALLBACK_DIFFUSION',
    };
  }

  calculateExpectedReturn(prob: number, horizon: '1d' | '5d' | '20d', dailyVolatility: number = 0.02): number {
    return this.estimateExpectedReturn(prob, horizon, dailyVolatility).expectedValue;
  }

  calculateConfidenceInterval(expectedReturn: number, horizon: '1d' | '5d' | '20d', dailyVolatility: number = 0.02): [number, number] {
    const days = MODEL_CONFIG.INFERENCE.HORIZONS[horizon]?.DAYS || 5;
    const sigma = Math.max(MODEL_CONFIG.RISK.MIN_ASSET_VOLATILITY_FLOOR, Math.min(MODEL_CONFIG.RISK.MAX_ASSET_VOLATILITY_CAP, dailyVolatility));
    const horizonStdDev = sigma * Math.sqrt(days);
    return [parseFloat((expectedReturn - 1.645 * horizonStdDev).toFixed(4)), parseFloat((expectedReturn + 1.645 * horizonStdDev).toFixed(4))];
  }

  calculateFeatureContributions(features: Record<string, number | null>): FeatureContribution[] {
    const contributions: FeatureContribution[] = [];

    const rsi = features['rsi_14'];
    if (rsi !== null && rsi !== undefined) {
      contributions.push({
        feature: 'RSI (14)',
        contribution: parseFloat(((rsi - 50) / 50 * 0.25).toFixed(3)),
      });
    }

    const sentiment = features['news_sentiment'];
    if (sentiment !== null && sentiment !== undefined) {
      contributions.push({
        feature: 'News Sentiment',
        contribution: parseFloat((Math.tanh(sentiment / 20) * 0.20).toFixed(3)),
      });
    }

    const smaDist = features['sma_50_dist'];
    if (smaDist !== null && smaDist !== undefined) {
      contributions.push({
        feature: '50-day SMA Distance',
        contribution: parseFloat((Math.tanh(smaDist * 10) * 0.22).toFixed(3)),
      });
    }

    const macdHist = features['macd_hist'];
    const atr14 = features['atr_14'] || 1.0;
    if (macdHist !== null && macdHist !== undefined) {
      contributions.push({
        feature: 'MACD Momentum',
        contribution: parseFloat((Math.tanh(macdHist / Math.max(0.1, atr14)) * 0.18).toFixed(3)),
      });
    }

    const volZScore = features['volume_z_score'];
    if (volZScore !== null && volZScore !== undefined && Math.abs(volZScore) > 0.5) {
      contributions.push({
        feature: 'Volume Z-Score',
        contribution: parseFloat((Math.tanh(volZScore / 2.0) * 0.15).toFixed(3)),
      });
    }

    const beta = features['beta_nifty'];
    if (beta !== null && beta !== undefined) {
      contributions.push({
        feature: 'Beta Alignment',
        contribution: parseFloat(((beta - 1.0) * 0.10).toFixed(3)),
      });
    }

    return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  getEmpiricalBuckets(): EmpiricalDistributionBucket[] {
    return this.empiricalBuckets;
  }

  setEmpiricalBuckets(buckets: EmpiricalDistributionBucket[]) {
    this.empiricalBuckets = buckets;
  }

  getModelVersion(): string {
    return ModelRegistry.getModelVersion();
  }

  // Robust Statistics Helpers
  private computeTrimmedMean(arr: number[], fallback: number, trimPct: number = 0.10): number {
    if (!arr || arr.length === 0) return fallback;
    if (arr.length <= 4) return arr.reduce((s, x) => s + x, 0) / arr.length;

    const sorted = [...arr].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * trimPct);
    const trimmed = sorted.slice(k, sorted.length - k);
    return trimmed.length > 0 ? trimmed.reduce((s, x) => s + x, 0) / trimmed.length : fallback;
  }

  private computeStandardError(arr: number[]): number {
    if (!arr || arr.length < 2) return 0.01;
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance / arr.length);
  }
}

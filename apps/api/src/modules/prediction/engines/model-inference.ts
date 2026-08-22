import { Injectable, Logger } from '@nestjs/common';
import { FeatureContribution } from '../prediction.types';
import { MODEL_CONFIG } from './model-config';
import { ModelRegistry } from './model-registry';

@Injectable()
export class ModelInferenceEngine {
  private readonly logger = new Logger(ModelInferenceEngine.name);

  /**
   * Multi-Factor Probabilistic Inference Engine
   * Evaluates statistical probability of price appreciation over a specified horizon
   * using balanced momentum, trend alignment, volatility regime, and mean-reversion signals.
   */
  evaluate(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): number {
    const horizonConfig = MODEL_CONFIG.INFERENCE.HORIZONS[horizon] || MODEL_CONFIG.INFERENCE.HORIZONS['5d'];
    let logit = 0;

    // ── 1. Momentum Signal Component (-1.0 to +1.0) ──
    let momentumScore = 0;
    const rsi = features['rsi_14'];
    if (rsi !== null && rsi !== undefined) {
      // Centered around 50, normalized to [-1, 1]
      momentumScore += ((rsi - 50) / 50) * 0.40;
    }

    const macdHist = features['macd_hist'];
    const atr14 = features['atr_14'] || 1.0;
    if (macdHist !== null && macdHist !== undefined) {
      // Normalized by ATR to make it stock-scale invariant
      momentumScore += Math.tanh(macdHist / Math.max(0.1, atr14)) * 0.35;
    }

    const stochK = features['stoch_k'];
    if (stochK !== null && stochK !== undefined) {
      momentumScore += ((stochK - 50) / 50) * 0.25;
    }

    // ── 2. Trend Alignment Component (-1.0 to +1.0) ──
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

    // ── 3. Mean-Reversion Component (-1.0 to +1.0) ──
    let meanRevScore = 0;
    if (rsi !== null && rsi !== undefined) {
      if (rsi < 30) meanRevScore += (30 - rsi) / 30; // oversold bounce signal
      else if (rsi > 70) meanRevScore -= (rsi - 70) / 30; // overbought exhaustion signal
    }

    // ── 4. Volatility Drag Penalty (-1.0 to 0) ──
    const annualizedVol = features['annualized_volatility'] || 0.20;
    const volPenalty = Math.min(1.0, annualizedVol / 0.40); // penalize excessive unpredictable volatility

    // ── 5. News Sentiment Impact (-1.0 to +1.0) ──
    const sentiment = features['news_sentiment'];
    let sentimentScore = 0;
    if (sentiment !== null && sentiment !== undefined) {
      sentimentScore = Math.tanh(sentiment / 20.0);
    }

    // ── Multi-Factor Composite Logit Blending ──
    logit =
      horizonConfig.MOMENTUM_WEIGHT * momentumScore +
      horizonConfig.TREND_WEIGHT * trendScore +
      horizonConfig.MEAN_REV_WEIGHT * meanRevScore +
      horizonConfig.VOL_PENALTY_WEIGHT * volPenalty +
      0.15 * sentimentScore;

    // Standard Sigmoid transformation: 1 / (1 + exp(-logit * 2.0))
    const rawProb = 1 / (1 + Math.exp(-logit * 2.0));

    // Bound output to realistic empirical probabilities [0.05, 0.95]
    return parseFloat(Math.min(0.95, Math.max(0.05, rawProb)).toFixed(4));
  }

  /**
   * Mathematically grounded expected return based on Brownian motion diffusion:
   * E[R] = (Prob - 0.5) * 2 * DailyVolatility * sqrt(HorizonDays)
   * (Replaces previous arbitrary heuristic multipliers like 1.85 and 3.8)
   */
  calculateExpectedReturn(
    prob: number,
    horizon: '1d' | '5d' | '20d',
    dailyVolatility: number = 0.02
  ): number {
    const horizonConfig = MODEL_CONFIG.INFERENCE.HORIZONS[horizon] || MODEL_CONFIG.INFERENCE.HORIZONS['5d'];
    const days = horizonConfig.DAYS;

    // Clamped asset volatility between realistic floors and caps
    const sigma = Math.max(
      MODEL_CONFIG.RISK.MIN_ASSET_VOLATILITY_FLOOR,
      Math.min(MODEL_CONFIG.RISK.MAX_ASSET_VOLATILITY_CAP, dailyVolatility)
    );

    // Directional skew: -1.0 to +1.0
    const directionalSkew = (prob - 0.5) * 2;

    // Square-root-of-time scaling from continuous time finance
    const sqrtTime = Math.sqrt(days);
    const expectedReturn = directionalSkew * sigma * sqrtTime;

    return parseFloat(expectedReturn.toFixed(4));
  }

  /**
   * Diffusion-grounded Confidence Interval at 90% confidence level:
   * CI = ExpectedReturn +/- 1.645 * (DailyVolatility * sqrt(HorizonDays))
   */
  calculateConfidenceInterval(
    expectedReturn: number,
    horizon: '1d' | '5d' | '20d',
    dailyVolatility: number = 0.02
  ): [number, number] {
    const horizonConfig = MODEL_CONFIG.INFERENCE.HORIZONS[horizon] || MODEL_CONFIG.INFERENCE.HORIZONS['5d'];
    const days = horizonConfig.DAYS;

    const sigma = Math.max(
      MODEL_CONFIG.RISK.MIN_ASSET_VOLATILITY_FLOOR,
      Math.min(MODEL_CONFIG.RISK.MAX_ASSET_VOLATILITY_CAP, dailyVolatility)
    );

    const horizonStdDev = sigma * Math.sqrt(days);
    const zScore = MODEL_CONFIG.INFERENCE.CONFIDENCE_INTERVAL_Z_SCORE; // 1.645

    const low = parseFloat((expectedReturn - zScore * horizonStdDev).toFixed(4));
    const high = parseFloat((expectedReturn + zScore * horizonStdDev).toFixed(4));

    return [low, high];
  }

  /**
   * Machine-Readable Explainability & Feature Attribution (Part 16)
   */
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

  getModelVersion(): string {
    return ModelRegistry.getModelVersion();
  }
}

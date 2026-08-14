import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FeatureContribution } from '../prediction.types';

@Injectable()
export class ModelInferenceEngine {
  private readonly logger = new Logger(ModelInferenceEngine.name);
  private modelV1: any = null;

  constructor() {
    this.loadModel();
  }

  private loadModel() {
    try {
      const modelPath = path.join(__dirname, '..', '..', 'models', 'model_v1.json');
      if (fs.existsSync(modelPath)) {
        this.modelV1 = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      }
    } catch (err) {
      this.logger.warn('Could not load model_v1.json. Operating in fallback mode.');
    }
  }

  evaluate(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): number {
    let prob = 0.50;

    // Feature weights based on horizon
    const horizonMultiplier = horizon === '20d' ? 1.0 : horizon === '5d' ? 0.7 : 0.4;

    const rsi = features['rsi_14'];
    if (rsi !== undefined && rsi !== null) {
      const rsiDiff = (rsi - 50) / 50; // -1 to +1
      prob += rsiDiff * 0.18 * horizonMultiplier;
    }

    const sentiment = features['news_sentiment'];
    if (sentiment !== undefined && sentiment !== null) {
      const sentimentScore = sentiment / 20; // -1 to +1
      prob += sentimentScore * 0.14 * horizonMultiplier;
    }

    const sma50Dist = features['sma_50_dist'];
    if (sma50Dist !== undefined && sma50Dist !== null) {
      prob += Math.max(-0.15, Math.min(0.15, sma50Dist * 1.5)) * horizonMultiplier;
    }

    const macdHist = features['macd_hist'];
    if (macdHist !== undefined && macdHist !== null) {
      prob += (macdHist > 0 ? 0.04 : -0.04) * horizonMultiplier;
    }

    const changePercent = features['change_percent'];
    if (changePercent !== undefined && changePercent !== null) {
      prob += Math.max(-0.1, Math.min(0.1, (changePercent / 100) * 2)) * horizonMultiplier;
    }

    return parseFloat(Math.min(0.95, Math.max(0.05, prob)).toFixed(4));
  }

  calculateExpectedReturn(prob: number, horizon: '1d' | '5d' | '20d', volatility: number = 0.02): number {
    const directionalMultiplier = (prob - 0.5) * 2; // -1 to +1
    // Dynamically scale expected return by actual asset volatility (low volatility gives realistic 1.5%-3.5% steady gains, high volatility gives 6%-15%+)
    const horizonScale = horizon === '1d' ? 0.75 : horizon === '5d' ? 1.85 : 3.8;
    const baseReturn = directionalMultiplier * Math.max(0.012, volatility) * horizonScale;
    return parseFloat(baseReturn.toFixed(4));
  }

  calculateConfidenceInterval(expectedReturn: number, horizon: '1d' | '5d' | '20d', volatility: number = 0.02): [number, number] {
    const horizonVol = Math.max(0.012, volatility) * (horizon === '1d' ? 1.0 : horizon === '5d' ? 1.9 : 3.6);
    const low = parseFloat((expectedReturn - 1.645 * horizonVol).toFixed(4));
    const high = parseFloat((expectedReturn + 1.645 * horizonVol).toFixed(4));
    return [low, high];
  }

  calculateFeatureContributions(features: Record<string, number | null>): FeatureContribution[] {
    const contributions: FeatureContribution[] = [];

    const rsi = features['rsi_14'];
    if (rsi !== undefined && rsi !== null) {
      contributions.push({
        feature: 'RSI (14)',
        contribution: parseFloat(((rsi - 50) / 50 * 0.28).toFixed(3)),
      });
    }

    const sentiment = features['news_sentiment'];
    if (sentiment !== undefined && sentiment !== null) {
      contributions.push({
        feature: 'News Sentiment',
        contribution: parseFloat(((sentiment / 20) * 0.22).toFixed(3)),
      });
    }

    const smaDist = features['sma_50_dist'];
    if (smaDist !== undefined && smaDist !== null) {
      contributions.push({
        feature: '50-day SMA Distance',
        contribution: parseFloat((Math.min(0.20, Math.max(-0.20, smaDist * 2.0))).toFixed(3)),
      });
    }

    const macdHist = features['macd_hist'];
    if (macdHist !== undefined && macdHist !== null) {
      contributions.push({
        feature: 'MACD Momentum',
        contribution: parseFloat(((macdHist > 0 ? 0.12 : -0.12)).toFixed(3)),
      });
    }

    const changePercent = features['change_percent'];
    if (changePercent !== undefined && changePercent !== null) {
      contributions.push({
        feature: 'Price Velocity',
        contribution: parseFloat((Math.min(0.15, Math.max(-0.15, (changePercent / 100) * 2.5))).toFixed(3)),
      });
    }

    const volume = features['volume'];
    if (volume !== undefined && volume !== null && volume > 1_000_000) {
      contributions.push({
        feature: 'Institutional Volume Surge',
        contribution: 0.10,
      });
    }

    return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }
  
  getModelVersion(): string {
    return this.modelV1 ? this.modelV1.version || 'v1.0' : 'v1.0';
  }
}

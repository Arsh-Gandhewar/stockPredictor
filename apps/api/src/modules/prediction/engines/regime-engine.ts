import { Injectable } from '@nestjs/common';
import { MarketRegime } from '../prediction.types';
import { MarketIndexBenchmark, OHLCVCandle } from '../../stock/providers/market-data.provider.interface';
import { MODEL_CONFIG } from './model-config';

export interface RegimeDetails {
  regime: MarketRegime;
  confidence: number;
  niftyTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  niftyVolAnnualized: number;
  vixLevel: number;
  description: string;
}

@Injectable()
export class RegimeEngine {
  /**
   * Detects market regime using NIFTY 50 price action, volatility, trend alignment, and INDIA VIX.
   * Classifies into:
   * 1. BULL_TREND: Steady upward trend with contained volatility (<25% vol, VIX < 18)
   * 2. BULL_VOLATILE: Upward structural trend with elevated volatility (VIX 18-22, vol > 25%)
   * 3. SIDEWAYS: Range-bound consolidation without directional conviction
   * 4. BEAR_TREND: Persistent downward slope below moving averages
   * 5. PANIC: Liquidity shock / capitulation (VIX > 22 or Annualized Vol > 30% with breakdown)
   */
  detectRegime(
    indices: MarketIndexBenchmark[],
    niftyCandles?: OHLCVCandle[]
  ): MarketRegime {
    const details = this.evaluateRegime(indices, niftyCandles);
    return details.regime;
  }

  evaluateRegime(
    indices: MarketIndexBenchmark[],
    niftyCandles?: OHLCVCandle[]
  ): RegimeDetails {
    const nifty = indices.find(i => i.symbol === '^NSEI');
    const vix = indices.find(i => i.symbol === '^INDIAVIX');

    const vixValue = vix ? vix.value : 14.5; // typical baseline VIX
    const niftyChange = nifty ? nifty.changePercent : 0;

    let niftyVolAnnualized = 0.14; // baseline ~14% vol
    let isAboveSma50 = niftyChange >= 0;
    let isAboveSma20 = niftyChange >= 0;
    let momentum20d = niftyChange / 100;

    if (niftyCandles && niftyCandles.length >= 50) {
      const closes = niftyCandles.map(c => c.close);
      const len = closes.length;
      const currentClose = nifty ? nifty.value : closes[len - 1];

      // Calculate SMA 20 and SMA 50
      const sma20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
      const sma50 = closes.slice(-50).reduce((s, c) => s + c, 0) / 50;

      isAboveSma20 = currentClose >= sma20;
      isAboveSma50 = currentClose >= sma50;

      // 20d momentum
      momentum20d = (currentClose - closes[len - 21]) / closes[len - 21];

      // 20d volatility
      const returns: number[] = [];
      for (let i = len - 20; i < len; i++) {
        if (closes[i - 1] > 0) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
      }
      if (returns.length > 0) {
        const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
        niftyVolAnnualized = Math.sqrt(variance) * Math.sqrt(252);
      }
    }

    const isPanicVix = vixValue >= MODEL_CONFIG.REGIME.VIX_PANIC_THRESHOLD;
    const isElevatedVix = vixValue >= MODEL_CONFIG.REGIME.VIX_ELEVATED_THRESHOLD;
    const isHighVol = niftyVolAnnualized >= MODEL_CONFIG.REGIME.PANIC_VOLATILITY_ANNUALIZED;

    // Classification Decision Tree
    if (isPanicVix || (isHighVol && !isAboveSma50)) {
      return {
        regime: 'PANIC',
        confidence: 0.90,
        niftyTrend: 'BEARISH',
        niftyVolAnnualized,
        vixLevel: vixValue,
        description: 'Elevated market panic: high volatility and liquidity discount active.',
      };
    }

    if (!isAboveSma50 && !isAboveSma20 && momentum20d < MODEL_CONFIG.REGIME.BEAR_MOMENTUM_20D_THRESHOLD) {
      return {
        regime: 'BEAR_TREND',
        confidence: 0.85,
        niftyTrend: 'BEARISH',
        niftyVolAnnualized,
        vixLevel: vixValue,
        description: 'Structural bear trend below 50-day moving average.',
      };
    }

    if (isAboveSma50 && (isElevatedVix || niftyVolAnnualized > MODEL_CONFIG.REGIME.BULL_VOLATILITY_CEILING)) {
      return {
        regime: 'BULL_VOLATILE',
        confidence: 0.80,
        niftyTrend: 'BULLISH',
        niftyVolAnnualized,
        vixLevel: vixValue,
        description: 'Bullish trend with elevated volatility expansion and rotation.',
      };
    }

    if (isAboveSma50 && isAboveSma20 && !isElevatedVix) {
      return {
        regime: 'BULL_TREND',
        confidence: 0.88,
        niftyTrend: 'BULLISH',
        niftyVolAnnualized,
        vixLevel: vixValue,
        description: 'Constructive bull market with orderly trend and subdued volatility.',
      };
    }

    return {
      regime: 'SIDEWAYS',
      confidence: 0.75,
      niftyTrend: 'NEUTRAL',
      niftyVolAnnualized,
      vixLevel: vixValue,
      description: 'Balanced sideways consolidation range.',
    };
  }
}

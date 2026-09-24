import {
  bullishengulfingpattern,
  bearishengulfingpattern,
  doji,
  bullishhammerstick,
  shootingstar,
  morningstar,
  eveningstar,
  bullishharami,
  bearishharami,
} from 'technicalindicators';
import { PatternAnalysis } from '../deep-audit.types';

type Candle = { time: number | string; open: number; high: number; low: number; close: number; volume: number };

export class PatternDetectionEngine {
  analyze(candles: Candle[]): PatternAnalysis {
    if (candles.length < 30) {
      throw new Error('Not enough candles for pattern detection. Need at least 30.');
    }

    const closes = candles.map(c => c.close);
    const sma20 = this.calculateSMA(closes, Math.min(20, closes.length));
    const sma50 = this.calculateSMA(closes, Math.min(50, closes.length));
    const sma200 = closes.length >= 200 ? this.calculateSMA(closes, 200) : sma50;

    const currentPrice = closes[closes.length - 1];
    const currSma20 = sma20[sma20.length - 1];
    const currSma50 = sma50[sma50.length - 1];
    const currSma200 = sma200[sma200.length - 1];

    let trend = 'SIDEWAYS';
    if (currentPrice > currSma20 && currSma20 > currSma50 && currSma50 > currSma200) {
      trend = 'STRONG_UPTREND';
    } else if (currentPrice > currSma50 && currSma50 > currSma200) {
      trend = 'UPTREND';
    } else if (currentPrice < currSma20 && currSma20 < currSma50 && currSma50 < currSma200) {
      trend = 'STRONG_DOWNTREND';
    } else if (currentPrice < currSma50 && currSma50 < currSma200) {
      trend = 'DOWNTREND';
    }

    const trendStrength = this.calculateKaufmanER(closes, 20);

    let maAlignment = 'MIXED';
    if (currSma20 > currSma50 && currSma50 > currSma200) maAlignment = 'BULLISH';
    else if (currSma20 < currSma50 && currSma50 < currSma200) maAlignment = 'BEARISH';

    const { goldenCross, deathCross } = this.checkCrosses(sma50, sma200);

    const { support, resistance } = this.findSupportResistance(candles);
    const topSupport = support.filter(l => l < currentPrice).sort((a, b) => b - a).slice(0, 3);
    const topResistance = resistance.filter(l => l > currentPrice).sort((a, b) => a - b).slice(0, 3);

    const patterns = this.detectPatterns(candles);
    const rsiDivergence = this.checkRSIDivergence(candles);

    return {
      trend: trend as any,
      trendStrength,
      supportLevels: topSupport,
      resistanceLevels: topResistance,
      candlestickPatterns: patterns,
      movingAverageAlignment: maAlignment as any,
      goldenCross,
      deathCross,
      rsiDivergence: rsiDivergence as any,
    };
  }

  private calculateSMA(data: number[], period: number): number[] {
    const result: number[] = new Array(data.length).fill(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
      if (i >= period) sum -= data[i - period];
      if (i >= period - 1) result[i] = sum / period;
    }
    return result;
  }

  private calculateKaufmanER(closes: number[], period: number): number {
    if (closes.length <= period) return 0;
    const n = closes.length - 1;
    const change = Math.abs(closes[n] - closes[n - period]);
    let volatility = 0;
    for (let i = n - period + 1; i <= n; i++) {
      volatility += Math.abs(closes[i] - closes[i - 1]);
    }
    return volatility === 0 ? 0 : (change / volatility) * 100;
  }

  private checkCrosses(sma50: number[], sma200: number[]) {
    let goldenCross = false;
    let deathCross = false;
    const lookback = Math.min(30, sma50.length);
    const n = sma50.length - 1;
    for (let i = n - lookback + 1; i <= n; i++) {
      if (sma50[i - 1] <= sma200[i - 1] && sma50[i] > sma200[i]) goldenCross = true;
      if (sma50[i - 1] >= sma200[i - 1] && sma50[i] < sma200[i]) deathCross = true;
    }
    return { goldenCross, deathCross };
  }

  private findSupportResistance(candles: Candle[]) {
    const lookback = Math.min(120, candles.length);
    const recent = candles.slice(-lookback);
    const minLevels: number[] = [];
    const maxLevels: number[] = [];

    for (let i = 10; i < recent.length - 10; i++) {
      let isMin = true;
      let isMax = true;
      const pivotLow = recent[i].low;
      const pivotHigh = recent[i].high;
      
      for (let j = i - 10; j <= i + 10; j++) {
        if (i === j) continue;
        if (recent[j].low < pivotLow) isMin = false;
        if (recent[j].high > pivotHigh) isMax = false;
      }
      if (isMin) minLevels.push(pivotLow);
      if (isMax) maxLevels.push(pivotHigh);
    }

    return {
      support: this.clusterLevels(minLevels),
      resistance: this.clusterLevels(maxLevels)
    };
  }

  private clusterLevels(levels: number[]): number[] {
    const clustered: number[] = [];
    levels.sort((a, b) => a - b);
    let i = 0;
    while (i < levels.length) {
      let sum = levels[i];
      let count = 1;
      let j = i + 1;
      while (j < levels.length && (levels[j] - levels[i]) / levels[i] <= 0.015) {
        sum += levels[j];
        count++;
        j++;
      }
      clustered.push(sum / count);
      i = j;
    }
    return clustered;
  }

  private detectPatterns(candles: Candle[]) {
    const patterns: any[] = [];
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);

    const input = {
      open: recent.map(c => c.open),
      high: recent.map(c => c.high),
      low: recent.map(c => c.low),
      close: recent.map(c => c.close),
    };

    const runPattern = (detector: any, name: string, type: string, reliability: string) => {
      try {
        const result = detector(input);
        const startIdx = Math.max(0, result.length - 30);
        for (let i = startIdx; i < result.length; i++) {
          if (result[i]) {
            patterns.push({
              name,
              type,
              date: new Date(recent[recent.length - result.length + i].time).toISOString(),
              reliability
            });
          }
        }
      } catch (e) {}
    };

    runPattern(bullishengulfingpattern, 'Bullish Engulfing', 'BULLISH', 'HIGH');
    runPattern(bearishengulfingpattern, 'Bearish Engulfing', 'BEARISH', 'HIGH');
    runPattern(doji, 'Doji', 'NEUTRAL', 'LOW');
    runPattern(bullishhammerstick, 'Hammer', 'BULLISH', 'MEDIUM');
    runPattern(shootingstar, 'Shooting Star', 'BEARISH', 'MEDIUM');
    runPattern(morningstar, 'Morning Star', 'BULLISH', 'HIGH');
    runPattern(eveningstar, 'Evening Star', 'BEARISH', 'HIGH');
    runPattern(bullishharami, 'Bullish Harami', 'BULLISH', 'LOW');
    runPattern(bearishharami, 'Bearish Harami', 'BEARISH', 'LOW');

    return patterns;
  }

  private checkRSIDivergence(candles: Candle[]) {
    const closes = candles.map(c => c.close);
    const rsi = this.calculateRSI(closes, 14);
    if (rsi.length < 14) return 'NONE';

    const lookback = Math.min(14, candles.length);
    const recentCloses = closes.slice(-lookback);
    const recentRSI = rsi.slice(-lookback);

    let priceTrend = recentCloses[recentCloses.length - 1] - recentCloses[0];
    let rsiTrend = recentRSI[recentRSI.length - 1] - recentRSI[0];

    if (priceTrend < 0 && rsiTrend > 0) return 'BULLISH_DIVERGENCE';
    if (priceTrend > 0 && rsiTrend < 0) return 'BEARISH_DIVERGENCE';
    return 'NONE';
  }

  private calculateRSI(closes: number[], period: number): number[] {
    const rsi = new Array(closes.length).fill(0);
    if (closes.length <= period) return rsi;

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) avgGain += diff;
      else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    
    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return rsi;
  }
}

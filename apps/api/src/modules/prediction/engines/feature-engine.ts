import { Injectable } from '@nestjs/common';
import { MarketQuote, OHLCVCandle } from '../../stock/providers/market-data.provider.interface';
import { RSI, MACD, SMA, EMA, BollingerBands, ATR, Stochastic } from 'technicalindicators';
import { MODEL_CONFIG } from './model-config';

export interface FeatureMetadata {
  name: string;
  category: 'MOMENTUM' | 'TREND' | 'VOLATILITY' | 'LIQUIDITY' | 'TAIL_RISK' | 'BENCHMARK' | 'SENTIMENT';
  lookbackPeriod: number;
  source: 'OHLCV' | 'QUOTE' | 'BENCHMARK' | 'NEWS';
  description: string;
}

@Injectable()
export class FeatureEngine {
  /**
   * Complete Feature Dictionary Registry
   */
  static readonly FEATURE_REGISTRY: Record<string, FeatureMetadata> = {
    rsi_14: { name: 'RSI(14)', category: 'MOMENTUM', lookbackPeriod: 14, source: 'OHLCV', description: 'Wilder 14-period Relative Strength Index' },
    macd_hist: { name: 'MACD Histogram', category: 'MOMENTUM', lookbackPeriod: 26, source: 'OHLCV', description: 'MACD 12/26/9 histogram' },
    stoch_k: { name: 'Stochastic %K', category: 'MOMENTUM', lookbackPeriod: 14, source: 'OHLCV', description: 'Fast Stochastic oscillator %K' },
    stoch_d: { name: 'Stochastic %D', category: 'MOMENTUM', lookbackPeriod: 14, source: 'OHLCV', description: 'Stochastic signal line %D (3-period SMA of %K)' },
    momentum_5: { name: '5-Day Momentum', category: 'MOMENTUM', lookbackPeriod: 5, source: 'OHLCV', description: '5-day rate of return' },
    momentum_10: { name: '10-Day Momentum', category: 'MOMENTUM', lookbackPeriod: 10, source: 'OHLCV', description: '10-day rate of return' },
    momentum_20: { name: '20-Day Momentum', category: 'MOMENTUM', lookbackPeriod: 20, source: 'OHLCV', description: '20-day rate of return' },
    sma_20_dist: { name: 'SMA 20 Distance', category: 'TREND', lookbackPeriod: 20, source: 'OHLCV', description: 'Price distance from 20-day SMA' },
    sma_50_dist: { name: 'SMA 50 Distance', category: 'TREND', lookbackPeriod: 50, source: 'OHLCV', description: 'Price distance from 50-day SMA' },
    ema_20_dist: { name: 'EMA 20 Distance', category: 'TREND', lookbackPeriod: 20, source: 'OHLCV', description: 'Price distance from 20-day EMA' },
    atr_14: { name: 'ATR(14)', category: 'VOLATILITY', lookbackPeriod: 14, source: 'OHLCV', description: '14-period Average True Range in Rupees' },
    atr_percent: { name: 'ATR %', category: 'VOLATILITY', lookbackPeriod: 14, source: 'OHLCV', description: 'Normalized ATR as percentage of price' },
    bb_width: { name: 'Bollinger Band Width', category: 'VOLATILITY', lookbackPeriod: 20, source: 'OHLCV', description: '(Upper - Lower) / Middle Band' },
    annualized_volatility: { name: 'Annualized Volatility', category: 'VOLATILITY', lookbackPeriod: 20, source: 'OHLCV', description: '20-day return StdDev annualized (sqrt 252)' },
    downside_deviation: { name: 'Downside Deviation', category: 'VOLATILITY', lookbackPeriod: 20, source: 'OHLCV', description: 'StdDev of negative returns annualized' },
    max_drawdown_20d: { name: '20-Day Max Drawdown', category: 'VOLATILITY', lookbackPeriod: 20, source: 'OHLCV', description: 'Maximum peak-to-trough drop over 20 days' },
    max_drawdown_60d: { name: '60-Day Max Drawdown', category: 'VOLATILITY', lookbackPeriod: 60, source: 'OHLCV', description: 'Maximum peak-to-trough drop over 60 days' },
    gap_risk: { name: 'Overnight Gap Risk', category: 'VOLATILITY', lookbackPeriod: 20, source: 'OHLCV', description: 'Average absolute overnight gap as % of close' },
    tail_risk_5pct: { name: 'Tail Risk (5th Pct VaR)', category: 'TAIL_RISK', lookbackPeriod: 60, source: 'OHLCV', description: '5th percentile daily return over 60 days' },
    volume_z_score: { name: 'Volume Z-Score', category: 'LIQUIDITY', lookbackPeriod: 20, source: 'OHLCV', description: 'Standardized volume relative to 20-day mean/stddev' },
    volume_stability: { name: 'Volume Stability (CV)', category: 'LIQUIDITY', lookbackPeriod: 20, source: 'OHLCV', description: 'Volume coefficient of variation (StdDev / Mean)' },
    liquidity_score: { name: 'Turnover Liquidity Score', category: 'LIQUIDITY', lookbackPeriod: 20, source: 'OHLCV', description: 'Log10 of average daily turnover in ₹' },
    beta_nifty: { name: 'Beta vs NIFTY', category: 'BENCHMARK', lookbackPeriod: 60, source: 'BENCHMARK', description: 'Covariance(Stock, NIFTY) / Variance(NIFTY)' },
    relative_strength_nifty: { name: 'Relative Strength vs NIFTY', category: 'BENCHMARK', lookbackPeriod: 20, source: 'BENCHMARK', description: '20-day Stock return minus NIFTY return' },
    news_sentiment: { name: 'News Sentiment', category: 'SENTIMENT', lookbackPeriod: 1, source: 'NEWS', description: 'Structured news sentiment score (-50 to +50)' },
  };

  /**
   * Computes a full suite of multi-factor statistical and technical features.
   * Point-in-time strictly: Only historical candles through the current timestamp are used.
   */
  calculateFeatures(
    quote: MarketQuote,
    candles: OHLCVCandle[],
    newsSentiment: number = 0,
    benchmarkCandles?: OHLCVCandle[]
  ): Record<string, number | null> {
    const features: Record<string, number | null> = {
      news_sentiment: newsSentiment,
      price: quote.price,
      change_percent: quote.changePercent,
      volume: quote.volume,
    };

    if (!candles || candles.length < MODEL_CONFIG.FEATURES.WARMUP_MIN_CANDLES) {
      return features;
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const opens = candles.map((c) => c.open);
    const volumes = candles.map((c) => c.volume);
    const len = closes.length;
    const currentPrice = quote.price || closes[len - 1];

    try {
      // ── 1. Momentum & Oscillators ──
      const rsiArr = RSI.calculate({ values: closes, period: MODEL_CONFIG.FEATURES.RSI_PERIOD });
      features['rsi_14'] = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;

      const macdArr = MACD.calculate({
        values: closes,
        fastPeriod: MODEL_CONFIG.FEATURES.MACD.FAST_PERIOD,
        slowPeriod: MODEL_CONFIG.FEATURES.MACD.SLOW_PERIOD,
        signalPeriod: MODEL_CONFIG.FEATURES.MACD.SIGNAL_PERIOD,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      if (macdArr.length > 0) {
        const last = macdArr[macdArr.length - 1];
        features['macd_hist'] = last.histogram !== undefined ? last.histogram : null;
      }

      const stochArr = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: MODEL_CONFIG.FEATURES.STOCHASTIC.K_PERIOD,
        signalPeriod: MODEL_CONFIG.FEATURES.STOCHASTIC.D_PERIOD,
      });
      if (stochArr.length > 0) {
        const lastStoch = stochArr[stochArr.length - 1];
        features['stoch_k'] = lastStoch.k;
        features['stoch_d'] = lastStoch.d;
      }

      // Rate of Change Momentum (5d, 10d, 20d)
      features['momentum_5'] = len >= 6 ? (closes[len - 1] - closes[len - 6]) / closes[len - 6] : 0;
      features['momentum_10'] = len >= 11 ? (closes[len - 1] - closes[len - 11]) / closes[len - 11] : 0;
      features['momentum_20'] = len >= 21 ? (closes[len - 1] - closes[len - 21]) / closes[len - 21] : 0;

      // ── 2. Trend & Moving Average Distances ──
      const sma20 = SMA.calculate({ values: closes, period: MODEL_CONFIG.FEATURES.SMA.SHORT_PERIOD });
      features['sma_20_dist'] = sma20.length > 0 ? (currentPrice - sma20[sma20.length - 1]) / sma20[sma20.length - 1] : null;

      const sma50 = SMA.calculate({ values: closes, period: MODEL_CONFIG.FEATURES.SMA.LONG_PERIOD });
      features['sma_50_dist'] = sma50.length > 0 ? (currentPrice - sma50[sma50.length - 1]) / sma50[sma50.length - 1] : null;

      const ema20 = EMA.calculate({ values: closes, period: MODEL_CONFIG.FEATURES.EMA.MEDIUM_PERIOD });
      features['ema_20_dist'] = ema20.length > 0 ? (currentPrice - ema20[ema20.length - 1]) / ema20[ema20.length - 1] : null;

      // ── 3. Volatility & Dispersion ──
      const atrArr = ATR.calculate({ high: highs, low: lows, close: closes, period: MODEL_CONFIG.FEATURES.ATR_PERIOD });
      const atr14 = atrArr.length > 0 ? atrArr[atrArr.length - 1] : null;
      features['atr_14'] = atr14;
      features['atr_percent'] = atr14 && currentPrice > 0 ? atr14 / currentPrice : null;

      const bb = BollingerBands.calculate({
        values: closes,
        period: MODEL_CONFIG.FEATURES.BOLLINGER.PERIOD,
        stdDev: MODEL_CONFIG.FEATURES.BOLLINGER.STD_DEV,
      });
      if (bb.length > 0) {
        const last = bb[bb.length - 1];
        features['bb_width'] = last.middle > 0 ? (last.upper - last.lower) / last.middle : 0;
      }

      // Compute Daily Returns for last 60 candles
      const dailyReturns: number[] = [];
      for (let i = 1; i < len; i++) {
        if (closes[i - 1] > 0) {
          dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
      }

      const returns20 = dailyReturns.slice(-20);
      const returns60 = dailyReturns.slice(-60);

      // Annualized Volatility (20-day lookback)
      if (returns20.length >= 10) {
        const meanReturn = returns20.reduce((s, r) => s + r, 0) / returns20.length;
        const variance20 = returns20.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns20.length;
        const dailyStdDev = Math.sqrt(variance20);
        features['annualized_volatility'] = dailyStdDev * Math.sqrt(MODEL_CONFIG.FEATURES.LOOKBACKS.ANNUALIZATION_FACTOR);

        // Downside Deviation (Semi-Variance of negative returns only)
        const negativeReturns = returns20.filter((r) => r < 0);
        const downsideVariance = negativeReturns.length > 0
          ? negativeReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / returns20.length
          : 0;
        features['downside_deviation'] = Math.sqrt(downsideVariance) * Math.sqrt(MODEL_CONFIG.FEATURES.LOOKBACKS.ANNUALIZATION_FACTOR);
      } else {
        features['annualized_volatility'] = 0.02 * Math.sqrt(252);
        features['downside_deviation'] = 0.015 * Math.sqrt(252);
      }

      // Max Drawdown over 20d and 60d
      features['max_drawdown_20d'] = this.calculateMaxDrawdown(closes.slice(-20));
      features['max_drawdown_60d'] = this.calculateMaxDrawdown(closes.slice(-60));

      // Overnight Gap Risk
      const gaps: number[] = [];
      const gapLookback = Math.min(20, len - 1);
      for (let i = len - gapLookback; i < len; i++) {
        if (i > 0 && closes[i - 1] > 0) {
          gaps.push(Math.abs(opens[i] - closes[i - 1]) / closes[i - 1]);
        }
      }
      features['gap_risk'] = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0.005;

      // Tail Risk (5th percentile return from last 60 days)
      if (returns60.length >= 20) {
        const sortedReturns = [...returns60].sort((a, b) => a - b);
        const p5Idx = Math.max(0, Math.floor(sortedReturns.length * 0.05));
        features['tail_risk_5pct'] = sortedReturns[p5Idx];
      } else {
        features['tail_risk_5pct'] = -0.03;
      }

      // ── 4. Volume & Liquidity Dynamics ──
      const volumes20 = volumes.slice(-20);
      if (volumes20.length >= 10) {
        const meanVol = volumes20.reduce((s, v) => s + v, 0) / volumes20.length;
        const volVariance = volumes20.reduce((s, v) => s + Math.pow(v - meanVol, 2), 0) / volumes20.length;
        const stdVol = Math.sqrt(volVariance);

        // Volume Z-Score (Stock-Relative)
        const currentVol = quote.volume || volumes[len - 1];
        features['volume_z_score'] = stdVol > 0 ? (currentVol - meanVol) / stdVol : 0;

        // Volume Stability (Coefficient of Variation)
        features['volume_stability'] = meanVol > 0 ? stdVol / meanVol : 1.0;

        // Liquidity Score: Log10 of daily rupee turnover
        const dailyTurnoverRupees = currentPrice * meanVol;
        features['liquidity_score'] = Math.log10(Math.max(1, dailyTurnoverRupees));
      } else {
        features['volume_z_score'] = 0;
        features['volume_stability'] = 1.0;
        features['liquidity_score'] = 6.0;
      }

      // ── 5. Benchmark & Relative Dynamics (NIFTY 50) ──
      if (benchmarkCandles && benchmarkCandles.length >= 30) {
        const benchCloses = benchmarkCandles.map((b) => b.close);
        const benchReturns: number[] = [];
        for (let i = 1; i < benchCloses.length; i++) {
          if (benchCloses[i - 1] > 0) {
            benchReturns.push((benchCloses[i] - benchCloses[i - 1]) / benchCloses[i - 1]);
          }
        }

        const matchLen = Math.min(dailyReturns.length, benchReturns.length, 60);
        const stockSlice = dailyReturns.slice(-matchLen);
        const benchSlice = benchReturns.slice(-matchLen);

        if (matchLen >= 20) {
          const meanStock = stockSlice.reduce((s, r) => s + r, 0) / matchLen;
          const meanBench = benchSlice.reduce((s, r) => s + r, 0) / matchLen;

          let cov = 0;
          let varBench = 0;
          for (let i = 0; i < matchLen; i++) {
            cov += (stockSlice[i] - meanStock) * (benchSlice[i] - meanBench);
            varBench += Math.pow(benchSlice[i] - meanBench, 2);
          }
          cov /= matchLen;
          varBench /= matchLen;

          features['beta_nifty'] = varBench > 0 ? parseFloat((cov / varBench).toFixed(2)) : 1.0;

          // 20d Relative Strength
          const stock20Return = closes[len - 1] / closes[Math.max(0, len - 21)] - 1;
          const bench20Return = benchCloses[benchCloses.length - 1] / benchCloses[Math.max(0, benchCloses.length - 21)] - 1;
          features['relative_strength_nifty'] = stock20Return - bench20Return;
        }
      } else {
        const stockVol = features['annualized_volatility'] || 0.20;
        features['beta_nifty'] = parseFloat(Math.min(2.5, Math.max(0.4, stockVol / 0.15)).toFixed(2));
        features['relative_strength_nifty'] = features['momentum_20'] || 0;
      }
    } catch {
      // Graceful fallback
    }

    return features;
  }

  /**
   * Helper: Calculates rolling Z-Score of a value against trailing series.
   */
  calculateRollingZScore(series: number[], value: number): number {
    if (!series || series.length < 5) return 0;
    const mean = series.reduce((s, x) => s + x, 0) / series.length;
    const variance = series.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / series.length;
    const std = Math.sqrt(variance);
    return std > 0 ? (value - mean) / std : 0;
  }

  /**
   * Helper: Calculates rolling Percentile Rank (0 to 100) of a value against trailing series.
   */
  calculatePercentileRank(series: number[], value: number): number {
    if (!series || series.length === 0) return 50;
    const countBelow = series.filter((x) => x < value).length;
    return (countBelow / series.length) * 100;
  }

  /**
   * Helper: Calculates maximum peak-to-trough drawdown from an array of prices
   */
  private calculateMaxDrawdown(prices: number[]): number {
    if (!prices || prices.length < 2) return 0;
    let peak = prices[0];
    let maxDrawdown = 0;
    for (const p of prices) {
      if (p > peak) peak = p;
      if (peak > 0) {
        const dd = (peak - p) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }
    return maxDrawdown;
  }
}

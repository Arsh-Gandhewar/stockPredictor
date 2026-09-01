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
  static readonly CANONICAL_FEATURES: string[] = [
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
    'ret_1d',
    'ret_5d',
    'ret_20d',
    'gap_pct',
    'dist_52w_high',
    'dist_52w_low',
    'roc_12',
    'rel_volume',
    'vol_20d',
    'vol_60d',
  ];

  calculateFeatures(
    quote: MarketQuote,
    candles: OHLCVCandle[],
    newsSentiment: number = 0,
    benchmarkCandles?: OHLCVCandle[]
  ): Record<string, number | null> {
    const features: Record<string, number | null> = {};

    // Initialize all 25 canonical keys with 0.0 or null
    for (const key of FeatureEngine.CANONICAL_FEATURES) {
      features[key] = 0.0;
    }

    // Also include metadata fields for downstream scoring/heuristics
    features['news_sentiment'] = newsSentiment;
    features['price'] = quote.price;
    features['change_percent'] = quote.changePercent;
    features['volume'] = quote.volume;

    if (!candles || candles.length < 5) {
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
      // 1. Momentum & Oscillators
      const rsiArr = RSI.calculate({ values: closes, period: 14 });
      features['rsi_14'] = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50.0;

      const macdArr = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      if (macdArr.length > 0) {
        const last = macdArr[macdArr.length - 1];
        features['macd_hist'] = last.histogram !== undefined && currentPrice > 0 ? last.histogram / currentPrice : 0.0;
      }

      const stochArr = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
        signalPeriod: 3,
      });
      if (stochArr.length > 0) {
        const lastStoch = stochArr[stochArr.length - 1];
        features['stoch_k'] = lastStoch.k;
      }

      // ROC(12)
      features['roc_12'] = len >= 13 ? ((closes[len - 1] - closes[len - 13]) / closes[len - 13]) * 100.0 : 0.0;

      // 2. Trend & Moving Average Distances
      const sma20 = SMA.calculate({ values: closes, period: 20 });
      features['sma_20_dist'] = sma20.length > 0 && sma20[sma20.length - 1] > 0
        ? (currentPrice - sma20[sma20.length - 1]) / sma20[sma20.length - 1]
        : 0.0;

      const sma50 = SMA.calculate({ values: closes, period: 50 });
      features['sma_50_dist'] = sma50.length > 0 && sma50[sma50.length - 1] > 0
        ? (currentPrice - sma50[sma50.length - 1]) / sma50[sma50.length - 1]
        : 0.0;

      const ema20 = EMA.calculate({ values: closes, period: 20 });
      features['ema_20_dist'] = ema20.length > 0 && ema20[ema20.length - 1] > 0
        ? (currentPrice - ema20[ema20.length - 1]) / ema20[ema20.length - 1]
        : 0.0;

      // 3. Volatility & Bands
      const atrArr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      const atr14 = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0.0;
      features['atr_percent'] = currentPrice > 0 ? atr14 / currentPrice : 0.02;

      const bb = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });
      if (bb.length > 0) {
        const last = bb[bb.length - 1];
        features['bb_width'] = last.middle > 0 ? (last.upper - last.lower) / last.middle : 0.05;
      }

      // Compute Daily Returns
      const dailyReturns: number[] = [];
      for (let i = 1; i < len; i++) {
        if (closes[i - 1] > 0) {
          dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
      }

      const returns20 = dailyReturns.slice(-20);
      const returns60 = dailyReturns.slice(-60);

      const std20 = returns20.length >= 5
        ? Math.sqrt(returns20.reduce((s, r) => s + Math.pow(r - (returns20.reduce((a, b) => a + b, 0) / returns20.length), 2), 0) / returns20.length)
        : 0.015;
      const std60 = returns60.length >= 10
        ? Math.sqrt(returns60.reduce((s, r) => s + Math.pow(r - (returns60.reduce((a, b) => a + b, 0) / returns60.length), 2), 0) / returns60.length)
        : 0.015;

      features['vol_20d'] = std20 * Math.sqrt(252);
      features['vol_60d'] = std60 * Math.sqrt(252);
      features['annualized_volatility'] = features['vol_20d'];

      const negReturns = returns20.filter((r) => r < 0);
      const downsideVar = negReturns.length > 0
        ? negReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / returns20.length
        : 0.0001;
      features['downside_deviation'] = Math.sqrt(downsideVar) * Math.sqrt(252);

      // 4. Multi-Horizon Returns & Price Action
      features['ret_1d'] = len >= 2 && closes[len - 2] > 0 ? (closes[len - 1] - closes[len - 2]) / closes[len - 2] : 0.0;
      features['ret_5d'] = len >= 6 && closes[len - 6] > 0 ? (closes[len - 1] - closes[len - 6]) / closes[len - 6] : 0.0;
      features['ret_20d'] = len >= 21 && closes[len - 21] > 0 ? (closes[len - 1] - closes[len - 21]) / closes[len - 21] : 0.0;
      features['momentum_5'] = features['ret_5d'];
      features['momentum_20'] = features['ret_20d'];

      // Gap %
      const prevClose = len >= 2 ? closes[len - 2] : currentPrice;
      const openPrice = len >= 1 ? opens[len - 1] : currentPrice;
      features['gap_pct'] = prevClose > 0 ? (openPrice - prevClose) / prevClose : 0.0;

      // 52-Week Distances
      const high252 = Math.max(...highs.slice(-252));
      const low252 = Math.min(...lows.slice(-252));
      features['dist_52w_high'] = high252 > 0 ? (currentPrice - high252) / high252 : 0.0;
      features['dist_52w_low'] = low252 > 0 ? (currentPrice - low252) / low252 : 0.0;

      // 5. Volume Features
      const volumes20 = volumes.slice(-20);
      if (volumes20.length >= 5) {
        const meanVol = volumes20.reduce((s, v) => s + v, 0) / volumes20.length;
        const volVar = volumes20.reduce((s, v) => s + Math.pow(v - meanVol, 2), 0) / volumes20.length;
        const stdVol = Math.sqrt(volVar);
        const currentVol = quote.volume || volumes[len - 1] || meanVol;
        features['volume_z_score'] = stdVol > 0 ? Math.max(-3.0, Math.min(3.0, (currentVol - meanVol) / stdVol)) : 0.0;
        features['rel_volume'] = meanVol > 0 ? Math.max(0.1, Math.min(10.0, currentVol / meanVol)) : 1.0;
      } else {
        features['volume_z_score'] = 0.0;
        features['rel_volume'] = 1.0;
      }

      // 6. Benchmark Features (NIFTY 50)
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

          const stock20Return = closes[len - 1] / closes[Math.max(0, len - 21)] - 1;
          const bench20Return = benchCloses[benchCloses.length - 1] / benchCloses[Math.max(0, benchCloses.length - 21)] - 1;
          features['relative_strength_nifty'] = stock20Return - bench20Return;
        } else {
          features['beta_nifty'] = 1.0;
          features['relative_strength_nifty'] = 0.0;
        }
      } else {
        features['beta_nifty'] = 1.0;
        features['relative_strength_nifty'] = 0.0;
      }
    } catch {
      // Graceful fallback with zeros for all canonical features
    }

    return features;
  }
}

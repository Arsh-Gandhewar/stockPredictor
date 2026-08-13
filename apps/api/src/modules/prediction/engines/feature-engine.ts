import { Injectable } from '@nestjs/common';
import { MarketQuote, OHLCVCandle } from '../../stock/providers/market-data.provider.interface';
import { RSI, MACD, SMA, EMA, BollingerBands, ATR, Stochastic } from 'technicalindicators';

@Injectable()
export class FeatureEngine {
  calculateFeatures(
    quote: MarketQuote,
    candles: OHLCVCandle[],
    newsSentiment: number
  ): Record<string, number | null> {
    const features: Record<string, number | null> = {
      news_sentiment: newsSentiment,
      price: quote.price,
      change_percent: quote.changePercent,
      volume: quote.volume,
    };

    if (candles.length < 50) return features; // Graceful fallback
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    try {
      const rsiArr = RSI.calculate({ values: closes, period: 14 });
      features['rsi_14'] = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;

      const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
      if (macdArr.length > 0) {
        const last = macdArr[macdArr.length - 1];
        features['macd_hist'] = last.histogram !== undefined ? last.histogram : null;
      }

      const sma50 = SMA.calculate({ values: closes, period: 50 });
      features['sma_50_dist'] = sma50.length > 0 ? (quote.price - sma50[sma50.length - 1]) / sma50[sma50.length - 1] : null;

      const ema20 = EMA.calculate({ values: closes, period: 20 });
      features['ema_20_dist'] = ema20.length > 0 ? (quote.price - ema20[ema20.length - 1]) / ema20[ema20.length - 1] : null;

      const atrArr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      features['atr_14'] = atrArr.length > 0 ? atrArr[atrArr.length - 1] : null;

      const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      if (bb.length > 0) {
        const last = bb[bb.length - 1];
        features['bb_width'] = (last.upper - last.lower) / last.middle;
      }
      
      const stoch = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
      features['stoch_k'] = stoch.length > 0 ? stoch[stoch.length - 1].k : null;

    } catch (err) {
      // Gracefully handle errors and return available features
    }

    return features;
  }
}

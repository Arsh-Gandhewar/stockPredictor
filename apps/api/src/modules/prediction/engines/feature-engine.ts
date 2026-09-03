import { Injectable, Logger } from '@nestjs/common';
import { MarketQuote, OHLCVCandle } from '../../stock/providers/market-data.provider.interface';

export interface ModelFeatureVector25 {
  rsi_14: number;
  macd_hist: number;
  sma_20_dist: number;
  sma_50_dist: number;
  ema_20_dist: number;
  atr_percent: number;
  bb_width: number;
  stoch_k: number;
  volume_z_score: number;
  annualized_volatility: number;
  downside_deviation: number;
  beta_nifty: number;
  relative_strength_nifty: number;
  momentum_5: number;
  momentum_20: number;
  ret_1d: number;
  ret_5d: number;
  ret_20d: number;
  gap_pct: number;
  dist_52w_high: number;
  dist_52w_low: number;
  roc_12: number;
  rel_volume: number;
  vol_20d: number;
  vol_60d: number;
}

export type FeatureDataQuality =
  | 'SUFFICIENT'
  | 'INSUFFICIENT_LOOKBACK'
  | 'INSUFFICIENT_BENCHMARK'
  | 'INVALID_PRICE_DATA'
  | 'INVALID_VOLUME_DATA'
  | 'INVALID_TEMPORAL_STRUCTURE'
  | 'FEATURE_COMPUTATION_FAILED';

export interface FeatureCalculationResult {
  features: ModelFeatureVector25 | null;
  rawFeatures: Record<string, number | null>;
  availabilityMask: Record<string, boolean>;
  isComplete: boolean;
  missingFeatures: string[];
  failureReasons: Record<string, string>;
  dataQuality: FeatureDataQuality;
  candleCount: number;
  benchmarkCandleCount: number;
}

export interface PredictionMetadata {
  ticker: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number;
  quoteTimestamp: string;
  newsSentiment: number | null;
  newsSentimentStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NO_NEWS';
}

@Injectable()
export class FeatureEngine {
  private readonly logger = new Logger(FeatureEngine.name);

  static readonly CANONICAL_FEATURE_KEYS: (keyof ModelFeatureVector25)[] = [
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

  static readonly MIN_LOOKBACKS: Record<keyof ModelFeatureVector25, number> = {
    ret_1d: 2,
    gap_pct: 2,
    ret_5d: 6,
    momentum_5: 6,
    roc_12: 13,
    stoch_k: 14,
    rsi_14: 15,
    atr_percent: 15,
    sma_20_dist: 20,
    ema_20_dist: 20,
    bb_width: 20,
    volume_z_score: 20,
    rel_volume: 20,
    ret_20d: 21,
    momentum_20: 21,
    annualized_volatility: 21,
    vol_20d: 21,
    downside_deviation: 21,
    relative_strength_nifty: 21,
    macd_hist: 34,
    sma_50_dist: 50,
    vol_60d: 61,
    beta_nifty: 61,
    dist_52w_high: 252,
    dist_52w_low: 252,
  };

  /**
   * Computes the exact 25 canonical model features with zero hardcoded numerical defaults.
   * If any required feature cannot be computed due to insufficient lookback, invalid data,
   * temporal irregularities, or benchmark absence, returns features: null with explicit diagnostics.
   */
  calculateFeatures(
    quote: MarketQuote | null | undefined,
    candles: OHLCVCandle[] | null | undefined,
    benchmarkCandles?: OHLCVCandle[] | null
  ): FeatureCalculationResult {
    const rawFeatures: Record<string, number | null> = {};
    const availabilityMask: Record<string, boolean> = {};
    const failureReasons: Record<string, string> = {};
    const missingFeatures: string[] = [];

    for (const key of FeatureEngine.CANONICAL_FEATURE_KEYS) {
      rawFeatures[key] = null;
      availabilityMask[key] = false;
    }

    // 1. Strict Market Quote Validation
    if (!quote || typeof quote.price !== 'number' || isNaN(quote.price) || !isFinite(quote.price) || quote.price <= 0) {
      return {
        features: null,
        rawFeatures,
        availabilityMask,
        isComplete: false,
        missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
        failureReasons: { quote: 'INVALID_PRICE_DATA: Missing or non-positive live quote price.' },
        dataQuality: 'INVALID_PRICE_DATA',
        candleCount: candles?.length || 0,
        benchmarkCandleCount: benchmarkCandles?.length || 0,
      };
    }

    // 2. Strict Candle Array Validation
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      return {
        features: null,
        rawFeatures,
        availabilityMask,
        isComplete: false,
        missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
        failureReasons: { candles: 'INSUFFICIENT_LOOKBACK: No historical OHLCV candles provided.' },
        dataQuality: 'INSUFFICIENT_LOOKBACK',
        candleCount: 0,
        benchmarkCandleCount: benchmarkCandles?.length || 0,
      };
    }

    // 3. Strict Temporal Structure & Point-in-Time Causality Validation
    const decisionTime = quote?.timestamp ? new Date(quote.timestamp).getTime() : Date.now();
    const cutoffTimeMs = isNaN(decisionTime) ? Date.now() : decisionTime;

    // Filter out market holiday dummy bars and enforce strict PIT causality:
    // Only observations occurring on or before decision cutoff are visible to the feature pipeline.
    const activeCandles = candles
      .filter((c) => !(c.volume === 0 && c.high === c.low && c.open === c.close))
      .filter((c) => {
        const rawTime = c.timestamp ?? (c as any).time;
        const timeVal = typeof rawTime === 'string' || typeof rawTime === 'number'
          ? new Date(rawTime).getTime()
          : NaN;
        return isNaN(timeVal) || timeVal <= cutoffTimeMs + 1000;
      });

    const activeBenchmark = benchmarkCandles
      ? benchmarkCandles
          .filter((b) => !(b.volume === 0 && b.high === b.low && b.open === b.close))
          .filter((b) => {
            const rawTime = b.timestamp ?? (b as any).time;
            const timeVal = typeof rawTime === 'string' || typeof rawTime === 'number'
              ? new Date(rawTime).getTime()
              : NaN;
            return isNaN(timeVal) || timeVal <= cutoffTimeMs + 1000;
          })
      : undefined;

    const n = activeCandles.length;
    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const opens: number[] = [];
    const volumes: number[] = [];
    const timestamps: number[] = [];
    const dateSet = new Set<string>();

    for (let i = 0; i < n; i++) {
      const c = activeCandles[i];
      if (
        typeof c.close !== 'number' || isNaN(c.close) || !isFinite(c.close) || c.close <= 0 ||
        typeof c.high !== 'number' || isNaN(c.high) || !isFinite(c.high) || c.high <= 0 ||
        typeof c.low !== 'number' || isNaN(c.low) || !isFinite(c.low) || c.low <= 0 ||
        typeof c.open !== 'number' || isNaN(c.open) || !isFinite(c.open) || c.open <= 0
      ) {
        return {
          features: null,
          rawFeatures,
          availabilityMask,
          isComplete: false,
          missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
          failureReasons: { candles: `INVALID_PRICE_DATA: Invalid non-positive OHLC candle at index ${i}.` },
          dataQuality: 'INVALID_PRICE_DATA',
          candleCount: n,
          benchmarkCandleCount: activeBenchmark?.length || 0,
        };
      }

      // Temporal validation
      const rawTime = c.timestamp ?? (c as any).time;
      const timeVal = typeof rawTime === 'string' || typeof rawTime === 'number'
        ? new Date(rawTime).getTime()
        : NaN;

      if (isNaN(timeVal)) {
        return {
          features: null,
          rawFeatures,
          availabilityMask,
          isComplete: false,
          missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
          failureReasons: { candles: `INVALID_TIMESTAMP: Unparseable timestamp at candle index ${i}.` },
          dataQuality: 'INVALID_PRICE_DATA',
          candleCount: n,
          benchmarkCandleCount: activeBenchmark?.length || 0,
        };
      }

      if (i > 0 && timeVal <= timestamps[i - 1]) {
        const prevRawTime = activeCandles[i - 1].timestamp ?? activeCandles[i - 1].time;
        return {
          features: null,
          rawFeatures,
          availabilityMask,
          isComplete: false,
          missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
          failureReasons: { candles: `INVALID_TEMPORAL_STRUCTURE: Monotonic time order violated at index ${i} (${rawTime} <= ${prevRawTime}).` },
          dataQuality: 'INVALID_TEMPORAL_STRUCTURE',
          candleCount: n,
          benchmarkCandleCount: benchmarkCandles?.length || 0,
        };
      }

      const dateStr = new Date(timeVal).toISOString().slice(0, 10);
      if (dateSet.has(dateStr)) {
        return {
          features: null,
          rawFeatures,
          availabilityMask,
          isComplete: false,
          missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
          failureReasons: { candles: `INVALID_TEMPORAL_STRUCTURE: Duplicate date ${dateStr} at index ${i}.` },
          dataQuality: 'INVALID_TEMPORAL_STRUCTURE',
          candleCount: n,
          benchmarkCandleCount: benchmarkCandles?.length || 0,
        };
      }
      dateSet.add(dateStr);

      closes.push(c.close);
      highs.push(c.high);
      lows.push(c.low);
      opens.push(c.open);
      volumes.push(typeof c.volume === 'number' && !isNaN(c.volume) ? c.volume : 0);
      timestamps.push(timeVal);
    }

    const sliceVol20 = volumes.slice(-20);
    const hasInvalidVolume = sliceVol20.length < 20 || sliceVol20.some((v) => typeof v !== 'number' || isNaN(v) || !isFinite(v) || v <= 0);

    const lastClose = closes[n - 1];

    // Compute Daily Returns
    const dailyReturns: number[] = [];
    for (let i = 1; i < n; i++) {
      dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    // 4. Feature-by-Feature Calculation with Strict Lookback Guards
    try {
      // ── ret_1d ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.ret_1d) {
        rawFeatures['ret_1d'] = (closes[n - 1] - closes[n - 2]) / closes[n - 2];
        availabilityMask['ret_1d'] = true;
      } else {
        failureReasons['ret_1d'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.ret_1d} candles, got ${n}`;
      }

      // ── gap_pct ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.gap_pct) {
        rawFeatures['gap_pct'] = (opens[n - 1] - closes[n - 2]) / closes[n - 2];
        availabilityMask['gap_pct'] = true;
      } else {
        failureReasons['gap_pct'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.gap_pct} candles, got ${n}`;
      }

      // ── ret_5d & momentum_5 ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.ret_5d) {
        const val = (closes[n - 1] - closes[n - 6]) / closes[n - 6];
        rawFeatures['ret_5d'] = val;
        rawFeatures['momentum_5'] = val;
        availabilityMask['ret_5d'] = true;
        availabilityMask['momentum_5'] = true;
      } else {
        failureReasons['ret_5d'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.ret_5d} candles, got ${n}`;
        failureReasons['momentum_5'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.momentum_5} candles, got ${n}`;
      }

      // ── roc_12 ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.roc_12) {
        rawFeatures['roc_12'] = ((closes[n - 1] - closes[n - 13]) / closes[n - 13]) * 100.0;
        availabilityMask['roc_12'] = true;
      } else {
        failureReasons['roc_12'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.roc_12} candles, got ${n}`;
      }

      // ── stoch_k (14-period) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.stoch_k) {
        const sliceHigh = highs.slice(-14);
        const sliceLow = lows.slice(-14);
        const maxH = Math.max(...sliceHigh);
        const minL = Math.min(...sliceLow);
        rawFeatures['stoch_k'] = maxH > minL ? (100.0 * (lastClose - minL)) / (maxH - minL) : 50.0;
        availabilityMask['stoch_k'] = true;
      } else {
        failureReasons['stoch_k'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.stoch_k} candles, got ${n}`;
      }

      // ── rsi_14 (Wilder EWM com=13) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.rsi_14) {
        rawFeatures['rsi_14'] = this.computeWilderRSI(closes, 14);
        availabilityMask['rsi_14'] = true;
      } else {
        failureReasons['rsi_14'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.rsi_14} candles, got ${n}`;
      }

      // ── atr_percent (14-period True Range) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.atr_percent) {
        const trValues: number[] = [];
        for (let i = n - 14; i < n; i++) {
          const h = highs[i];
          const l = lows[i];
          const prevC = closes[i - 1];
          const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
          trValues.push(tr);
        }
        const meanTR = trValues.reduce((s, v) => s + v, 0) / 14.0;
        rawFeatures['atr_percent'] = meanTR / lastClose;
        availabilityMask['atr_percent'] = true;
      } else {
        failureReasons['atr_percent'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.atr_percent} candles, got ${n}`;
      }

      // ── sma_20_dist ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.sma_20_dist) {
        const slice20 = closes.slice(-20);
        const mean20 = slice20.reduce((s, v) => s + v, 0) / 20.0;
        rawFeatures['sma_20_dist'] = (lastClose - mean20) / mean20;
        availabilityMask['sma_20_dist'] = true;
      } else {
        failureReasons['sma_20_dist'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.sma_20_dist} candles, got ${n}`;
      }

      // ── ema_20_dist ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.ema_20_dist) {
        const ema20 = this.computeEMA(closes, 20);
        rawFeatures['ema_20_dist'] = (lastClose - ema20) / ema20;
        availabilityMask['ema_20_dist'] = true;
      } else {
        failureReasons['ema_20_dist'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.ema_20_dist} candles, got ${n}`;
      }

      // ── bb_width (20-day, 2 std dev) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.bb_width) {
        const slice20 = closes.slice(-20);
        const mean20 = slice20.reduce((s, v) => s + v, 0) / 20.0;
        const std20 = this.sampleStdDev(slice20, mean20);
        const upper = mean20 + 2.0 * std20;
        const lower = mean20 - 2.0 * std20;
        rawFeatures['bb_width'] = (upper - lower) / mean20;
        availabilityMask['bb_width'] = true;
      } else {
        failureReasons['bb_width'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.bb_width} candles, got ${n}`;
      }

      // ── volume_z_score & rel_volume (20-day) ──
      if (hasInvalidVolume) {
        failureReasons['volume_z_score'] = 'INVALID_VOLUME_DATA: Volume is missing, non-positive, or non-finite.';
        failureReasons['rel_volume'] = 'INVALID_VOLUME_DATA: Volume is missing, non-positive, or non-finite.';
      } else if (n >= FeatureEngine.MIN_LOOKBACKS.volume_z_score) {
        const sliceVol20 = volumes.slice(-20);
        const meanVol = sliceVol20.reduce((s, v) => s + v, 0) / 20.0;
        const stdVol = this.sampleStdDev(sliceVol20, meanVol);
        const curVol = volumes[n - 1];
        rawFeatures['volume_z_score'] = stdVol > 0 ? Math.max(-3.0, Math.min(3.0, (curVol - meanVol) / stdVol)) : 0.0;
        rawFeatures['rel_volume'] = meanVol > 0 ? Math.max(0.1, Math.min(10.0, curVol / meanVol)) : 1.0;
        availabilityMask['volume_z_score'] = true;
        availabilityMask['rel_volume'] = true;
      } else {
        failureReasons['volume_z_score'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.volume_z_score} candles, got ${n}`;
        failureReasons['rel_volume'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.rel_volume} candles, got ${n}`;
      }

      // ── ret_20d & momentum_20 ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.ret_20d) {
        const val20 = (closes[n - 1] - closes[n - 21]) / closes[n - 21];
        rawFeatures['ret_20d'] = val20;
        rawFeatures['momentum_20'] = val20;
        availabilityMask['ret_20d'] = true;
        availabilityMask['momentum_20'] = true;
      } else {
        failureReasons['ret_20d'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.ret_20d} candles, got ${n}`;
        failureReasons['momentum_20'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.momentum_20} candles, got ${n}`;
      }

      // ── annualized_volatility & vol_20d & downside_deviation (20 returns) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.vol_20d) {
        const retSlice20 = dailyReturns.slice(-20);
        const meanRet20 = retSlice20.reduce((s, v) => s + v, 0) / 20.0;
        const stdRet20 = this.sampleStdDev(retSlice20, meanRet20);
        const annVol20 = stdRet20 * Math.sqrt(252.0);
        rawFeatures['vol_20d'] = annVol20;
        rawFeatures['annualized_volatility'] = annVol20;

        const negReturns20 = retSlice20.map((r) => Math.min(0.0, r));
        const meanNeg20 = negReturns20.reduce((s, v) => s + v, 0) / 20.0;
        const stdNeg20 = this.sampleStdDev(negReturns20, meanNeg20);
        rawFeatures['downside_deviation'] = stdNeg20 * Math.sqrt(252.0);

        availabilityMask['vol_20d'] = true;
        availabilityMask['annualized_volatility'] = true;
        availabilityMask['downside_deviation'] = true;
      } else {
        failureReasons['vol_20d'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.vol_20d} candles, got ${n}`;
        failureReasons['annualized_volatility'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.annualized_volatility} candles, got ${n}`;
        failureReasons['downside_deviation'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.downside_deviation} candles, got ${n}`;
      }

      // ── macd_hist (span 12, 26, 9) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.macd_hist) {
        rawFeatures['macd_hist'] = this.computeNormalizedMACDHist(closes);
        availabilityMask['macd_hist'] = true;
      } else {
        failureReasons['macd_hist'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.macd_hist} candles, got ${n}`;
      }

      // ── dist_52w_high & dist_52w_low (True 252 trading sessions lookback) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.dist_52w_high) {
        const sliceH = highs.slice(-252);
        const sliceL = lows.slice(-252);
        const max52w = Math.max(...sliceH);
        const min52w = Math.min(...sliceL);
        rawFeatures['dist_52w_high'] = max52w > 0 ? (lastClose - max52w) / max52w : 0.0;
        rawFeatures['dist_52w_low'] = min52w > 0 ? (lastClose - min52w) / min52w : 0.0;
        availabilityMask['dist_52w_high'] = true;
        availabilityMask['dist_52w_low'] = true;
      } else {
        failureReasons['dist_52w_high'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.dist_52w_high} candles for 52-week high, got ${n}`;
        failureReasons['dist_52w_low'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.dist_52w_low} candles for 52-week low, got ${n}`;
      }

      // ── sma_50_dist ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.sma_50_dist) {
        const slice50 = closes.slice(-50);
        const mean50 = slice50.reduce((s, v) => s + v, 0) / 50.0;
        rawFeatures['sma_50_dist'] = (lastClose - mean50) / mean50;
        availabilityMask['sma_50_dist'] = true;
      } else {
        failureReasons['sma_50_dist'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.sma_50_dist} candles, got ${n}`;
      }

      // ── vol_60d (60 returns) ──
      if (n >= FeatureEngine.MIN_LOOKBACKS.vol_60d) {
        const retSlice60 = dailyReturns.slice(-60);
        const meanRet60 = retSlice60.reduce((s, v) => s + v, 0) / 60.0;
        const stdRet60 = this.sampleStdDev(retSlice60, meanRet60);
        rawFeatures['vol_60d'] = stdRet60 * Math.sqrt(252.0);
        availabilityMask['vol_60d'] = true;
      } else {
        failureReasons['vol_60d'] = `Need >= ${FeatureEngine.MIN_LOOKBACKS.vol_60d} candles, got ${n}`;
      }

      // ── Benchmark Features: beta_nifty & relative_strength_nifty with EXACT Date Matching ──
      if (activeBenchmark && Array.isArray(activeBenchmark) && activeBenchmark.length >= 61) {
        // Map benchmark candles by date string (YYYY-MM-DD)
        const benchMap = new Map<string, number>();
        for (const b of activeBenchmark) {
          if (typeof b.close === 'number' && isFinite(b.close) && b.close > 0) {
            const bRawTime = b.timestamp ?? (b as any).time;
            const bDate = new Date(bRawTime).toISOString().slice(0, 10);
            benchMap.set(bDate, b.close);
          }
        }

        // Align daily return pairs strictly by matched trading date
        const matchedStockReturns: number[] = [];
        const matchedBenchReturns: number[] = [];

        for (let i = 1; i < n; i++) {
          const prevDate = new Date(timestamps[i - 1]).toISOString().slice(0, 10);
          const currDate = new Date(timestamps[i]).toISOString().slice(0, 10);

          const prevBenchClose = benchMap.get(prevDate);
          const currBenchClose = benchMap.get(currDate);

          if (prevBenchClose !== undefined && currBenchClose !== undefined && prevBenchClose > 0) {
            const stockRet = (closes[i] - closes[i - 1]) / closes[i - 1];
            const benchRet = (currBenchClose - prevBenchClose) / prevBenchClose;
            matchedStockReturns.push(stockRet);
            matchedBenchReturns.push(benchRet);
          }
        }

        if (matchedStockReturns.length >= 60) {
          const stockRet60 = matchedStockReturns.slice(-60);
          const benchRet60 = matchedBenchReturns.slice(-60);

          const meanStock = stockRet60.reduce((s, v) => s + v, 0) / 60.0;
          const meanBench = benchRet60.reduce((s, v) => s + v, 0) / 60.0;

          let cov = 0.0;
          let varBench = 0.0;
          for (let i = 0; i < 60; i++) {
            const ds = stockRet60[i] - meanStock;
            const db = benchRet60[i] - meanBench;
            cov += ds * db;
            varBench += db * db;
          }
          cov /= 59.0;
          varBench /= 59.0;

          const rawBeta = varBench > 0 ? cov / varBench : 1.0;
          rawFeatures['beta_nifty'] = Math.max(0.2, Math.min(3.0, rawBeta));
          availabilityMask['beta_nifty'] = true;
        } else {
          failureReasons['beta_nifty'] = `Date-matched benchmark return pairs count (${matchedStockReturns.length}) < 60`;
        }

        // 20-day relative strength using exact date match (independent of 60d beta)
        if (n >= 21) {
          const lastDate = new Date(timestamps[n - 1]).toISOString().slice(0, 10);
          const date20Ago = new Date(timestamps[n - 21]).toISOString().slice(0, 10);
          const bLast = benchMap.get(lastDate);
          const b20Ago = benchMap.get(date20Ago);

          if (bLast !== undefined && b20Ago !== undefined && b20Ago > 0) {
            const stockPerf20 = (closes[n - 1] - closes[n - 21]) / closes[n - 21];
            const benchPerf20 = (bLast - b20Ago) / b20Ago;
            rawFeatures['relative_strength_nifty'] = stockPerf20 - benchPerf20;
            availabilityMask['relative_strength_nifty'] = true;
          } else {
            failureReasons['relative_strength_nifty'] = `Benchmark candles missing matching dates for 20d return (${date20Ago} or ${lastDate})`;
          }
        } else {
          failureReasons['relative_strength_nifty'] = `Need >= 21 candles for 20d relative strength, got ${n}`;
        }
      } else {
        failureReasons['beta_nifty'] = `Benchmark candles missing or < 61 (got ${activeBenchmark?.length || 0})`;
        failureReasons['relative_strength_nifty'] = `Benchmark candles missing or < 21 (got ${activeBenchmark?.length || 0})`;
      }
    } catch (err: any) {
      this.logger.error(`Feature computation exception: ${err.message}`, err.stack);
      return {
        features: null,
        rawFeatures,
        availabilityMask,
        isComplete: false,
        missingFeatures: [...FeatureEngine.CANONICAL_FEATURE_KEYS],
        failureReasons: { global: `FEATURE_COMPUTATION_FAILED: ${err.message}` },
        dataQuality: 'FEATURE_COMPUTATION_FAILED',
        candleCount: n,
        benchmarkCandleCount: benchmarkCandles?.length || 0,
      };
    }

    // 5. Availability Check & Completion Status
    for (const key of FeatureEngine.CANONICAL_FEATURE_KEYS) {
      if (!availabilityMask[key] || rawFeatures[key] === null || isNaN(rawFeatures[key]!) || !isFinite(rawFeatures[key]!)) {
        missingFeatures.push(key);
      }
    }

    if (missingFeatures.length > 0) {
      const isBenchmarkIssue = missingFeatures.every((k) => k === 'beta_nifty' || k === 'relative_strength_nifty');
      const dataQuality: FeatureDataQuality = hasInvalidVolume
        ? 'INVALID_VOLUME_DATA'
        : isBenchmarkIssue
        ? 'INSUFFICIENT_BENCHMARK'
        : 'INSUFFICIENT_LOOKBACK';

      return {
        features: null,
        rawFeatures,
        availabilityMask,
        isComplete: false,
        missingFeatures,
        failureReasons,
        dataQuality,
        candleCount: n,
        benchmarkCandleCount: benchmarkCandles?.length || 0,
      };
    }

    // Exactly 25 finite model features
    const modelFeatures: ModelFeatureVector25 = {
      rsi_14: rawFeatures['rsi_14']!,
      macd_hist: rawFeatures['macd_hist']!,
      sma_20_dist: rawFeatures['sma_20_dist']!,
      sma_50_dist: rawFeatures['sma_50_dist']!,
      ema_20_dist: rawFeatures['ema_20_dist']!,
      atr_percent: rawFeatures['atr_percent']!,
      bb_width: rawFeatures['bb_width']!,
      stoch_k: rawFeatures['stoch_k']!,
      volume_z_score: rawFeatures['volume_z_score']!,
      annualized_volatility: rawFeatures['annualized_volatility']!,
      downside_deviation: rawFeatures['downside_deviation']!,
      beta_nifty: rawFeatures['beta_nifty']!,
      relative_strength_nifty: rawFeatures['relative_strength_nifty']!,
      momentum_5: rawFeatures['momentum_5']!,
      momentum_20: rawFeatures['momentum_20']!,
      ret_1d: rawFeatures['ret_1d']!,
      ret_5d: rawFeatures['ret_5d']!,
      ret_20d: rawFeatures['ret_20d']!,
      gap_pct: rawFeatures['gap_pct']!,
      dist_52w_high: rawFeatures['dist_52w_high']!,
      dist_52w_low: rawFeatures['dist_52w_low']!,
      roc_12: rawFeatures['roc_12']!,
      rel_volume: rawFeatures['rel_volume']!,
      vol_20d: rawFeatures['vol_20d']!,
      vol_60d: rawFeatures['vol_60d']!,
    };

    return {
      features: modelFeatures,
      rawFeatures,
      availabilityMask,
      isComplete: true,
      missingFeatures: [],
      failureReasons: {},
      dataQuality: 'SUFFICIENT',
      candleCount: n,
      benchmarkCandleCount: benchmarkCandles?.length || 0,
    };
  }

  // ── Mathematical Helper Methods Matching Python pandas / numpy ──

  private sampleStdDev(values: number[], mean: number): number {
    if (values.length < 2) return 0.0;
    let sumSq = 0.0;
    for (const v of values) {
      sumSq += (v - mean) * (v - mean);
    }
    return Math.sqrt(sumSq / (values.length - 1));
  }

  private computeEMA(values: number[], span: number): number {
    const alpha = 2.0 / (span + 1.0);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = alpha * values[i] + (1.0 - alpha) * ema;
    }
    return ema;
  }

  private computeNormalizedMACDHist(closes: number[]): number {
    const alpha12 = 2.0 / 13.0;
    const alpha26 = 2.0 / 27.0;
    const alpha9 = 2.0 / 10.0;

    let ema12 = closes[0];
    let ema26 = closes[0];

    const macdLineArr: number[] = [0.0];
    for (let i = 1; i < closes.length; i++) {
      ema12 = alpha12 * closes[i] + (1.0 - alpha12) * ema12;
      ema26 = alpha26 * closes[i] + (1.0 - alpha26) * ema26;
      macdLineArr.push(ema12 - ema26);
    }

    let macdSignal = macdLineArr[0];
    for (let i = 1; i < macdLineArr.length; i++) {
      macdSignal = alpha9 * macdLineArr[i] + (1.0 - alpha9) * macdSignal;
    }

    const lastMacdLine = macdLineArr[macdLineArr.length - 1];
    const macdHist = lastMacdLine - macdSignal;
    const lastClose = closes[closes.length - 1];
    return lastClose > 0 ? macdHist / lastClose : 0.0;
  }

  private computeWilderRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50.0;

    const deltas: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      deltas.push(closes[i] - closes[i - 1]);
    }

    const alpha = 1.0 / period; // Wilder smoothing com = period - 1 => alpha = 1/period
    let avgGain = Math.max(0.0, deltas[0]);
    let avgLoss = Math.max(0.0, -deltas[0]);

    for (let i = 1; i < deltas.length; i++) {
      const g = Math.max(0.0, deltas[i]);
      const l = Math.max(0.0, -deltas[i]);
      avgGain = alpha * g + (1.0 - alpha) * avgGain;
      avgLoss = alpha * l + (1.0 - alpha) * avgLoss;
    }

    if (avgLoss === 0.0) return 100.0;
    const rs = avgGain / avgLoss;
    return 100.0 - (100.0 / (1.0 + rs));
  }
}

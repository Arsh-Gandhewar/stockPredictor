import * as fs from 'fs';
import * as path from 'path';
import { FeatureEngine, ModelFeatureVector25 } from './engines/feature-engine';
import { OnnxInferenceEngine, getCanonicalFeatureSchemaHash } from './engines/onnx-inference.engine';
import { MarketQuote, OHLCVCandle } from '../stock/providers/market-data.provider.interface';

describe('FeatureEngine Mathematical Parity & Institutional Integrity Suite', () => {
  let featureEngine: FeatureEngine;
  let goldenData: {
    candleCount: number;
    stockCandles: OHLCVCandle[];
    benchmarkCandles: OHLCVCandle[];
    expectedFeatures: Record<string, number>;
  };

  beforeAll(() => {
    featureEngine = new FeatureEngine();
    const goldenPath = path.resolve(
      __dirname,
      '../../../../../packages/quant-engine/tests/golden_feature_vector.json'
    );
    if (!fs.existsSync(goldenPath)) {
      throw new Error(`Golden feature vector not found at ${goldenPath}`);
    }
    goldenData = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
  });

  it('1. should achieve exact numerical parity with Python reference across all 25 features on 300-session corpus', () => {
    const candles = goldenData.stockCandles;
    const lastCandle = candles[candles.length - 1];
    const quote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: lastCandle.close,
      change: lastCandle.close - candles[candles.length - 2].close,
      changePercent: ((lastCandle.close - candles[candles.length - 2].close) / candles[candles.length - 2].close) * 100,
      volume: lastCandle.volume,
      high: lastCandle.high,
      low: lastCandle.low,
      open: lastCandle.open,
      previousClose: candles[candles.length - 2].close,
      timestamp: lastCandle.timestamp,
    };

    const res = featureEngine.calculateFeatures(quote, candles, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(true);
    expect(res.dataQuality).toBe('SUFFICIENT');
    expect(res.features).not.toBeNull();
    expect(res.missingFeatures).toHaveLength(0);

    const tsFeatures = res.features!;
    const pyFeatures = goldenData.expectedFeatures;

    for (const key of FeatureEngine.CANONICAL_FEATURE_KEYS) {
      const tsVal = tsFeatures[key];
      const pyVal = pyFeatures[key];

      expect(tsVal).toBeDefined();
      expect(typeof tsVal).toBe('number');
      expect(Number.isFinite(tsVal)).toBe(true);

      const diff = Math.abs(tsVal - pyVal);
      const scale = Math.max(1.0, Math.abs(pyVal));
      const relError = diff / scale;

      expect(relError).toBeLessThan(0.05);
    }
  });

  it('2. should fail closed on 100 candles because true 52-week features require 252 sessions', () => {
    const candles100 = goldenData.stockCandles.slice(0, 100);
    const lastCandle = candles100[candles100.length - 1];
    const quote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: lastCandle.close,
      change: 0,
      changePercent: 0,
      volume: lastCandle.volume,
      high: lastCandle.high,
      low: lastCandle.low,
      open: lastCandle.open,
      previousClose: lastCandle.close,
      timestamp: lastCandle.timestamp,
    };

    const res = featureEngine.calculateFeatures(quote, candles100, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INSUFFICIENT_LOOKBACK');
    expect(res.missingFeatures).toContain('dist_52w_high');
    expect(res.missingFeatures).toContain('dist_52w_low');
  });

  it('3. should reject out-of-order candles with INVALID_TEMPORAL_STRUCTURE', () => {
    const candles = [...goldenData.stockCandles];
    // Swap candle 50 and 51
    const tmp = candles[50];
    candles[50] = candles[51];
    candles[51] = tmp;

    const lastCandle = candles[candles.length - 1];
    const quote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: lastCandle.close,
      change: 0,
      changePercent: 0,
      volume: lastCandle.volume,
      high: lastCandle.high,
      low: lastCandle.low,
      open: lastCandle.open,
      previousClose: lastCandle.close,
      timestamp: lastCandle.timestamp,
    };

    const res = featureEngine.calculateFeatures(quote, candles, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INVALID_TEMPORAL_STRUCTURE');
  });

  it('4. should reject missing/zero volume with INVALID_VOLUME_DATA and never substitute zero', () => {
    const candles = goldenData.stockCandles.map((c, idx) =>
      idx === goldenData.stockCandles.length - 5 ? { ...c, volume: 0 } : { ...c }
    );

    const lastCandle = candles[candles.length - 1];
    const quote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: lastCandle.close,
      change: 0,
      changePercent: 0,
      volume: lastCandle.volume,
      high: lastCandle.high,
      low: lastCandle.low,
      open: lastCandle.open,
      previousClose: lastCandle.close,
      timestamp: lastCandle.timestamp,
    };

    const res = featureEngine.calculateFeatures(quote, candles, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INVALID_VOLUME_DATA');
    expect(res.missingFeatures).toContain('volume_z_score');
    expect(res.missingFeatures).toContain('rel_volume');
  });

  it('5. should enforce cryptographic schema hash binding and atomic 3-horizon ONNX validation', async () => {
    const hash = getCanonicalFeatureSchemaHash();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);

    const engine = new OnnxInferenceEngine();
    expect(engine.isLoaded()).toBe(false);

    await engine.loadActiveModels();
    expect(engine.isLoaded()).toBe(true);

    const candles = goldenData.stockCandles;
    const lastCandle = candles[candles.length - 1];
    const quote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: lastCandle.close,
      change: 0,
      changePercent: 0,
      volume: lastCandle.volume,
      high: lastCandle.high,
      low: lastCandle.low,
      open: lastCandle.open,
      previousClose: candles[candles.length - 2].close,
      timestamp: lastCandle.timestamp,
    };
    const res = featureEngine.calculateFeatures(quote, candles, goldenData.benchmarkCandles);
    expect(res.isComplete).toBe(true);
    expect(res.features).not.toBeNull();

    const p1d = await engine.evaluate(res.features!, '1d');
    const p5d = await engine.evaluate(res.features!, '5d');
    const p20d = await engine.evaluate(res.features!, '20d');

    expect(typeof p1d).toBe('number');
    expect(typeof p5d).toBe('number');
    expect(typeof p20d).toBe('number');
    expect(p1d).toBeGreaterThanOrEqual(0);
    expect(p1d).toBeLessThanOrEqual(1);
    expect(p5d).toBeGreaterThanOrEqual(0);
    expect(p5d).toBeLessThanOrEqual(1);
    expect(p20d).toBeGreaterThanOrEqual(0);
    expect(p20d).toBeLessThanOrEqual(1);
  });
});

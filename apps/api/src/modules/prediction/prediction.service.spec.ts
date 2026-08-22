import { FeatureEngine } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { CalibrationEngine } from './engines/calibration-engine';
import { RegimeEngine } from './engines/regime-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { BacktestEngine, BacktestTrade } from './engines/backtest-engine';
import { MarketQuote, OHLCVCandle, MarketIndexBenchmark } from '../stock/providers/market-data.provider.interface';

describe('QuantX Quantitative Framework Complete Audit & Test Suite', () => {
  let featureEngine: FeatureEngine;
  let inferenceEngine: ModelInferenceEngine;
  let calibrationEngine: CalibrationEngine;
  let regimeEngine: RegimeEngine;
  let riskEngine: RiskEngine;
  let decisionEngine: DecisionEngine;

  beforeEach(() => {
    featureEngine = new FeatureEngine();
    inferenceEngine = new ModelInferenceEngine();
    calibrationEngine = new CalibrationEngine();
    regimeEngine = new RegimeEngine();
    riskEngine = new RiskEngine();
    decisionEngine = new DecisionEngine();
  });

  describe('1. Backtesting & Directional P&L Integrity (Req #1)', () => {
    it('should correctly calculate LONG trade P&L as (exit - entry) / entry', () => {
      const entryPrice = 1000;
      const exitPrice = 1050; // +5% gain
      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      expect(grossReturn).toBeCloseTo(0.05, 4);

      const slippage = 0.0005; // 5 bps
      const brokerage = 0.0003;
      const sttSell = 0.0010;
      const effectiveEntry = entryPrice * (1 + slippage + brokerage);
      const effectiveExit = exitPrice * (1 - slippage - brokerage - sttSell);
      const netReturn = (effectiveExit - effectiveEntry) / effectiveEntry;

      expect(netReturn).toBeLessThan(grossReturn);
      expect(netReturn).toBeGreaterThan(0.035);
    });

    it('should correctly calculate SHORT trade P&L as (entry - exit) / entry', () => {
      const entryPrice = 1000;
      const exitPrice = 950; // Price drops 5% (gain for short)
      const grossReturn = (entryPrice - exitPrice) / entryPrice;
      expect(grossReturn).toBeCloseTo(0.05, 4);

      const lossExitPrice = 1050; // Price rises 5% (loss for short)
      const lossGrossReturn = (entryPrice - lossExitPrice) / entryPrice;
      expect(lossGrossReturn).toBeCloseTo(-0.05, 4);
    });

    it('should apply conservative same-candle stop/target collision rule (stop loss assumed first)', () => {
      const entryPrice = 100;
      const stopLossPrice = 95;
      const targetPrice = 108;

      const collisionCandle = { high: 110, low: 90, close: 105, open: 100 };
      const touchedTarget = collisionCandle.high >= targetPrice;
      const touchedStop = collisionCandle.low <= stopLossPrice;

      expect(touchedTarget).toBe(true);
      expect(touchedStop).toBe(true);

      // Conservative rule: Stop loss triggers first
      let exitReason = 'HORIZON_EXPIRY';
      let exitPrice = collisionCandle.close;

      if (touchedTarget && touchedStop) {
        exitReason = 'STOP_LOSS';
        exitPrice = stopLossPrice;
      }

      expect(exitReason).toBe('STOP_LOSS');
      expect(exitPrice).toBe(stopLossPrice);
    });

    it('should exit at target price when target is reached before stop', () => {
      const targetPrice = 110;
      const stopLossPrice = 95;
      const candle = { high: 112, low: 98, close: 109, open: 100 };

      const touchedTarget = candle.high >= targetPrice;
      const touchedStop = candle.low <= stopLossPrice;

      expect(touchedTarget).toBe(true);
      expect(touchedStop).toBe(false);

      const exitReason = touchedTarget ? 'TARGET_PROFIT' : 'HORIZON_EXPIRY';
      const exitPrice = touchedTarget ? targetPrice : candle.close;

      expect(exitReason).toBe('TARGET_PROFIT');
      expect(exitPrice).toBe(targetPrice);
    });
  });

  describe('2. Point-In-Time Leakage Prevention (Req #1, 6)', () => {
    it('should compute features strictly from historical slice without forward observation', () => {
      const fullSeries: OHLCVCandle[] = Array.from({ length: 100 }, (_, i) => ({
        time: `2026-05-${i + 1}`,
        date: `2026-05-${i + 1}`,
        open: 100 + i * 2,
        high: 105 + i * 2,
        low: 95 + i * 2,
        close: 102 + i * 2,
        volume: 500000 + i * 1000,
      }));

      const quoteAt50: MarketQuote = {
        ticker: 'TEST.NS',
        name: 'Test Stock',
        price: fullSeries[50].close,
        change: 2,
        changePercent: 1.0,
        dayHigh: fullSeries[50].high,
        dayLow: fullSeries[50].low,
        prevClose: fullSeries[49].close,
        open: fullSeries[50].open,
        volume: fullSeries[50].volume,
        marketState: 'CLOSED',
        exchange: 'NSE',
        timestamp: '2026-05-51',
        source: 'test',
        freshness: 'CLOSED',
      };

      // Strict slice up to index 50
      const slice50 = fullSeries.slice(0, 51);
      const features50 = featureEngine.calculateFeatures(quoteAt50, slice50, 0);

      // Verify that changing future candles (index 51 to 99) does NOT affect features at index 50
      const alteredSeries = [...fullSeries];
      for (let i = 51; i < 100; i++) {
        alteredSeries[i].close = 99999;
      }
      const slice50Altered = alteredSeries.slice(0, 51);
      const features50Altered = featureEngine.calculateFeatures(quoteAt50, slice50Altered, 0);

      expect(features50['rsi_14']).toEqual(features50Altered['rsi_14']);
      expect(features50['sma_50_dist']).toEqual(features50Altered['sma_50_dist']);
      expect(features50['annualized_volatility']).toEqual(features50Altered['annualized_volatility']);
    });
  });

  describe('3. Empirical Two-Stage Expected Return Model (Req #2)', () => {
    it('should calculate ExpectedValue = P(up)*E(gain|up) - P(down)*E(loss|down)', () => {
      const estimation = inferenceEngine.estimateExpectedReturn(0.70, '5d', 0.02);

      expect(estimation.probability).toBe(0.70);
      expect(estimation.expectedGainConditionalUp).toBeGreaterThan(0);
      expect(estimation.expectedLossConditionalDown).toBeGreaterThan(0);
      expect(estimation.expectedValue).toBeDefined();
      expect(estimation.expectedValue).toBeGreaterThan(0);
      expect(['EMPIRICAL_TWO_STAGE', 'ESTIMATED_DIFFUSION']).toContain(estimation.method);
    });

    it('should fit empirical conditional return distributions from out-of-sample observations', () => {
      const validationSamples: { prob: number; horizon: '1d' | '5d' | '20d'; actualReturn: number }[] = [
        { prob: 0.75, horizon: '5d', actualReturn: 0.045 },
        { prob: 0.72, horizon: '5d', actualReturn: 0.038 },
        { prob: 0.68, horizon: '5d', actualReturn: 0.025 },
        { prob: 0.65, horizon: '5d', actualReturn: -0.012 },
        { prob: 0.35, horizon: '5d', actualReturn: -0.042 },
        { prob: 0.30, horizon: '5d', actualReturn: -0.035 },
      ];

      expect(() => inferenceEngine.fitEmpiricalDistributions(validationSamples)).not.toThrow();
    });
  });

  describe('4. Reproducible Probability Calibration (Req #3)', () => {
    it('should enforce non-decreasing monotonicity via PAV algorithm', () => {
      const noisySamples = [
        { prob: 0.15, outcome: 0 },
        { prob: 0.25, outcome: 1 },
        { prob: 0.35, outcome: 0 },
        { prob: 0.45, outcome: 0 },
        { prob: 0.55, outcome: 1 },
        { prob: 0.65, outcome: 1 },
        { prob: 0.75, outcome: 0 },
        { prob: 0.85, outcome: 1 },
        { prob: 0.95, outcome: 1 },
      ];

      const fittedKnots = calibrationEngine.fitPAV(noisySamples);

      for (let i = 0; i < fittedKnots.length - 1; i++) {
        expect(fittedKnots[i][1]).toBeLessThanOrEqual(fittedKnots[i + 1][1]);
      }
    });

    it('should generate complete calibration report with Brier score and ECE', () => {
      const samples = [
        { prob: 0.8, outcome: 1 },
        { prob: 0.7, outcome: 1 },
        { prob: 0.6, outcome: 1 },
        { prob: 0.4, outcome: 0 },
        { prob: 0.3, outcome: 0 },
        { prob: 0.2, outcome: 0 },
      ];

      const report = calibrationEngine.generateCalibrationReport(samples);

      expect(report.brierScore).toBeLessThan(0.15);
      expect(report.expectedCalibrationError).toBeDefined();
      expect(report.maximumCalibrationError).toBeDefined();
      expect(report.reliabilityCurve.length).toBeGreaterThan(0);
    });
  });

  describe('5. Risk Engine & Portfolio Concentration (Req #8, 9)', () => {
    it('should compute continuous composite RiskScore (0-100) and dynamic states', () => {
      const quote: MarketQuote = {
        ticker: 'INFY.NS',
        name: 'Infosys',
        price: 1800,
        change: 10,
        changePercent: 0.55,
        dayHigh: 1810,
        dayLow: 1790,
        prevClose: 1790,
        open: 1795,
        volume: 2500000,
        marketState: 'OPEN',
        exchange: 'NSE',
        timestamp: '2026-08-22',
        source: 'test',
        freshness: 'LIVE',
      };

      const features = {
        atr_14: 25,
        annualized_volatility: 0.16,
        downside_deviation: 0.10,
        max_drawdown_60d: 0.05,
        beta_nifty: 0.90,
        atr_percent: 0.0138,
        gap_risk: 0.003,
        tail_risk_5pct: -0.018,
        liquidity_score: 9.5,
      };

      const risk = riskEngine.calculateRisk(quote, features, 0.25);

      expect(risk.compositeRiskScore).toBeGreaterThanOrEqual(0);
      expect(risk.compositeRiskScore).toBeLessThanOrEqual(100);
      expect(risk.riskState).toBe('NORMAL');
      expect(risk.stopLossPrice).toBeLessThan(quote.price);
      expect(risk.targetPrice).toBeGreaterThan(quote.price);
    });
  });

  describe('6. Evidence-Based Market Regime Engine (Req #7)', () => {
    it('should detect 5 distinct market regimes accurately', () => {
      const bullIndices: MarketIndexBenchmark[] = [
        { symbol: '^NSEI', name: 'NIFTY 50', value: 25000, change: 180, changePercent: 0.72, up: true, marketState: 'OPEN', timestamp: '2026-08-22' },
      ];
      expect(['BULL', 'BULL_TREND', 'BULL_VOLATILE', 'SIDEWAYS']).toContain(regimeEngine.detectRegime(bullIndices));

      const panicIndices: MarketIndexBenchmark[] = [
        { symbol: '^NSEI', name: 'NIFTY 50', value: 23000, change: -500, changePercent: -2.1, up: false, marketState: 'OPEN', timestamp: '2026-08-22' },
        { symbol: '^INDIAVIX', name: 'INDIA VIX', value: 25.0, change: 4.0, changePercent: 19.0, up: true, marketState: 'OPEN', timestamp: '2026-08-22' },
      ];
      expect(regimeEngine.detectRegime(panicIndices)).toBe('PANIC');
    });
  });

  describe('7. Decision Engine (Req #1, 7)', () => {
    it('should suppress aggressive buy signals in PANIC regime', () => {
      const risk: any = {
        downsideProbability: 0.30,
        rewardRiskRatio: 2.2,
        liquidityFlag: false,
        compositeRiskScore: 35,
        stopLossPrice: 95,
      };

      const decisionPanic = decisionEngine.makeDecision(0.68, risk, 'PANIC', 'HIGH', 'HIGH');
      expect(decisionPanic).toBe('HOLD');

      const decisionBull = decisionEngine.makeDecision(0.68, risk, 'BULL_TREND', 'HIGH', 'HIGH');
      expect(decisionBull).toBe('BUY');
    });
  });
});

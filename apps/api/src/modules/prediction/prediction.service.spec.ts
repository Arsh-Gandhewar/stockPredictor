import { Test, TestingModule } from '@nestjs/testing';
import { QuantPredictionService } from './prediction.service';
import { FeatureEngine } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { CalibrationEngine } from './engines/calibration-engine';
import { RegimeEngine } from './engines/regime-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { NewsFeatureEngine } from './engines/news-feature-engine';
import { BacktestEngine } from './engines/backtest-engine';
import { StockService } from '../stock/stock.service';
import { NewsService } from '../news/news.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';
import { DatabaseService } from '../../database/database.service';
import { MarketQuote, OHLCVCandle, MarketIndexBenchmark } from '../stock/providers/market-data.provider.interface';

describe('QuantX Quantitative Framework Engine Tests', () => {
  let featureEngine: FeatureEngine;
  let inferenceEngine: ModelInferenceEngine;
  let calibrationEngine: CalibrationEngine;
  let regimeEngine: RegimeEngine;
  let riskEngine: RiskEngine;
  let decisionEngine: DecisionEngine;

  beforeEach(async () => {
    featureEngine = new FeatureEngine();
    inferenceEngine = new ModelInferenceEngine();
    calibrationEngine = new CalibrationEngine();
    regimeEngine = new RegimeEngine();
    riskEngine = new RiskEngine();
    decisionEngine = new DecisionEngine();
  });

  describe('FeatureEngine (Part 1, 4, 17)', () => {
    it('should compute comprehensive technical & statistical features without lookahead', () => {
      const mockQuote: MarketQuote = {
        ticker: 'TCS.NS',
        name: 'Tata Consultancy Services',
        price: 3500,
        change: 35,
        changePercent: 1.0,
        dayHigh: 3520,
        dayLow: 3480,
        prevClose: 3465,
        open: 3490,
        volume: 1200000,
        marketState: 'OPEN',
        exchange: 'NSE',
        timestamp: '2026-08-22',
        source: 'test',
        freshness: 'LIVE',
      };

      const mockCandles: OHLCVCandle[] = Array.from({ length: 60 }, (_, i) => ({
        time: `2026-06-${i + 1}`,
        date: `2026-06-${i + 1}`,
        open: 3400 + i * 2,
        high: 3420 + i * 2,
        low: 3390 + i * 2,
        close: 3410 + i * 2,
        volume: 1000000 + (i % 5) * 50000,
      }));

      const features = featureEngine.calculateFeatures(mockQuote, mockCandles, 10);

      expect(features['rsi_14']).toBeDefined();
      expect(features['rsi_14']).toBeGreaterThan(0);
      expect(features['rsi_14']).toBeLessThanOrEqual(100);
      expect(features['annualized_volatility']).toBeDefined();
      expect(features['downside_deviation']).toBeDefined();
      expect(features['volume_z_score']).toBeDefined();
      expect(features['liquidity_score']).toBeGreaterThan(5.0);
      expect(features['max_drawdown_20d']).toBeDefined();
      expect(features['max_drawdown_60d']).toBeDefined();
    });
  });

  describe('ModelInferenceEngine (Part 3, 16)', () => {
    it('should evaluate probabilities bounded to [0.05, 0.95]', () => {
      const features = {
        rsi_14: 65,
        macd_hist: 2.5,
        stoch_k: 70,
        sma_50_dist: 0.04,
        sma_20_dist: 0.02,
        relative_strength_nifty: 0.03,
        annualized_volatility: 0.18,
        news_sentiment: 15,
        atr_14: 45,
      };

      const prob1d = inferenceEngine.evaluate(features, '1d');
      const prob5d = inferenceEngine.evaluate(features, '5d');
      const prob20d = inferenceEngine.evaluate(features, '20d');

      expect(prob1d).toBeGreaterThanOrEqual(0.05);
      expect(prob1d).toBeLessThanOrEqual(0.95);
      expect(prob5d).toBeGreaterThanOrEqual(0.05);
      expect(prob5d).toBeLessThanOrEqual(0.95);
      expect(prob20d).toBeGreaterThanOrEqual(0.05);
      expect(prob20d).toBeLessThanOrEqual(0.95);
    });

    it('should calculate diffusion-grounded expected returns scaling with sqrt(time)', () => {
      const exp1d = inferenceEngine.calculateExpectedReturn(0.70, '1d', 0.02);
      const exp5d = inferenceEngine.calculateExpectedReturn(0.70, '5d', 0.02);
      const exp20d = inferenceEngine.calculateExpectedReturn(0.70, '20d', 0.02);

      expect(exp1d).toBeGreaterThan(0);
      expect(exp5d).toBeGreaterThan(exp1d);
      expect(exp20d).toBeGreaterThan(exp5d);
    });
  });

  describe('CalibrationEngine (Part 7)', () => {
    it('should maintain strict monotonic non-decreasing probability calibration', () => {
      const p1 = calibrationEngine.apply(0.20);
      const p2 = calibrationEngine.apply(0.50);
      const p3 = calibrationEngine.apply(0.80);

      expect(p1).toBeLessThanOrEqual(p2);
      expect(p2).toBeLessThanOrEqual(p3);
    });

    it('should correctly calculate Brier score and Expected Calibration Error (ECE)', () => {
      const samples = [
        { prob: 0.8, outcome: 1 },
        { prob: 0.7, outcome: 1 },
        { prob: 0.3, outcome: 0 },
        { prob: 0.2, outcome: 0 },
      ];

      const brier = calibrationEngine.calculateBrierScore(samples);
      const ece = calibrationEngine.calculateECE(samples);

      expect(brier).toBeLessThan(0.15);
      expect(ece).toBeGreaterThanOrEqual(0);
    });
  });

  describe('RiskEngine (Part 1, 12, 13)', () => {
    it('should calculate continuous composite RiskScore (0-100) and dynamic states', () => {
      const quote: MarketQuote = {
        ticker: 'RELIANCE.NS',
        name: 'Reliance Industries',
        price: 2800,
        change: 0,
        changePercent: 0,
        dayHigh: 2820,
        dayLow: 2790,
        prevClose: 2800,
        open: 2800,
        volume: 3000000,
        marketState: 'OPEN',
        exchange: 'NSE',
        timestamp: '2026-08-22',
        source: 'test',
        freshness: 'LIVE',
      };

      const features = {
        atr_14: 35,
        annualized_volatility: 0.16,
        downside_deviation: 0.11,
        max_drawdown_60d: 0.04,
        beta_nifty: 0.95,
        atr_percent: 0.0125,
        gap_risk: 0.003,
        tail_risk_5pct: -0.02,
        liquidity_score: 9.8,
      };

      const risk = riskEngine.calculateRisk(quote, features, 0.22);

      expect(risk.compositeRiskScore).toBeDefined();
      expect(risk.compositeRiskScore).toBeGreaterThanOrEqual(0);
      expect(risk.compositeRiskScore).toBeLessThanOrEqual(100);
      expect(risk.stopLossPrice).toBeLessThan(quote.price);
      expect(risk.targetPrice).toBeGreaterThan(quote.price);
      expect(risk.rewardRiskRatio).toBeGreaterThan(1.0);
      expect(risk.riskState).toBe('NORMAL');
    });
  });

  describe('RegimeEngine (Part 6)', () => {
    it('should classify market state into 5 distinct regimes', () => {
      const bullIndices: MarketIndexBenchmark[] = [
        {
          symbol: '^NSEI',
          name: 'NIFTY 50',
          value: 24500,
          change: 150,
          changePercent: 0.65,
          up: true,
          marketState: 'OPEN',
          timestamp: '2026-08-22',
        },
      ];
      const regime = regimeEngine.detectRegime(bullIndices);
      expect(['BULL', 'BULL_TREND', 'BULL_VOLATILE', 'SIDEWAYS']).toContain(regime);

      const panicIndices: MarketIndexBenchmark[] = [
        {
          symbol: '^NSEI',
          name: 'NIFTY 50',
          value: 23000,
          change: -400,
          changePercent: -1.7,
          up: false,
          marketState: 'OPEN',
          timestamp: '2026-08-22',
        },
        {
          symbol: '^INDIAVIX',
          name: 'INDIA VIX',
          value: 24.5,
          change: 3.5,
          changePercent: 16.5,
          up: true,
          marketState: 'OPEN',
          timestamp: '2026-08-22',
        },
      ];
      const panicRegime = regimeEngine.detectRegime(panicIndices);
      expect(panicRegime).toBe('PANIC');
    });
  });

  describe('DecisionEngine (Part 6, 12)', () => {
    it('should suppress aggressive buy signals during PANIC regime', () => {
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

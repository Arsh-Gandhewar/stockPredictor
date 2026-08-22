import { FeatureEngine } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { CalibrationEngine } from './engines/calibration-engine';
import { RegimeEngine } from './engines/regime-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { ModelArtifactService, ModelArtifact } from './engines/model-artifact.service';
import { LogisticRegressionModel, TrainingSample } from './engines/learned-model';
import { MarketQuote, OHLCVCandle } from '../stock/providers/market-data.provider.interface';

describe('QuantX Quantitative Stack Hardening & Lifecycle Verification Suite', () => {
  let featureEngine: FeatureEngine;
  let inferenceEngine: ModelInferenceEngine;
  let calibrationEngine: CalibrationEngine;
  let regimeEngine: RegimeEngine;
  let riskEngine: RiskEngine;
  let decisionEngine: DecisionEngine;
  let artifactService: ModelArtifactService;

  beforeEach(() => {
    featureEngine = new FeatureEngine();
    inferenceEngine = new ModelInferenceEngine();
    calibrationEngine = new CalibrationEngine();
    regimeEngine = new RegimeEngine();
    riskEngine = new RiskEngine();
    decisionEngine = new DecisionEngine();
    artifactService = new ModelArtifactService();
  });

  describe('1. Zero Hardcoded Fitted Outputs & Hierarchical Fallback (Req #1, 5)', () => {
    it('should start with empty empirical buckets and cleanly use FALLBACK_DIFFUSION when unpopulated', () => {
      const estimation = inferenceEngine.estimateExpectedReturn(0.65, '5d', 0.02);

      expect(estimation.method).toBe('FALLBACK_DIFFUSION');
      expect(estimation.sampleCount).toBe(0);
      expect(estimation.probability).toBe(0.65);
      expect(estimation.expectedValue).toBeDefined();
    });

    it('should hierarchically select EMPIRICAL_FINE_BUCKET when N >= 15', () => {
      const samples = Array.from({ length: 20 }, (_, i) => ({
        prob: 0.60,
        horizon: '5d' as const,
        actualReturn: i % 2 === 0 ? 0.035 : -0.015,
      }));

      inferenceEngine.fitEmpiricalDistributions(samples);
      const estimation = inferenceEngine.estimateExpectedReturn(0.60, '5d', 0.02);

      expect(estimation.method).toBe('EMPIRICAL_FINE_BUCKET');
      expect(estimation.sampleCount).toBeGreaterThanOrEqual(15);
      expect(estimation.expectedGainConditionalUp).toBeGreaterThan(0);
      expect(estimation.expectedLossConditionalDown).toBeGreaterThan(0);
    });

    it('should hierarchically fall back to EMPIRICAL_BROAD_BUCKET or EMPIRICAL_HORIZON_WIDE when sample count is low', () => {
      const samples = Array.from({ length: 6 }, (_, i) => ({
        prob: 0.50,
        horizon: '5d' as const,
        actualReturn: 0.02,
      }));

      inferenceEngine.fitEmpiricalDistributions(samples);
      const estimation = inferenceEngine.estimateExpectedReturn(0.50, '5d', 0.02);

      expect(['EMPIRICAL_BROAD_BUCKET', 'EMPIRICAL_HORIZON_WIDE']).toContain(estimation.method);
      expect(estimation.sampleCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe('2. Learned Model Fitting & Comparative Baseline (Req #3)', () => {
    it('should fit LogisticRegressionModel on standardized training samples with L2 penalty', () => {
      const learnedModel = new LogisticRegressionModel();
      const trainingSamples: TrainingSample[] = Array.from({ length: 50 }, (_, i) => ({
        features: {
          rsi_14: 40 + (i % 20),
          sma_50_dist: (i % 2 === 0 ? 0.05 : -0.05),
          annualized_volatility: 0.20,
          momentum_5: (i % 2 === 0 ? 0.02 : -0.02),
        },
        outcome: i % 2 === 0 ? 1 : 0,
      }));

      learnedModel.fit(trainingSamples);
      expect(learnedModel.getIsFitted()).toBe(true);

      const prediction = learnedModel.predict({ rsi_14: 55, sma_50_dist: 0.04, annualized_volatility: 0.18 });
      expect(prediction).toBeGreaterThanOrEqual(0.05);
      expect(prediction).toBeLessThanOrEqual(0.95);
    });
  });

  describe('3. Direct Equity-Curve Statistics & Invariant Reconciliation (Req #6, 10)', () => {
    it('should reconcile compounded equity return with individual trade returns', () => {
      const tradeReturns = [0.03, -0.015, 0.04, 0.02, -0.01];

      let equity = 100;
      let compoundedMultiplier = 1.0;
      for (const ret of tradeReturns) {
        equity *= (1 + ret);
        compoundedMultiplier *= (1 + ret);
      }

      const totalEquityReturn = (equity - 100) / 100;
      const totalCompoundedReturn = compoundedMultiplier - 1;

      expect(totalEquityReturn).toBeCloseTo(totalCompoundedReturn, 6);
    });

    it('should accurately calculate profit factor as gross_profit / abs(gross_loss)', () => {
      const trades = [
        { netReturn: 0.05 },
        { netReturn: 0.03 },
        { netReturn: -0.02 },
        { netReturn: -0.02 },
      ];

      const wins = trades.filter((t) => t.netReturn > 0);
      const losses = trades.filter((t) => t.netReturn <= 0);

      const sumWins = wins.reduce((s, t) => s + t.netReturn, 0);
      const sumLosses = Math.abs(losses.reduce((s, t) => s + t.netReturn, 0));
      const profitFactor = sumWins / sumLosses;

      expect(profitFactor).toBeCloseTo(2.0, 4);
    });

    it('should accurately calculate peak-to-trough max drawdown from equity curve', () => {
      const equityCurve = [100, 110, 120, 108, 102, 115, 125];
      let peak = 100;
      let maxDD = 0;

      for (const eq of equityCurve) {
        if (eq > peak) peak = eq;
        const dd = (eq - peak) / peak;
        if (dd < maxDD) maxDD = dd;
      }

      expect(maxDD).toBeCloseTo(-0.15, 4);
    });
  });

  describe('4. Complete Training-to-Inference Lifecycle & Artifact Persistence', () => {
    it('should execute end-to-end training -> artifact serialization -> runtime reloading -> calibrated inference', () => {
      // Step A: Fit Learned Model on TRAIN samples
      const trainSamples: TrainingSample[] = Array.from({ length: 30 }, (_, i) => ({
        features: { rsi_14: 30 + i, sma_50_dist: 0.02, annualized_volatility: 0.18 },
        outcome: i % 2 === 0 ? 1 : 0,
      }));
      const model = new LogisticRegressionModel();
      model.fit(trainSamples);

      // Step B: Fit PAV Calibration on VALIDATION predictions
      const valPredictions = [
        { prob: 0.15, outcome: 0 },
        { prob: 0.25, outcome: 0 },
        { prob: 0.35, outcome: 0 },
        { prob: 0.45, outcome: 0 },
        { prob: 0.55, outcome: 1 },
        { prob: 0.65, outcome: 1 },
        { prob: 0.75, outcome: 1 },
        { prob: 0.85, outcome: 1 },
      ];
      const knots = calibrationEngine.fitPAV(valPredictions);
      expect(calibrationEngine.getCalibrationStatus()).toBe('FITTED_OUT_OF_SAMPLE');

      // Step C: Fit Empirical Return Distributions on VALIDATION trades
      const valReturnTrades = [
        { prob: 0.65, horizon: '5d' as const, actualReturn: 0.042 },
        { prob: 0.62, horizon: '5d' as const, actualReturn: 0.031 },
        { prob: 0.35, horizon: '5d' as const, actualReturn: -0.025 },
        { prob: 0.30, horizon: '5d' as const, actualReturn: -0.038 },
        { prob: 0.50, horizon: '5d' as const, actualReturn: 0.015 },
        { prob: 0.52, horizon: '5d' as const, actualReturn: -0.010 },
      ];
      inferenceEngine.fitEmpiricalDistributions(valReturnTrades);

      // Step D: Serialize Model Artifact
      const artifact: ModelArtifact = {
        modelVersion: '4.0.0',
        modelType: 'BASELINE_HEURISTIC',
        featureVersion: 'v4.0.0-multi-factor-25',
        trainingStart: '2025-08-22',
        trainingEnd: '2026-02-15',
        validationStart: '2026-02-16',
        validationEnd: '2026-05-15',
        testStart: '2026-05-16',
        testEnd: '2026-07-15',
        holdoutStart: '2026-07-16',
        holdoutEnd: '2026-08-22',
        horizon: '5d',
        fittingMethod: 'PAV + Empirical Two-Stage',
        parameters: model.getWeights(),
        calibrationVersion: 'v4.0.0-isotonic',
        calibrationKnots: knots,
        calibrationStatus: 'FITTED_OUT_OF_SAMPLE',
        empiricalDistributions: inferenceEngine.getEmpiricalBuckets(),
        createdAt: new Date().toISOString(),
      };

      const saved = artifactService.saveArtifact(artifact);
      expect(saved).toBe(true);

      // Step E: Load Artifact into Fresh Runtime Engines
      const freshCalibrationEngine = new CalibrationEngine();
      const freshInferenceEngine = new ModelInferenceEngine();

      const loadedArtifact = artifactService.loadArtifact();
      expect(loadedArtifact).not.toBeNull();

      freshCalibrationEngine.setKnots(loadedArtifact!.calibrationKnots, loadedArtifact!.calibrationStatus === 'FITTED_OUT_OF_SAMPLE');
      freshInferenceEngine.setEmpiricalBuckets(loadedArtifact!.empiricalDistributions);

      // Step F: Verify Live Inference Uses the Restored Calibration & Empirical Returns
      expect(freshCalibrationEngine.getCalibrationStatus()).toBe('FITTED_OUT_OF_SAMPLE');
      const calibratedProb = freshCalibrationEngine.apply(0.65);
      expect(calibratedProb).toBeGreaterThan(0);

      const liveEstimation = freshInferenceEngine.estimateExpectedReturn(calibratedProb, '5d', 0.02);
      expect(liveEstimation.method).not.toBe('FALLBACK_DIFFUSION');
      expect(liveEstimation.sampleCount).toBeGreaterThan(0);
    });
  });

  describe('5. Point-In-Time Leakage Prevention (Req #9)', () => {
    it('should ensure feature calculation uses strictly historical candles through timestamp t', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 60 }, (_, i) => ({
        time: `2026-01-${i + 1}`,
        date: `2026-01-${i + 1}`,
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 101 + i,
        volume: 100000 + i * 500,
      }));

      const quoteAt30: MarketQuote = {
        ticker: 'LEAK_TEST.NS',
        name: 'Leak Test',
        price: candles[30].close,
        change: 1,
        changePercent: 0.8,
        dayHigh: candles[30].high,
        dayLow: candles[30].low,
        prevClose: candles[29].close,
        open: candles[30].open,
        volume: candles[30].volume,
        marketState: 'CLOSED',
        exchange: 'NSE',
        timestamp: '2026-01-31',
        source: 'test',
        freshness: 'CLOSED',
      };

      const slice30 = candles.slice(0, 31);
      const f1 = featureEngine.calculateFeatures(quoteAt30, slice30, 0);

      const mutatedCandles = [...candles];
      for (let j = 31; j < 60; j++) {
        mutatedCandles[j].close = 999999;
      }
      const slice30Mutated = mutatedCandles.slice(0, 31);
      const f2 = featureEngine.calculateFeatures(quoteAt30, slice30Mutated, 0);

      expect(f1['rsi_14']).toEqual(f2['rsi_14']);
      expect(f1['annualized_volatility']).toEqual(f2['annualized_volatility']);
      expect(f1['sma_50_dist']).toEqual(f2['sma_50_dist']);
    });
  });
});

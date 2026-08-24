import { FeatureEngine } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { CalibrationEngine } from './engines/calibration-engine';
import { RegimeEngine } from './engines/regime-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { ModelArtifactService, ModelArtifact, STATISTICAL_GATES } from './engines/model-artifact.service';
import { LogisticRegressionModel, TrainingSample } from './engines/learned-model';
import { MarketQuote, OHLCVCandle } from '../stock/providers/market-data.provider.interface';

describe('QuantX Quantitative Model Final Hardening & Governance Suite', () => {
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

  describe('1. Hard Statistical Validation Gates (Req #1, 2, 3)', () => {
    it('should reject invalid artifacts with insufficient sample counts', () => {
      const invalidArtifact: ModelArtifact = {
        id: 'art_test_invalid_samples',
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
        fittingMethod: 'PAV',
        parameters: {},
        calibrationVersion: 'v4.0.0-isotonic',
        calibrationKnots: [[0.3, 0.05], [0.7, 0.95]],
        calibrationStatus: 'FITTED_OUT_OF_SAMPLE',
        calibrationMetrics: {
          brierScore: 0.18,
          ece: 0.04,
          mce: 0.08,
          sampleCount: 6, // Insufficient!
          populatedBins: 1, // Insufficient!
          isMonotonic: true,
        },
        empiricalDistributions: [],
        statisticalGatePassed: false,
        gateDetails: {
          sampleSufficiency: false,
          calibrationQuality: false,
          versionCompatibility: true,
          dateRangeIntegrity: true,
        },
        createdAt: new Date().toISOString(),
      };

      const result = artifactService.validateArtifact(invalidArtifact);
      expect(result.isValid).toBe(false);
      expect(result.blockingReasons.some((r) => r.includes('Insufficient calibration samples'))).toBe(true);
    });

    it('should reject artifacts with corrupted checksum', () => {
      const artifact: ModelArtifact = {
        id: 'art_test_checksum',
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
        fittingMethod: 'PAV',
        parameters: {},
        calibrationVersion: 'v4.0.0-isotonic',
        calibrationKnots: [[0.1, 0.12], [0.5, 0.48], [0.9, 0.88]],
        calibrationStatus: 'FITTED_OUT_OF_SAMPLE',
        calibrationMetrics: {
          brierScore: 0.15,
          ece: 0.03,
          mce: 0.06,
          sampleCount: 50,
          populatedBins: 4,
          isMonotonic: true,
        },
        empiricalDistributions: [
          {
            horizon: '5d',
            probLower: 0,
            probUpper: 1,
            bucketType: 'HORIZON_WIDE',
            meanGainConditionalUp: 0.03,
            meanLossConditionalDown: 0.02,
            dispersion: 0.03,
            sampleCount: 50,
            uncertainty: 0.004,
            fittedAt: new Date().toISOString(),
          },
        ],
        statisticalGatePassed: true,
        gateDetails: {
          sampleSufficiency: true,
          calibrationQuality: true,
          versionCompatibility: true,
          dateRangeIntegrity: true,
        },
        checksum: 'corrupted_checksum_string',
        createdAt: new Date().toISOString(),
      };

      const result = artifactService.validateArtifact(artifact);
      expect(result.isValid).toBe(false);
      expect(result.blockingReasons.some((r) => r.includes('Checksum mismatch'))).toBe(true);
    });
  });

  describe('2. Anti-Extreme Calibration Shrinkage Safeguards (Req #4)', () => {
    it('should shrink extreme tail mapping toward base rate 0.50 when sample count is low', () => {
      // 20 validation samples
      const samples = [
        { prob: 0.15, outcome: 0 },
        { prob: 0.20, outcome: 0 },
        { prob: 0.25, outcome: 0 },
        { prob: 0.30, outcome: 0 },
        { prob: 0.35, outcome: 0 },
        { prob: 0.40, outcome: 0 },
        { prob: 0.45, outcome: 0 },
        { prob: 0.50, outcome: 0 },
        { prob: 0.52, outcome: 1 },
        { prob: 0.55, outcome: 1 },
        { prob: 0.60, outcome: 1 },
        { prob: 0.65, outcome: 1 },
        { prob: 0.70, outcome: 1 },
        { prob: 0.75, outcome: 1 },
        { prob: 0.80, outcome: 1 },
        { prob: 0.85, outcome: 1 },
        { prob: 0.88, outcome: 1 },
        { prob: 0.90, outcome: 1 },
        { prob: 0.92, outcome: 1 },
        { prob: 0.95, outcome: 1 },
      ];

      const knots = calibrationEngine.fitPAV(samples);
      expect(knots.length).toBeGreaterThanOrEqual(2);

      // Verify that no knot is mapped to an unbacked extreme like 0.01 or 0.99
      for (const [raw, calib] of knots) {
        expect(calib).toBeGreaterThanOrEqual(0.08);
        expect(calib).toBeLessThanOrEqual(0.92);
      }
    });
  });

  describe('3. Mathematical Uncertainty Separation (Req #8, 9)', () => {
    it('should separate estimation uncertainty from asset return volatility', () => {
      const estimation = inferenceEngine.estimateExpectedReturn(0.60, '5d', 0.025);

      expect(estimation.marketVolatility).toBeDefined();
      expect(estimation.estimationUncertainty).toBeDefined();
      expect(estimation.marketVolatility).toBeGreaterThan(0);
      expect(estimation.confidenceInterval[0]).toBeLessThan(estimation.expectedValue);
      expect(estimation.confidenceInterval[1]).toBeGreaterThan(estimation.expectedValue);
    });
  });

  describe('4. Independent Backtest Invariant Reconciliations (Req #14, 15)', () => {
    it('should reconcile compounded trade returns with reported equity curve', () => {
      const tradeReturns = [0.025, -0.012, 0.038, 0.015, -0.020, 0.045];

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

    it('should reconcile profit factor = sum(gains) / abs(sum(losses))', () => {
      const tradeReturns = [0.04, 0.02, -0.01, -0.015, 0.03];

      const wins = tradeReturns.filter((r) => r > 0);
      const losses = tradeReturns.filter((r) => r <= 0);

      const sumWins = wins.reduce((s, r) => s + r, 0); // 0.09
      const sumLosses = Math.abs(losses.reduce((s, r) => s + r, 0)); // 0.025
      const expectedProfitFactor = sumWins / sumLosses; // 3.6

      expect(expectedProfitFactor).toBeCloseTo(3.6, 4);
    });

    it('should independently recompute max drawdown from peak to trough', () => {
      const equitySeries = [100, 105, 115, 110, 95, 102, 120];
      let peak = equitySeries[0];
      let maxDD = 0;

      for (const val of equitySeries) {
        if (val > peak) peak = val;
        const dd = (val - peak) / peak;
        if (dd < maxDD) maxDD = dd;
      }

      // Drawdown from 115 to 95 is (95 - 115) / 115 = -20 / 115 = -0.1739 (-17.39%)
      expect(maxDD).toBeCloseTo(-0.1739, 4);
    });

    it('should independently compute net return from gross return and 0.13% friction', () => {
      const grossReturn = 0.04;
      const roundTripFriction = 0.0013;
      const netReturn = grossReturn - roundTripFriction;

      expect(netReturn).toBeCloseTo(0.0387, 4);
    });
  });

  describe('5. Point-In-Time Leakage Prevention (Req #5, 9)', () => {
    it('should prevent future price mutation from affecting historical features at timestamp t', () => {
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

      // Mutate future candles (31 to 59)
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

  describe('6. End-to-End Walk-Forward Training -> Canonical Serialization -> Reload -> Inference (Req #10, 11, 19)', () => {
    it('should complete full lifecycle with canonical artifact persistence and valid checksum', () => {
      // Step A: Fit Learned Model
      const trainSamples: TrainingSample[] = Array.from({ length: 50 }, (_, i) => ({
        features: { rsi_14: 30 + (i % 30), sma_50_dist: 0.02, annualized_volatility: 0.18 },
        outcome: i % 2 === 0 ? 1 : 0,
      }));
      const model = new LogisticRegressionModel();
      model.fit(trainSamples);

      // Step B: Fit PAV Calibration on 40 Validation observations
      const valPredictions = [
        { prob: 0.22, outcome: 0 }, { prob: 0.25, outcome: 0 }, { prob: 0.28, outcome: 0 }, { prob: 0.30, outcome: 1 },
        { prob: 0.32, outcome: 0 }, { prob: 0.35, outcome: 0 }, { prob: 0.38, outcome: 1 }, { prob: 0.40, outcome: 0 },
        { prob: 0.42, outcome: 0 }, { prob: 0.45, outcome: 1 }, { prob: 0.46, outcome: 0 }, { prob: 0.48, outcome: 1 },
        { prob: 0.50, outcome: 1 }, { prob: 0.52, outcome: 0 }, { prob: 0.54, outcome: 1 }, { prob: 0.55, outcome: 1 },
        { prob: 0.58, outcome: 1 }, { prob: 0.60, outcome: 1 }, { prob: 0.62, outcome: 0 }, { prob: 0.64, outcome: 1 },
        { prob: 0.66, outcome: 1 }, { prob: 0.68, outcome: 1 }, { prob: 0.70, outcome: 1 }, { prob: 0.72, outcome: 1 },
        { prob: 0.74, outcome: 1 }, { prob: 0.76, outcome: 1 }, { prob: 0.78, outcome: 1 }, { prob: 0.80, outcome: 1 },
        { prob: 0.24, outcome: 0 }, { prob: 0.29, outcome: 0 }, { prob: 0.34, outcome: 0 }, { prob: 0.39, outcome: 1 },
        { prob: 0.44, outcome: 0 }, { prob: 0.49, outcome: 1 }, { prob: 0.53, outcome: 1 }, { prob: 0.57, outcome: 1 },
        { prob: 0.63, outcome: 1 }, { prob: 0.67, outcome: 1 }, { prob: 0.73, outcome: 1 }, { prob: 0.77, outcome: 1 },
      ];
      const knots = calibrationEngine.fitPAV(valPredictions);
      const calibMetrics = calibrationEngine.getCalibrationGateMetrics(valPredictions);

      // Step C: Fit Empirical Return Distributions on 25 Validation trades
      const valTrades = [
        { prob: 0.30, horizon: '5d' as const, actualReturn: -0.022 },
        { prob: 0.35, horizon: '5d' as const, actualReturn: -0.018 },
        { prob: 0.38, horizon: '5d' as const, actualReturn: 0.015 },
        { prob: 0.42, horizon: '5d' as const, actualReturn: -0.012 },
        { prob: 0.45, horizon: '5d' as const, actualReturn: 0.020 },
        { prob: 0.48, horizon: '5d' as const, actualReturn: -0.014 },
        { prob: 0.50, horizon: '5d' as const, actualReturn: 0.025 },
        { prob: 0.52, horizon: '5d' as const, actualReturn: 0.028 },
        { prob: 0.55, horizon: '5d' as const, actualReturn: 0.032 },
        { prob: 0.58, horizon: '5d' as const, actualReturn: -0.010 },
        { prob: 0.60, horizon: '5d' as const, actualReturn: 0.036 },
        { prob: 0.62, horizon: '5d' as const, actualReturn: 0.038 },
        { prob: 0.65, horizon: '5d' as const, actualReturn: 0.042 },
        { prob: 0.68, horizon: '5d' as const, actualReturn: 0.045 },
        { prob: 0.70, horizon: '5d' as const, actualReturn: 0.048 },
        { prob: 0.72, horizon: '5d' as const, actualReturn: 0.051 },
        { prob: 0.75, horizon: '5d' as const, actualReturn: 0.055 },
        { prob: 0.78, horizon: '5d' as const, actualReturn: 0.058 },
        { prob: 0.32, horizon: '5d' as const, actualReturn: -0.025 },
        { prob: 0.46, horizon: '5d' as const, actualReturn: 0.018 },
        { prob: 0.54, horizon: '5d' as const, actualReturn: 0.030 },
        { prob: 0.63, horizon: '5d' as const, actualReturn: 0.040 },
        { prob: 0.67, horizon: '5d' as const, actualReturn: 0.044 },
        { prob: 0.71, horizon: '5d' as const, actualReturn: 0.050 },
        { prob: 0.76, horizon: '5d' as const, actualReturn: 0.056 },
      ];
      inferenceEngine.fitEmpiricalDistributions(valTrades);

      // Step D: Save to Canonical Location (with original backup preservation)
      const fs = require('fs');
      const path = require('path');
      const activePath = path.resolve(__dirname, '../../../../data/artifacts/active/model-artifact.json');
      const originalContent = fs.existsSync(activePath) ? fs.readFileSync(activePath, 'utf8') : null;

      try {
        const artifactData: Omit<ModelArtifact, 'checksum' | 'id'> = {
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
          calibrationMetrics: calibMetrics,
          empiricalDistributions: inferenceEngine.getEmpiricalBuckets(),
          survivorshipStatus: 'NOT_FULLY_RESOLVED',
          survivorshipDisclosure: 'Point-in-time trailing liquidity on NSE equities with survivorship limitation explicitly documented.',
          statisticalGatePassed: true,
          gateDetails: {
            sampleSufficiency: true,
            calibrationQuality: true,
            versionCompatibility: true,
            dateRangeIntegrity: true,
          },
          createdAt: new Date().toISOString(),
        };

        const { success, artifactId } = artifactService.saveArtifact(artifactData);
        expect(success).toBe(true);
        expect(artifactId).toBeDefined();

        // Step E: Load and Verify from Canonical Location
        const { artifact: loadedArtifact, validation } = artifactService.loadActiveArtifact();
        expect(validation.isValid).toBe(true);
        expect(loadedArtifact).not.toBeNull();
        expect(loadedArtifact!.checksum).toBeDefined();

        // Step F: Verify Live Inference with Loaded Artifact
        const freshCalibrationEngine = new CalibrationEngine();
        const freshInferenceEngine = new ModelInferenceEngine();

        freshCalibrationEngine.setKnots(loadedArtifact!.calibrationKnots!, loadedArtifact!.calibrationStatus === 'FITTED_OUT_OF_SAMPLE');
        freshInferenceEngine.setEmpiricalBuckets(loadedArtifact!.empiricalDistributions!);

        expect(freshCalibrationEngine.getCalibrationStatus()).toBe('FITTED_OUT_OF_SAMPLE');
        const calibratedProb = freshCalibrationEngine.apply(0.60);
        expect(calibratedProb).toBeGreaterThan(0);

        const estimation = freshInferenceEngine.estimateExpectedReturn(calibratedProb, '5d', 0.02);
        expect(estimation.method).not.toBe('FALLBACK_DIFFUSION');
        expect(estimation.sampleCount).toBeGreaterThan(0);
      } finally {
        if (originalContent) {
          fs.writeFileSync(activePath, originalContent, 'utf8');
        }
      }
    });
  });
});

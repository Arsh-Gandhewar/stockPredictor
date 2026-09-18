import { Test, TestingModule } from '@nestjs/testing';
import { BacktestEngine } from './engines/backtest-engine';
import { FeatureEngine, ModelFeatureVector25 } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { OnnxInferenceEngine } from './engines/onnx-inference.engine';
import { CalibrationEngine } from './engines/calibration-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { RegimeEngine } from './engines/regime-engine';
import { ModelArtifactService } from './engines/model-artifact.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';
import { EconomicCertificationService } from './engines/economic-certification.service';

describe('P0 Invariant: Production ONNX Model Path in Backtesting', () => {
  let backtestEngine: BacktestEngine;
  let mockOnnxEngine: Partial<OnnxInferenceEngine>;
  let mockInferenceEngine: Partial<ModelInferenceEngine>;

  const mockFeatures: ModelFeatureVector25 = {
    rsi14: 55.0,
    macdHist: 0.8,
    bbWidth: 0.04,
    atr14Pct: 0.02,
    volRatio10d: 1.2,
    adx14: 25.0,
    smaTrend20_50: 1.0,
    priceAboveSma200: 1.0,
    candleBodyRatio: 0.6,
    candleShadowRatio: 0.2,
    fiiNetFlowTrend: 1.0,
    diiNetFlowTrend: 0.5,
    indiaVixLevel: 14.5,
    marketBreadthNifty50: 0.65,
    sectorMomentumRank: 0.8,
    niftyCorrelation20d: 0.75,
    distFrom52wHigh: 0.05,
    stochK14: 60.0,
    obvSlope5d: 0.02,
    mfi14: 58.0,
    historicalVolParkinson: 0.18,
    historicalVolGarmanKlass: 0.19,
    downsideDeviation20d: 0.012,
    skewness60d: -0.2,
    kurtosis60d: 3.1,
  };

  beforeEach(() => {
    mockOnnxEngine = {
      isLoaded: jest.fn().mockReturnValue(true),
      evaluate: jest.fn().mockResolvedValue(0.68),
    };

    mockInferenceEngine = {
      evaluate: jest.fn().mockReturnValue(0.52),
      getLearnedModel: jest.fn().mockReturnValue({
        fit: jest.fn(),
        getWeights: jest.fn().mockReturnValue({}),
      }),
      fitEmpiricalDistributions: jest.fn(),
      getEmpiricalBuckets: jest.fn().mockReturnValue({}),
    };

    backtestEngine = new BacktestEngine(
      {} as FeatureEngine,
      mockInferenceEngine as ModelInferenceEngine,
      {} as CalibrationEngine,
      {} as RiskEngine,
      {} as DecisionEngine,
      {} as RegimeEngine,
      {} as ModelArtifactService,
      {} as YahooMarketDataProvider,
      mockOnnxEngine as OnnxInferenceEngine,
      {} as EconomicCertificationService,
    );
  });

  it('should route evaluation through ONNX engine when ONNX models are active', async () => {
    const prob = await backtestEngine.evaluateModel(mockFeatures, '5d');

    expect(mockOnnxEngine.isLoaded).toHaveBeenCalled();
    expect(mockOnnxEngine.evaluate).toHaveBeenCalledWith(mockFeatures, '5d');
    expect(mockInferenceEngine.evaluate).not.toHaveBeenCalled();
    expect(prob).toBe(0.68);
  });

  it('changing heuristic code/weights produces ZERO change in certified backtest predictions when ONNX is loaded', async () => {
    // Initial prediction with heuristic returning 0.52
    const probBefore = await backtestEngine.evaluateModel(mockFeatures, '5d');
    expect(probBefore).toBe(0.68);

    // Modify heuristic code return value dramatically (e.g. from 0.52 to 0.99)
    (mockInferenceEngine.evaluate as jest.Mock).mockReturnValue(0.99);

    // Re-evaluate
    const probAfter = await backtestEngine.evaluateModel(mockFeatures, '5d');

    // Invariant: Changing heuristic code produces ZERO effect
    expect(probAfter).toBe(probBefore);
    expect(probAfter).toBe(0.68);
    expect(mockInferenceEngine.evaluate).not.toHaveBeenCalled();
  });

  it('changing ONNX weights/inference directly changes certified backtest results', async () => {
    // Modify ONNX session return value (simulating retrained/different model weights)
    (mockOnnxEngine.evaluate as jest.Mock).mockResolvedValue(0.74);

    const probUpdated = await backtestEngine.evaluateModel(mockFeatures, '5d');

    // Invariant: Changing ONNX weights directly changes backtest result
    expect(probUpdated).toBe(0.74);
    expect(mockOnnxEngine.evaluate).toHaveBeenCalledTimes(1);
  });

  it('should fall back to learned inference engine only when ONNX is unloaded', async () => {
    (mockOnnxEngine.isLoaded as jest.Mock).mockReturnValue(false);

    const prob = await backtestEngine.evaluateModel(mockFeatures, '5d');

    expect(mockInferenceEngine.evaluate).toHaveBeenCalledWith(mockFeatures, '5d');
    expect(prob).toBe(0.52);
  });
});

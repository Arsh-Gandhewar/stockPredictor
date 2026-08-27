import { createDefaultToolRegistry } from '../src/tools/registry.js';
import { QuantxClient } from '../src/adapters/quantx-client.js';
import { AuthContext } from '../src/auth/auth-context.js';

describe('Source-of-Truth & Numerical Parity Suite', () => {
  let registry: ReturnType<typeof createDefaultToolRegistry>;
  let mockClient: jest.Mocked<QuantxClient>;

  const authContext: AuthContext = {
    userId: 'parity_user',
    role: 'ADMIN',
    requestId: 'req_parity',
  };

  const authoritativeBackendPrediction = {
    stock: { ticker: 'TCS.NS', name: 'Tata Consultancy Services', price: 3500.5, change: 25.5, changePercent: 0.73 },
    prediction: {
      '1d': { calibratedProbability: 0.58, expectedReturn: 0.008, expectedValue: 0.004 },
      '5d': { calibratedProbability: 0.68, expectedReturn: 0.035, expectedValue: 0.024 },
      '20d': { calibratedProbability: 0.72, expectedReturn: 0.058, expectedValue: 0.041 },
    },
    risk: {
      stopLossPrice: 3400.0,
      targetPrice: 3700.0,
      rewardRiskRatio: 2.0,
      downsideProbability: 0.32,
      compositeRiskScore: 35,
      riskState: 'NORMAL',
    },
    scenarios: {
      bull: { targetPrice: 3750.0, expectedReturnPercent: 7.1 },
      base: { targetPrice: 3580.0, expectedReturnPercent: 2.3 },
      bear: { targetPrice: 3380.0, expectedReturnPercent: -3.4 },
    },
    marketRegime: 'BULL_TREND',
    decision: 'BUY',
    signalQuality: 'HIGH',
    dataQuality: 'HIGH',
    modelVersion: '5.0.0',
    invalidationConditions: ['Stop loss hit at 3400.00', 'Regime shifts to BEAR_TREND'],
  };

  beforeEach(() => {
    mockClient = {
      getPrediction: jest.fn().mockResolvedValue(authoritativeBackendPrediction),
      getStockProfile: jest.fn().mockResolvedValue({
        stock: authoritativeBackendPrediction.stock,
        quote: authoritativeBackendPrediction.stock,
        technicals: { rsi: 58.4, rsiStance: 'Neutral', macd: { trend: 'Bullish' }, goldenCross: true },
        catalyst: { primaryDriver: 'Orderbook expansion' },
      }),
      getMarketRegime: jest.fn().mockResolvedValue({ regime: 'BULL_TREND' }),
      getQuote: jest.fn().mockResolvedValue(authoritativeBackendPrediction.stock),
      getTopRankedPredictions: jest.fn().mockResolvedValue([authoritativeBackendPrediction]),
    } as any;

    registry = createDefaultToolRegistry();
  });

  it('quantx_analyze_stock returns lossless representation of backend prediction without recalculation', async () => {
    const mcpOutput: any = await registry.executeTool(
      'quantx_analyze_stock',
      { ticker: 'TCS.NS', horizon: '20d' },
      mockClient,
      authContext
    );

    // Assert exact numerical equality with authoritative QuantX backend
    expect(mcpOutput.currentPrice).toBe(authoritativeBackendPrediction.stock.price);
    expect(mcpOutput.prediction.calibratedProbability).toBe(
      authoritativeBackendPrediction.prediction['20d'].calibratedProbability
    );
    expect(mcpOutput.prediction.expectedReturn).toBe(authoritativeBackendPrediction.prediction['20d'].expectedReturn);
    expect(mcpOutput.risk.stopLossPrice).toBe(authoritativeBackendPrediction.risk.stopLossPrice);
    expect(mcpOutput.risk.rewardRiskRatio).toBe(authoritativeBackendPrediction.risk.rewardRiskRatio);
    expect(mcpOutput.decision).toBe(authoritativeBackendPrediction.decision);
    expect(mcpOutput.modelVersion).toBe(authoritativeBackendPrediction.modelVersion);
    expect(mcpOutput.marketRegime).toBe(authoritativeBackendPrediction.marketRegime);
  });

  it('quantx_get_stock returns identical price and timestamp from backend quote', async () => {
    const mcpOutput: any = await registry.executeTool(
      'quantx_get_stock',
      { ticker: 'TCS.NS', includePrediction: true },
      mockClient,
      authContext
    );

    expect(mcpOutput.latestPrice).toBe(authoritativeBackendPrediction.stock.price);
    expect(mcpOutput.change).toBe(authoritativeBackendPrediction.stock.change);
    expect(mcpOutput.changePercent).toBe(authoritativeBackendPrediction.stock.changePercent);
  });
});

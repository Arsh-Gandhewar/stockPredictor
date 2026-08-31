import { createDefaultToolRegistry, ToolRegistry } from '../src/tools/registry.js';
import { AuthService } from '../src/auth/auth-context.js';
import * as crypto from 'crypto';

const TEST_SECRET = 'quantx-dev-test-secret-key-do-not-use-in-prod';
process.env.JWT_SECRET = TEST_SECRET;

function createTestToken(role: string = 'AUTHENTICATED_READ', userId: string = 'test_user'): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, role, iat: nowSec, exp: nowSec + 3600 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('MCP Protocol, Horizon Semantics & Numerical Honesty Tests', () => {
  let registry: ToolRegistry;
  let mockClient: any;

  beforeEach(() => {
    registry = createDefaultToolRegistry();
    mockClient = {
      getQuote: jest.fn().mockResolvedValue({ price: 2500.5, timestamp: Date.now() - 10000, marketState: 'OPEN' }),
      searchStocks: jest.fn().mockResolvedValue([]),
      getPrediction: jest.fn(),
      getTopRankedPredictions: jest.fn(),
      getHighRiskOpportunities: jest.fn(),
      getPortfolio: jest.fn(),
      executeTrade: jest.fn(),
      getHealth: jest.fn(),
      getModelStatus: jest.fn(),
      getModelPerformance: jest.fn(),
      getProductionScorecard: jest.fn(),
      getStockNews: jest.fn().mockResolvedValue([]),
      getMarketRegime: jest.fn().mockResolvedValue({ regime: 'SIDEWAYS' }),
      getPortfolioSellSignals: jest.fn().mockResolvedValue([]),
      getStockProfile: jest.fn().mockResolvedValue(null),
    };
  });

  test('All 13 canonical QuantX tools are registered', () => {
    const tools = registry.getAllTools();
    expect(tools.length).toBe(13);
    const names = tools.map((t) => t.name);
    expect(names).toContain('quantx_get_stock');
    expect(names).toContain('quantx_search_stocks');
    expect(names).toContain('quantx_get_opportunities');
    expect(names).toContain('quantx_analyze_stock');
    expect(names).toContain('quantx_model_performance');
    expect(names).toContain('quantx_get_portfolio');
    expect(names).toContain('quantx_get_position_risk');
    expect(names).toContain('quantx_risk_guardian');
    expect(names).toContain('quantx_get_stock_sentiment');
    expect(names).toContain('quantx_run_backtest');
    expect(names).toContain('quantx_paper_buy');
    expect(names).toContain('quantx_paper_sell');
    expect(names).toContain('quantx_health');
  });

  test('Horizon Semantics: 20D request does NOT substitute 5D if 20D missing', async () => {
    // Return mock prediction containing only 5D data
    mockClient.getTopRankedPredictions.mockResolvedValue([
      {
        ticker: 'INFY.NS',
        decision: 'BUY',
        prediction: {
          '5d': { calibratedProbability: 0.62, expectedReturn: 0.018 },
          // Note: 20d is intentionally missing
        },
        ranking: { breakdown: { expectedValue: 0.015, sortinoRatio: 1.4 } },
      },
    ]);

    const token = createTestToken('AUTHENTICATED_READ');
    const context = AuthService.resolvePrincipal(`Bearer ${token}`);

    const result = (await registry.executeTool(
      'quantx_get_opportunities',
      { horizon: '20d' },
      mockClient,
      context
    )) as any;

    expect(result.requestedHorizon).toBe('20d');
    expect(result.opportunities.length).toBe(1);

    const opp = result.opportunities[0];
    expect(opp.requestedHorizon).toBe('20d');
    // Must NOT substitute 5d probability
    expect(opp.probability).toBeNull();
    expect(opp.expectedReturn).toBeNull();
    expect(opp.actualPredictionHorizon).toBeNull();
    expect(opp.dataStatus).toBe('INSUFFICIENT_DATA');
  });

  test('Risk Profile Semantics: low, balanced, and aggressive are distinct', async () => {
    const oppA = { ticker: 'A', ranking: { breakdown: { sortinoRatio: 2.5, expectedValue: 0.01 } } };
    const oppB = { ticker: 'B', ranking: { breakdown: { sortinoRatio: 0.8, expectedValue: 0.03 } } };

    mockClient.getTopRankedPredictions.mockResolvedValue([oppB, oppA]);
    mockClient.getHighRiskOpportunities.mockResolvedValue([{ ticker: 'HIGH_VOL', ranking: { breakdown: { expectedValue: 0.05 } } }]);

    const token = createTestToken('AUTHENTICATED_READ');
    const context = AuthService.resolvePrincipal(`Bearer ${token}`);

    // Balanced call
    const resBalanced = (await registry.executeTool(
      'quantx_get_opportunities',
      { riskProfile: 'balanced' },
      mockClient,
      context
    )) as any;
    expect(mockClient.getTopRankedPredictions).toHaveBeenCalled();
    expect(resBalanced.opportunities[0].ticker).toBe('B'); // Unsorted by sortino

    // Low risk call: should sort by highest Sortino ratio (oppA first)
    const resLow = (await registry.executeTool(
      'quantx_get_opportunities',
      { riskProfile: 'low' },
      mockClient,
      context
    )) as any;
    expect(resLow.opportunities[0].ticker).toBe('A');

    // Aggressive call: invokes getHighRiskOpportunities
    const resAggressive = (await registry.executeTool(
      'quantx_get_opportunities',
      { riskProfile: 'aggressive' },
      mockClient,
      context
    )) as any;
    expect(mockClient.getHighRiskOpportunities).toHaveBeenCalled();
    expect(resAggressive.opportunities[0].ticker).toBe('HIGH_VOL');
  });

  test('Numerical Honesty: null availableCash remains null with INSUFFICIENT_DATA', async () => {
    mockClient.getPortfolio.mockResolvedValue({
      userId: 'test_user',
      availableCash: null, // Unknown cash balance
      totalInvested: null,
      totalCurrentValue: null,
      totalPortfolioValue: null,
      positions: [],
    });

    const token = createTestToken('AUTHENTICATED_READ');
    const context = AuthService.resolvePrincipal(`Bearer ${token}`);

    const result = (await registry.executeTool('quantx_get_portfolio', {}, mockClient, context)) as any;
    expect(result.availableCash).toBeNull();
    expect(result.dataStatus).toBe('INSUFFICIENT_DATA');
  });

  test('Numerical Honesty: missing modelVersion returns null instead of fake 5.0.0', async () => {
    mockClient.getModelPerformance.mockResolvedValue({
      modelVersion: null,
      overallSharpe: null,
    });
    mockClient.getProductionScorecard.mockResolvedValue(null);

    const context = AuthService.resolvePrincipal();
    const result = (await registry.executeTool('quantx_model_performance', {}, mockClient, context)) as any;
    expect(result.modelVersion).toBeNull();
  });

  test('Numerical Honesty: missing priceTimestamp returns null without server-time substitution', async () => {
    mockClient.getQuote.mockResolvedValue({
      price: 1500,
      timestamp: null, // No upstream timestamp
    });

    const context = AuthService.resolvePrincipal();
    const result = (await registry.executeTool('quantx_get_stock', { ticker: 'WIPRO' }, mockClient, context)) as any;
    expect(result.priceTimestamp).toBeNull();
  });

  test('Health Check: Unhealthy backend marks overall status as UNHEALTHY', async () => {
    mockClient.getHealth.mockRejectedValue(new Error('Backend connection refused'));
    mockClient.getModelStatus.mockRejectedValue(new Error('Model unavailable'));

    const context = AuthService.resolvePrincipal();
    const result = (await registry.executeTool('quantx_health', {}, mockClient, context)) as any;
    expect(result.backend.status).toBe('UNREACHABLE');
    expect(result.overallStatus).toBe('UNHEALTHY');
  });
});

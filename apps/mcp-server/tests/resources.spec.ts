import { createDefaultResourceRegistry } from '../src/resources/resource-registry.js';
import { QuantxClient } from '../src/adapters/quantx-client.js';
import { AuthContext } from '../src/auth/auth-context.js';
import { McpError } from '../src/errors/mcp-errors.js';

describe('QuantX MCP Resources Suite', () => {
  let mockClient: jest.Mocked<QuantxClient>;
  let registry: ReturnType<typeof createDefaultResourceRegistry>;

  const authContext: AuthContext = {
    userId: 'test_trader',
    role: 'AUTHENTICATED_READ',
    requestId: 'req_res_test',
  };

  beforeEach(() => {
    mockClient = {
      getMarketStatus: jest.fn().mockResolvedValue({ status: 'OPEN', exchange: 'NSE' }),
      getMarketSummary: jest.fn().mockResolvedValue([{ symbol: '^NSEI', price: 24500 }]),
      getPortfolio: jest.fn().mockResolvedValue({ totalPortfolioValue: 1000000, availableCash: 300000 }),
      getModelStatus: jest.fn().mockResolvedValue({ modelVersion: '5.0.0', isProductionReady: true }),
      getGovernance: jest.fn().mockResolvedValue({ productionReady: true, lastValidatedAt: '2024-01-15T00:00:00Z' }),
      getProductionScorecard: jest.fn().mockResolvedValue({ overallStatus: 'PRODUCTION_READY' }),
      getModelPerformance: jest.fn().mockResolvedValue({ overallSharpe: 1.15, lastTrained: '2024-01-15T00:00:00Z' }),
      getMarketRegime: jest.fn().mockResolvedValue({ regime: 'BULL_TREND' }),
    } as any;

    registry = createDefaultResourceRegistry();
  });

  it('registers all 5 canonical resources', () => {
    const all = registry.getAllResources();
    expect(all.length).toBe(5);
    const uris = all.map((r) => r.uri);
    expect(uris).toContain('quantx://market/status');
    expect(uris).toContain('quantx://portfolio');
    expect(uris).toContain('quantx://model/current');
    expect(uris).toContain('quantx://model/performance');
    expect(uris).toContain('quantx://risk/current');
  });

  it('reads quantx://market/status with freshness metadata', async () => {
    const result = await registry.readResource('quantx://market/status', mockClient, authContext);
    expect(result.contents.length).toBe(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.uri).toBe('quantx://market/status');
    expect(parsed.dataStatus).toBe('LIVE');
    expect(parsed.dataTimestamp).toBeDefined();
    expect(parsed.retrievedAt).toBeDefined();
    expect(parsed.staleAfter).toBeDefined();
  });

  it('reads quantx://portfolio for authenticated user scope', async () => {
    const result = await registry.readResource('quantx://portfolio', mockClient, authContext);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.uri).toBe('quantx://portfolio');
    expect(parsed.portfolio.totalPortfolioValue).toBe(1000000);
    expect(parsed.dataStatus).toBe('AVAILABLE');
  });

  it('reads quantx://model/current with scorecard status', async () => {
    const result = await registry.readResource('quantx://model/current', mockClient, authContext);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.uri).toBe('quantx://model/current');
    expect(parsed.scorecard.overallStatus).toBe('PRODUCTION_READY');
  });

  it('reads quantx://model/performance with backtest metrics', async () => {
    const result = await registry.readResource('quantx://model/performance', mockClient, authContext);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.uri).toBe('quantx://model/performance');
    expect(parsed.performance.overallSharpe).toBe(1.15);
  });

  it('reads quantx://risk/current with market regime classification', async () => {
    const result = await registry.readResource('quantx://risk/current', mockClient, authContext);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.uri).toBe('quantx://risk/current');
    expect(parsed.marketRegime).toBe('BULL_TREND');
  });

  it('rejects unregistered resource URIs with NOT_FOUND', async () => {
    await expect(registry.readResource('quantx://invalid/resource', mockClient, authContext)).rejects.toThrow(McpError);
  });
});

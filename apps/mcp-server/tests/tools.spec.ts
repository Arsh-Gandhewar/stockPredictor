import { createDefaultToolRegistry } from '../src/tools/registry.js';
import { QuantxClient } from '../src/adapters/quantx-client.js';
import { AuthContext } from '../src/auth/auth-context.js';
import { McpError } from '../src/errors/mcp-errors.js';

describe('QuantX MCP Tools Suite (All 13 Tools)', () => {
  let mockClient: jest.Mocked<QuantxClient>;
  let registry: ReturnType<typeof createDefaultToolRegistry>;

  const adminContext: AuthContext = {
    userId: 'test_user',
    role: 'ADMIN',
    requestId: 'req_tool_test',
  };

  beforeEach(() => {
    mockClient = {
      getQuote: jest.fn().mockResolvedValue({ price: 3500.5, change: 25.5, changePercent: 0.73, volume: 1500000, timestamp: 1700000000000 }),
      getPrediction: jest.fn().mockResolvedValue({
        decision: 'BUY',
        signalQuality: 'HIGH',
        dataQuality: 'HIGH',
        prediction: {
          '5d': { calibratedProbability: 0.68, expectedReturn: 0.035, expectedValue: 0.024 },
          '20d': { calibratedProbability: 0.72, expectedReturn: 0.058, expectedValue: 0.041 },
        },
        risk: { stopLossPrice: 3400.0, targetPrice: 3700.0, rewardRiskRatio: 2.0, downsideProbability: 0.32, compositeRiskScore: 35, riskState: 'NORMAL' },
        invalidationConditions: ['Stop loss hit at 3400'],
        modelVersion: '5.0.0',
      }),
      searchStocks: jest.fn().mockResolvedValue([
        { ticker: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'Information Technology' },
        { ticker: 'INFY.NS', name: 'Infosys Limited', sector: 'Information Technology' },
      ]),
      getTopRankedPredictions: jest.fn().mockResolvedValue([
        {
          decision: 'STRONG_BUY',
          stock: { ticker: 'TCS.NS', name: 'TCS' },
          prediction: { '5d': { calibratedProbability: 0.75, expectedReturn: 0.04 } },
          risk: { rewardRiskRatio: 2.5 },
          ranking: { breakdown: { expectedValue: 3.2, sortinoRatio: 2.1, compositeScore: 0.88 } },
        },
      ]),
      getHighRiskOpportunities: jest.fn().mockResolvedValue([
        {
          decision: 'BUY',
          stock: { ticker: 'ZOMATO.NS', name: 'Zomato' },
          prediction: { '5d': { calibratedProbability: 0.65, expectedReturn: 0.08 } },
          risk: { rewardRiskRatio: 3.0 },
          ranking: { breakdown: { expectedValue: 4.5, sortinoRatio: 1.8, compositeScore: 0.82 } },
        },
      ]),
      getStockProfile: jest.fn().mockResolvedValue({
        stock: { ticker: 'TCS.NS', name: 'Tata Consultancy Services' },
        quote: { price: 3500.5 },
        technicals: { rsi: 58.4, rsiStance: 'Neutral', macd: { trend: 'Bullish' }, goldenCross: true },
        catalyst: { primaryDriver: 'Strong Q3 earnings orderbook expansion' },
      }),
      getMarketRegime: jest.fn().mockResolvedValue({ regime: 'BULL_TREND' }),
      getModelPerformance: jest.fn().mockResolvedValue({
        modelVersion: '5.0.0',
        modelType: 'LEARNED_LIGHTGBM',
        calibrationStatus: 'FITTED_OUT_OF_SAMPLE',
        status: 'HEALTHY',
        overallSharpe: 1.15,
        overallSortino: 1.62,
        overallMaxDrawdown: -0.14,
        annualizedReturn: 18.5,
        overallBrierScore: 0.16,
        ece: 0.042,
        totalTrades: 450,
      }),
      getProductionScorecard: jest.fn().mockResolvedValue({ overallStatus: 'PRODUCTION_READY', blockingFailures: [] }),
      getPortfolio: jest.fn().mockResolvedValue({
        availableCash: 250000,
        totalInvested: 750000,
        totalCurrentValue: 785000,
        totalPortfolioValue: 1035000,
        totalTodayPnL: 12500,
        totalTodayPnLPercent: 1.22,
        totalOverallPnL: 35000,
        totalOverallPnLPercent: 4.67,
        positions: [
          {
            stock: { ticker: 'TCS.NS', name: 'TCS' },
            quantity: 50,
            averagePrice: 3400.0,
            currentPrice: 3500.5,
            currentValue: 175025,
            todayPnL: 2500,
            overallPnL: 5025,
            overallPnLPercent: 2.95,
          },
        ],
      }),
      getPortfolioSellSignals: jest.fn().mockResolvedValue([]),
      executeTrade: jest.fn().mockResolvedValue({
        transactionId: 'tx_exec_123',
        price: 3500.5,
        totalValue: 35005,
      }),
      getStockNews: jest.fn().mockResolvedValue([
        { title: 'TCS Signs Multi-Billion Dollar Deal', sentiment: 'POSITIVE', impact: 'HIGH', publishedAt: '2024-01-15T10:00:00Z' },
      ]),
      getHealth: jest.fn().mockResolvedValue({
        status: 'healthy',
        services: { database: { status: 'UP' } },
      }),
      getModelStatus: jest.fn().mockResolvedValue({ isProductionReady: true }),
    } as any;

    registry = createDefaultToolRegistry();
  });

  // Tool 1: quantx_get_stock
  it('quantx_get_stock executes and normalizes ticker', async () => {
    const result: any = await registry.executeTool('quantx_get_stock', { ticker: 'tcs', includePrediction: true }, mockClient, adminContext);
    expect(result.ticker).toBe('TCS.NS');
    expect(result.latestPrice).toBe(3500.5);
    expect(result.prediction.decision).toBe('BUY');
    expect(result.dataStatus).toBe('LIVE');
  });

  // Tool 2: quantx_search_stocks
  it('quantx_search_stocks returns structured results within bounds', async () => {
    const result: any = await registry.executeTool('quantx_search_stocks', { query: 'Tata', limit: 5 }, mockClient, adminContext);
    expect(result.count).toBe(2);
    expect(result.stocks[0].ticker).toBe('TCS.NS');
  });

  // Tool 3: quantx_get_opportunities
  it('quantx_get_opportunities returns ranked predictions from existing engine', async () => {
    const result: any = await registry.executeTool('quantx_get_opportunities', { horizon: '5d', riskProfile: 'balanced' }, mockClient, adminContext);
    expect(result.count).toBe(1);
    expect(result.opportunities[0].ticker).toBe('TCS.NS');
    expect(result.opportunities[0].expectedValue).toBe(3.2);
  });

  // Tool 4: quantx_analyze_stock
  it('quantx_analyze_stock combines multi-factor deep dive without fabricating fields', async () => {
    const result: any = await registry.executeTool('quantx_analyze_stock', { ticker: 'TCS.NS', horizon: '20d' }, mockClient, adminContext);
    expect(result.ticker).toBe('TCS.NS');
    expect(result.marketRegime).toBe('BULL_TREND');
    expect(result.technicals.rsi).toBe(58.4);
    expect(result.risk.stopLossPrice).toBe(3400.0);
  });

  // Tool 5: quantx_model_performance
  it('quantx_model_performance returns institutional walk-forward metrics', async () => {
    const result: any = await registry.executeTool('quantx_model_performance', {}, mockClient, adminContext);
    expect(result.modelVersion).toBe('5.0.0');
    expect(result.overallSharpe).toBe(1.15);
    expect(result.productionReady).toBe(true);
  });

  // Tool 6: quantx_get_portfolio
  it('quantx_get_portfolio returns authenticated user portfolio balance and positions', async () => {
    const result: any = await registry.executeTool('quantx_get_portfolio', {}, mockClient, adminContext);
    expect(result.userId).toBe('test_user');
    expect(result.totalPortfolioValue).toBe(1035000);
    expect(result.positionsCount).toBe(1);
  });

  // Tool 7: quantx_get_position_risk
  it('quantx_get_position_risk evaluates held position risk against model metrics', async () => {
    const result: any = await registry.executeTool('quantx_get_position_risk', { ticker: 'TCS.NS' }, mockClient, adminContext);
    expect(result.ticker).toBe('TCS.NS');
    expect(result.isHeldInPortfolio).toBe(true);
    expect(result.stopLossPrice).toBe(3400.0);
  });

  // Tool 8: quantx_risk_guardian
  it('quantx_risk_guardian scans positions without executing trades', async () => {
    const result: any = await registry.executeTool('quantx_risk_guardian', { portfolioScope: true }, mockClient, adminContext);
    expect(result.riskLevel).toBe('LOW');
    expect(result.marketRegime).toBe('BULL_TREND');
    expect(mockClient.executeTrade).not.toHaveBeenCalled();
  });

  // Tool 9: quantx_get_stock_sentiment
  it('quantx_get_stock_sentiment summarizes sentiment and sanitizes headlines', async () => {
    const result: any = await registry.executeTool('quantx_get_stock_sentiment', { ticker: 'TCS' }, mockClient, adminContext);
    expect(result.ticker).toBe('TCS.NS');
    expect(result.sentiment).toBe('BULLISH');
    expect(result.articleCount).toBe(1);
  });

  // Tool 10: quantx_run_backtest
  it('quantx_run_backtest validates date range and requires ADMIN', async () => {
    const result: any = await registry.executeTool(
      'quantx_run_backtest',
      { startDate: '2023-01-01', endDate: '2023-12-31' },
      mockClient,
      adminContext
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.sharpe).toBe(1.15);
  });

  // Tool 11: quantx_paper_buy
  it('quantx_paper_buy executes trade and prevents duplicate execution via idempotencyKey', async () => {
    const buyPayload = {
      ticker: 'TCS.NS',
      quantity: 10,
      orderType: 'MARKET' as const,
      idempotencyKey: 'idem_unique_buy_123',
    };

    const res1: any = await registry.executeTool('quantx_paper_buy', buyPayload, mockClient, adminContext);
    expect(res1.success).toBe(true);
    expect(res1.isDuplicate).toBe(false);
    expect(mockClient.executeTrade).toHaveBeenCalledTimes(1);

    // Call second time with identical idempotencyKey
    const res2: any = await registry.executeTool('quantx_paper_buy', buyPayload, mockClient, adminContext);
    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(true);
    expect(mockClient.executeTrade).toHaveBeenCalledTimes(1); // STILL 1, NOT 2!
  });

  // Tool 12: quantx_paper_sell
  it('quantx_paper_sell executes order through portfolio engine', async () => {
    const sellPayload = {
      ticker: 'TCS.NS',
      quantity: 5,
      orderType: 'MARKET' as const,
      idempotencyKey: 'idem_unique_sell_456',
    };

    const res: any = await registry.executeTool('quantx_paper_sell', sellPayload, mockClient, adminContext);
    expect(res.success).toBe(true);
    expect(res.type).toBe('SELL');
  });

  // Tool 13: quantx_health
  it('quantx_health checks MCP server, backend, and model artifact status', async () => {
    const result: any = await registry.executeTool('quantx_health', {}, mockClient, adminContext);
    expect(result.overallStatus).toBe('HEALTHY');
    expect(result.mcpServer.status).toBe('healthy');
    expect(result.backend.status).toBe('healthy');
    expect(result.database.status).toBe('UP');
    expect(result.modelArtifact.status).toBe('PRODUCTION_READY');
  });

  // Schema Validation Error Test
  it('rejects malformed inputs with INVALID_INPUT McpError', async () => {
    await expect(
      registry.executeTool('quantx_get_stock', { ticker: '' }, mockClient, adminContext)
    ).rejects.toThrow(McpError);

    await expect(
      registry.executeTool('quantx_search_stocks', { query: 'Tata', limit: 100 }, mockClient, adminContext)
    ).rejects.toThrow(McpError);
  });
});

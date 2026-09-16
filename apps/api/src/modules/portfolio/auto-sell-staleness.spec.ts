import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';
import { TransactionType, OrderType } from 'db';

describe('Tier 4: Auto-Sell Freshness & Stale Quote Rejection Spec', () => {
  let service: PortfolioService;
  let mockDb: any;
  let mockStockService: any;
  let mockPredictionService: any;
  let mockAiService: any;

  beforeEach(async () => {
    mockDb = {
      client: {
        portfolio: {
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        position: {
          findUnique: jest.fn(),
          delete: jest.fn(),
          update: jest.fn(),
        },
        transaction: {
          create: jest.fn(),
        },
        idempotencyRecord: {
          create: jest.fn(),
          findUnique: jest.fn(),
          upsert: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn((callback) => callback(mockDb.client)),
      },
    };

    mockStockService = {
      getQuotes: jest.fn(),
    };

    mockPredictionService = {};
    mockAiService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: StockService, useValue: mockStockService },
        { provide: QuantPredictionService, useValue: mockPredictionService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  const basePortfolio = {
    id: 'port_100',
    userId: 'user_auto_sell',
    availableCash: 50000,
    positions: [
      {
        id: 'pos_auto_1',
        stockId: 'stock_reliance',
        quantity: 10,
        averagePrice: 2800.0,
        stopLossPrice: 2600.0,
        targetPrice: 3100.0,
        updatedAt: new Date('2026-09-10T10:00:00.000Z'),
        stock: {
          id: 'stock_reliance',
          ticker: 'RELIANCE.NS',
        },
      },
    ],
  };

  it('should reject and skip auto-sell if quote has missing/invalid timestamp', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 2550.0, // Below stop loss (2600)
        sourceTimestamp: null,
        timestamp: undefined,
      },
    ]);

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(0);
    expect(mockDb.client.transaction.create).not.toHaveBeenCalled();
  });

  it('should strictly reject and skip auto-sell if serverReceivedAt is fresh but sourceTimestamp is missing (fail-closed)', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 2550.0, // Below stop loss (2600)
        sourceTimestamp: null,
        serverReceivedAt: new Date().toISOString(), // Fresh receipt time must NOT substitute for source timestamp
        timestamp: null,
      },
    ]);

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(0);
    expect(mockDb.client.transaction.create).not.toHaveBeenCalled();
  });

  it('should reject and skip auto-sell if quote has a future-dated timestamp (> now + 60s)', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes in future

    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 2550.0,
        sourceTimestamp: futureDate,
      },
    ]);

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(0);
    expect(mockDb.client.transaction.create).not.toHaveBeenCalled();
  });

  it('should reject and skip auto-sell if quote is stale (> 15 minutes old)', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    const staleDate = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 minutes old

    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 2550.0,
        sourceTimestamp: staleDate,
      },
    ]);

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(0);
    expect(mockDb.client.transaction.create).not.toHaveBeenCalled();
  });

  it('should execute stop-loss sale when quote has fresh source timestamp and price <= stopLoss', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    const freshDate = new Date(Date.now() - 30 * 1000).toISOString(); // 30 seconds old

    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 2550.0, // Below stop loss (2600)
        sourceTimestamp: freshDate,
      },
    ]);

    mockDb.client.position.findUnique.mockResolvedValue({
      id: 'pos_auto_1',
      quantity: 10,
    });

    mockDb.client.transaction.create.mockResolvedValue({
      id: 'tx_auto_stop_loss_01',
      type: TransactionType.SELL,
      orderType: OrderType.MARKET,
      price: 2550.0,
      quantity: 10,
      reason: 'AUTO_STOP_LOSS',
    });

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(1);
    expect(result.executedTrades[0].stock).toBe('RELIANCE.NS');
    expect(result.executedTrades[0].reason).toBe('AUTO_STOP_LOSS');
    expect(result.executedTrades[0].executionPrice).toBe(2550.0);
    expect(mockDb.client.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TransactionType.SELL,
          orderType: OrderType.MARKET,
          reason: 'AUTO_STOP_LOSS',
        }),
      })
    );
  });

  it('should execute target-profit sale when quote has fresh source timestamp and price >= targetPrice', async () => {
    mockDb.client.portfolio.findFirst.mockResolvedValue(basePortfolio);
    const freshDate = new Date(Date.now() - 15 * 1000).toISOString();

    mockStockService.getQuotes.mockResolvedValue([
      {
        ticker: 'RELIANCE.NS',
        price: 3150.0, // Above target price (3100)
        sourceTimestamp: freshDate,
      },
    ]);

    mockDb.client.position.findUnique.mockResolvedValue({
      id: 'pos_auto_1',
      quantity: 10,
    });

    mockDb.client.transaction.create.mockResolvedValue({
      id: 'tx_auto_target_profit_01',
      type: TransactionType.SELL,
      orderType: OrderType.MARKET,
      price: 3150.0,
      quantity: 10,
      reason: 'AUTO_TARGET_PROFIT',
    });

    const result = await service.evaluateAndExecuteAutoSell('user_auto_sell');
    expect(result.executedTrades.length).toBe(1);
    expect(result.executedTrades[0].reason).toBe('AUTO_TARGET_PROFIT');
    expect(result.executedTrades[0].executionPrice).toBe(3150.0);
  });
});

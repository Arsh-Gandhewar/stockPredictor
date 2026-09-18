import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';
import { TransactionType, OrderType } from 'db';

describe('P0 Invariant: Concurrent Trades Balance & Position Integrity Spec', () => {
  let service: PortfolioService;
  let mockDb: any;
  let mockStockService: any;

  let simulatedCash: number;
  let simulatedPositions: Map<
    string,
    {
      id: string;
      stockId: string;
      quantity: number;
      averagePrice: number;
      updatedAt: Date;
    }
  >;
  let executedTransactions: any[];

  beforeEach(async () => {
    simulatedCash = 100_000; // ₹100,000 initial capital
    simulatedPositions = new Map();
    executedTransactions = [];

    mockDb = {
      client: {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user_db_id',
            clerkId: 'user_concurrent',
          }),
        },
        stock: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'stock_infy',
            ticker: 'INFY.NS',
            name: 'Infosys',
          }),
          create: jest.fn(),
        },
        portfolio: {
          findUnique: jest.fn(async () => ({
            id: 'port_concurrent',
            userId: 'user_db_id',
            availableCash: simulatedCash,
            positions: Array.from(simulatedPositions.values()).map((p) => ({
              ...p,
              stock: { ticker: 'INFY.NS', name: 'Infosys', id: p.stockId },
            })),
          })),
          updateMany: jest.fn(async ({ where, data }) => {
            // Atomic conditional update simulation (emulates PostgreSQL row lock & condition)
            const required = where.availableCash?.gte;
            const decrement = data.availableCash?.decrement;
            if (required !== undefined && decrement !== undefined) {
              if (simulatedCash >= required) {
                simulatedCash -= decrement;
                return { count: 1 };
              }
              return { count: 0 };
            }
            return { count: 1 };
          }),
          update: jest.fn(async ({ data }) => {
            if (data.availableCash?.increment) {
              simulatedCash += data.availableCash.increment;
            }
            return { id: 'port_concurrent', availableCash: simulatedCash };
          }),
        },
        position: {
          findUnique: jest.fn(
            async ({ where }) => simulatedPositions.get(where.id) || null,
          ),
          create: jest.fn(async ({ data }) => {
            const newPos = {
              id: 'pos_infy',
              stockId: data.stockId,
              quantity: data.quantity,
              averagePrice: data.averagePrice,
              updatedAt: new Date(),
            };
            simulatedPositions.set('pos_infy', newPos);
            return newPos;
          }),
          updateMany: jest.fn(async ({ where, data }) => {
            const pos = simulatedPositions.get(where.id);
            if (!pos) return { count: 0 };

            if (
              where.quantity?.gte !== undefined &&
              data.quantity?.decrement !== undefined
            ) {
              if (pos.quantity >= where.quantity.gte) {
                pos.quantity -= data.quantity.decrement;
                pos.updatedAt = new Date();
                return { count: 1 };
              }
              return { count: 0 };
            }

            if (where.quantity !== undefined && data.quantity !== undefined) {
              // Optimistic concurrency check
              pos.quantity = data.quantity;
              pos.averagePrice = data.averagePrice;
              pos.updatedAt = new Date();
              return { count: 1 };
            }

            return { count: 1 };
          }),
          deleteMany: jest.fn(async ({ where }) => {
            const pos = simulatedPositions.get(where.id);
            if (!pos) return { count: 0 };
            if (pos.quantity === where.quantity) {
              simulatedPositions.delete(where.id);
              return { count: 1 };
            }
            return { count: 0 };
          }),
        },
        transaction: {
          create: jest.fn(async ({ data }) => {
            const tx = { id: `tx_${Date.now()}_${Math.random()}`, ...data };
            executedTransactions.push(tx);
            return tx;
          }),
        },
        alert: {
          create: jest.fn().mockResolvedValue({}),
        },
        idempotencyRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          upsert: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(async (cb) => cb(mockDb.client)),
      },
    };

    mockStockService = {
      getMarketStatusInfo: jest.fn().mockReturnValue({
        status: 'OPEN',
        sessionType: 'REGULAR',
        isCalendarStale: false,
        isTradable: true,
        calendarVersion: '2026.1',
      }),
      isSupportedTicker: jest.fn().mockReturnValue(true),
      getQuote: jest.fn().mockResolvedValue({
        ticker: 'INFY.NS',
        name: 'Infosys',
        price: 1000.0,
        sourceTimestamp: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: StockService, useValue: mockStockService },
        {
          provide: QuantPredictionService,
          useValue: { getPrediction: jest.fn().mockResolvedValue(null) },
        },
        { provide: AiService, useValue: {} },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('1. 100 concurrent BUY trades against ₹100k balance: exactly 50 succeed, 50 fail, final balance = ₹0.00', async () => {
    // 100 orders of 2 shares @ ₹1,000 = ₹2,000 per order
    // Total demanded: ₹200,000
    // Total available: ₹100,000
    const concurrentRequests = Array.from({ length: 100 }, (_, i) =>
      service.executeTrade(
        'user_concurrent',
        'INFY.NS',
        TransactionType.BUY,
        2,
        OrderType.MARKET,
      ),
    );

    const outcomes = await Promise.allSettled(concurrentRequests);

    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(50);
    expect(rejected.length).toBe(50);

    // All rejected requests must have thrown 400 Insufficient virtual capital
    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(BadRequestException);
        expect(r.reason.message).toContain('Insufficient virtual capital');
      }
    }

    // Balance must be mathematically conserved to exactly 0 (never negative)
    expect(simulatedCash).toBe(0);
    expect(executedTransactions.length).toBe(50);
  });

  it('2. 100 concurrent SELL trades against 50 held shares: exactly 25 succeed, 75 fail, remaining shares = 0', async () => {
    // Pre-populate position with 50 shares
    simulatedPositions.set('pos_infy', {
      id: 'pos_infy',
      stockId: 'stock_infy',
      quantity: 50,
      averagePrice: 1000.0,
      updatedAt: new Date(),
    });

    // 100 orders each attempting to sell 2 shares (demanded: 200 shares, held: 50 shares)
    const concurrentRequests = Array.from({ length: 100 }, (_, i) =>
      service.executeTrade(
        'user_concurrent',
        'INFY.NS',
        TransactionType.SELL,
        2,
        OrderType.MARKET,
      ),
    );

    const outcomes = await Promise.allSettled(concurrentRequests);

    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(25);
    expect(rejected.length).toBe(75);

    // All rejected requests must report insufficient shares
    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(BadRequestException);
        expect(r.reason.message).toContain('Insufficient shares to sell');
      }
    }

    // Position must not be negative
    const finalPos = simulatedPositions.get('pos_infy');
    const remainingQty = finalPos ? finalPos.quantity : 0;
    expect(remainingQty).toBe(0);

    // Exactly 25 sell transactions recorded
    expect(executedTransactions.length).toBe(25);

    // Proceeds from 50 shares @ ₹1,000 = ₹50,000 added to initial ₹100,000
    expect(simulatedCash).toBe(150_000);
  });
});

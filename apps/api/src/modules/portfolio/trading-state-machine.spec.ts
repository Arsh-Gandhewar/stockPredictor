import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PortfolioService } from './portfolio.service';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';
import { ExecuteTradeDto, GetTradesDto } from '../../common/dto/trade.dto';
import { TransactionType, OrderType } from 'db';
import * as crypto from 'crypto';

describe('Tier 3: Trading State Machine & Limit Order Execution Spec', () => {
  let service: PortfolioService;
  let mockDb: any;
  let mockStockService: any;
  let mockPredictionService: any;
  let mockAiService: any;

  beforeEach(async () => {
    mockDb = {
      client: {
        user: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
        },
        portfolio: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
          update: jest.fn(),
        },
        stock: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        position: {
          findUnique: jest.fn(),
          update: jest.fn(),
          create: jest.fn(),
          delete: jest.fn(),
        },
        transaction: {
          create: jest.fn(),
          findMany: jest.fn(),
        },
        alert: {
          create: jest.fn().mockResolvedValue({}),
        },
        idempotencyRecord: {
          findUnique: jest.fn(),
          create: jest.fn(),
          upsert: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(mockDb.client)),
      },
    };

    mockStockService = {
      getQuote: jest.fn(),
      getQuotes: jest.fn(),
    };

    mockPredictionService = {
      getPrediction: jest.fn().mockResolvedValue(null),
    };

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

  describe('DTO Validation Contracts', () => {
    it('should validate valid Market Order DTO', async () => {
      const dto = plainToInstance(ExecuteTradeDto, {
        ticker: 'RELIANCE.NS',
        type: TransactionType.BUY,
        quantity: 10,
        orderType: OrderType.MARKET,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate valid Limit Order DTO with positive limit price', async () => {
      const dto = plainToInstance(ExecuteTradeDto, {
        ticker: 'TCS.NS',
        type: TransactionType.BUY,
        quantity: 5,
        orderType: OrderType.LIMIT,
        limitPrice: 3800.5,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject non-positive limit price in DTO', async () => {
      const dto = plainToInstance(ExecuteTradeDto, {
        ticker: 'TCS.NS',
        type: TransactionType.BUY,
        quantity: 5,
        orderType: OrderType.LIMIT,
        limitPrice: -100,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('limitPrice');
    });

    it('should reject trade quantity of 0 or negative', async () => {
      const dto = plainToInstance(ExecuteTradeDto, {
        ticker: 'INFY.NS',
        type: TransactionType.BUY,
        quantity: 0,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('quantity');
    });

    it('should validate GetTradesDto pagination constraints', async () => {
      const validDto = plainToInstance(GetTradesDto, { page: '2', limit: '25' });
      const errors = await validate(validDto);
      expect(errors.length).toBe(0);
      expect(validDto.page).toBe(2);
      expect(validDto.limit).toBe(25);

      const invalidLimit = plainToInstance(GetTradesDto, { limit: 150 });
      const limitErrors = await validate(invalidLimit);
      expect(limitErrors.length).toBeGreaterThan(0);

      const invalidPage = plainToInstance(GetTradesDto, { page: 0 });
      const pageErrors = await validate(invalidPage);
      expect(pageErrors.length).toBeGreaterThan(0);
    });
  });

  describe('PortfolioService Limit Order Semantics', () => {
    it('should reject LIMIT order if limitPrice is missing or <= 0', async () => {
      await expect(
        service.executeTrade('user_123', 'INFY.NS', TransactionType.BUY, 10, OrderType.LIMIT)
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.executeTrade('user_123', 'INFY.NS', TransactionType.BUY, 10, OrderType.LIMIT, undefined, -50)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject LIMIT BUY order with 400 LIMIT_UNFILLED if market price exceeds limit price', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'INFY.NS',
        price: 1850.0,
      });

      await expect(
        service.executeTrade(
          'user_123',
          'INFY.NS',
          TransactionType.BUY,
          10,
          OrderType.LIMIT,
          undefined,
          1800.0 // limit price is 1800, but market is 1850
        )
      ).rejects.toThrow(/LIMIT_UNFILLED.*exceeds limit buy price/);
    });

    it('should reject LIMIT SELL order with 400 LIMIT_UNFILLED if market price is below limit price', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'INFY.NS',
        price: 1750.0,
      });

      await expect(
        service.executeTrade(
          'user_123',
          'INFY.NS',
          TransactionType.SELL,
          10,
          OrderType.LIMIT,
          undefined,
          1800.0 // limit price is 1800, but market is 1750
        )
      ).rejects.toThrow(/LIMIT_UNFILLED.*below limit sell price/);
    });

    it('should fill LIMIT BUY order successfully when market price <= limit price', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'INFY.NS',
        name: 'Infosys Limited',
        price: 1780.0,
      });

      mockDb.client.user.findUnique.mockResolvedValue({ id: 'db_user_1', clerkId: 'user_123' });
      mockDb.client.stock.findFirst.mockResolvedValue({ id: 'stock_1', ticker: 'INFY.NS', name: 'Infosys' });
      mockDb.client.portfolio.findUnique.mockResolvedValue({
        id: 'port_1',
        userId: 'db_user_1',
        availableCash: 500000,
        positions: [],
      });
      mockDb.client.transaction.create.mockResolvedValue({
        id: 'tx_limit_buy_01',
        type: TransactionType.BUY,
        orderType: OrderType.LIMIT,
        price: 1780.0,
        quantity: 10,
      });

      const result = await service.executeTrade(
        'user_123',
        'INFY.NS',
        TransactionType.BUY,
        10,
        OrderType.LIMIT,
        undefined,
        1800.0
      );

      expect(result.success).toBe(true);
      expect(result.orderType).toBe(OrderType.LIMIT);
      expect(result.executionPrice).toBe(1780.0);
      expect(result.limitPrice).toBe(1800.0);
      expect(mockDb.client.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderType: OrderType.LIMIT,
            price: 1780.0,
          }),
        })
      );
    });

    it('should fill LIMIT SELL order successfully when market price >= limit price', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'TCS.NS',
        name: 'Tata Consultancy Services',
        price: 3950.0,
      });

      mockDb.client.user.findUnique.mockResolvedValue({ id: 'db_user_1', clerkId: 'user_123' });
      mockDb.client.stock.findFirst.mockResolvedValue({ id: 'stock_2', ticker: 'TCS.NS', name: 'TCS' });
      mockDb.client.portfolio.findUnique.mockResolvedValue({
        id: 'port_1',
        userId: 'db_user_1',
        availableCash: 100000,
        positions: [
          {
            id: 'pos_2',
            stockId: 'stock_2',
            quantity: 20,
            averagePrice: 3800.0,
            stock: { ticker: 'TCS.NS' },
          },
        ],
      });
      mockDb.client.transaction.create.mockResolvedValue({
        id: 'tx_limit_sell_01',
        type: TransactionType.SELL,
        orderType: OrderType.LIMIT,
        price: 3950.0,
        quantity: 10,
      });

      const result = await service.executeTrade(
        'user_123',
        'TCS.NS',
        TransactionType.SELL,
        10,
        OrderType.LIMIT,
        undefined,
        3900.0 // limit is 3900, market is 3950 (favorable)
      );

      expect(result.success).toBe(true);
      expect(result.orderType).toBe(OrderType.LIMIT);
      expect(result.executionPrice).toBe(3950.0);
      expect(result.limitPrice).toBe(3900.0);
    });
  });

  describe('Capital and Share Sufficiency Checks', () => {
    it('should reject BUY when portfolio available cash is insufficient', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'RELIANCE.NS',
        price: 3000.0,
      });
      mockDb.client.user.findUnique.mockResolvedValue({ id: 'db_user_1', clerkId: 'user_123' });
      mockDb.client.stock.findFirst.mockResolvedValue({ id: 'stock_3', ticker: 'RELIANCE.NS' });
      mockDb.client.portfolio.findUnique.mockResolvedValue({
        id: 'port_1',
        userId: 'db_user_1',
        availableCash: 5000, // Only 5,000 available
        positions: [],
      });

      // Attempting to buy 10 shares @ 3000 = 30,000 required
      await expect(
        service.executeTrade('user_123', 'RELIANCE.NS', TransactionType.BUY, 10)
      ).rejects.toThrow(/Insufficient virtual capital/);
    });

    it('should reject SELL when user does not hold enough shares', async () => {
      mockStockService.getQuote.mockResolvedValue({
        ticker: 'RELIANCE.NS',
        price: 3000.0,
      });
      mockDb.client.user.findUnique.mockResolvedValue({ id: 'db_user_1', clerkId: 'user_123' });
      mockDb.client.stock.findFirst.mockResolvedValue({ id: 'stock_3', ticker: 'RELIANCE.NS' });
      mockDb.client.portfolio.findUnique.mockResolvedValue({
        id: 'port_1',
        userId: 'db_user_1',
        availableCash: 100000,
        positions: [
          {
            id: 'pos_3',
            stockId: 'stock_3',
            quantity: 5, // Only holds 5 shares
            averagePrice: 2800,
            stock: { ticker: 'RELIANCE.NS' },
          },
        ],
      });

      // Attempting to sell 20 shares
      await expect(
        service.executeTrade('user_123', 'RELIANCE.NS', TransactionType.SELL, 20)
      ).rejects.toThrow(/Insufficient shares to sell.*only hold 5/);
    });
  });

  describe('Idempotency Key Verification', () => {
    it('should return cached trade result on identical replay (isDuplicate: true)', async () => {
      const cachedResult = {
        success: true,
        transactionId: 'tx_cached_999',
        ticker: 'INFY.NS',
        type: TransactionType.BUY,
        quantity: 10,
        executionPrice: 1800,
      };

      const expectedPayloadStr = JSON.stringify({
        ticker: 'INFY.NS',
        type: TransactionType.BUY,
        quantity: 10,
        orderType: OrderType.MARKET,
        limitPrice: null,
      });
      const canonicalPayloadHash = crypto.createHash('sha256').update(expectedPayloadStr).digest('hex');

      mockDb.client.idempotencyRecord.findUnique.mockResolvedValue({
        idempotencyKey: 'idem_key_001',
        canonicalPayloadHash,
        status: 'COMPLETED',
        result: cachedResult,
      });

      const result = await service.executeTrade(
        'user_123',
        'INFY.NS',
        TransactionType.BUY,
        10,
        OrderType.MARKET,
        'idem_key_001'
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.transactionId).toBe('tx_cached_999');
    });

    it('should reject idempotency key reused with different payload (409 Conflict)', async () => {
      mockDb.client.idempotencyRecord.findUnique.mockResolvedValue({
        idempotencyKey: 'idem_key_001',
        canonicalPayloadHash: 'hash_original_payload',
        status: 'COMPLETED',
      });

      await expect(
        service.executeTrade(
          'user_123',
          'INFY.NS',
          TransactionType.BUY,
          10,
          OrderType.MARKET,
          'idem_key_001'
        )
      ).rejects.toThrow(ConflictException);
    });
  });
});

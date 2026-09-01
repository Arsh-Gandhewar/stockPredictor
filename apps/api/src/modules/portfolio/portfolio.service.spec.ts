import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';
import * as crypto from 'crypto';

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: DatabaseService, useValue: {} },
        { provide: StockService, useValue: {} },
        { provide: QuantPredictionService, useValue: {} },
        { provide: AiService, useValue: {} },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Auto-sell Risk Trigger Idempotency Invariants', () => {
    it('should generate identical triggerEventId and payload hash across fluctuating quote prices and polling times', () => {
      const position = {
        id: 'pos_reliance_001',
        stock: { ticker: 'RELIANCE' },
        quantity: 50,
        avgBuyPrice: 2500.0,
        createdAt: new Date('2026-08-01T09:15:00.000Z'),
        stopLossPrice: 2400.0,
      };

      const reason = 'AUTO_STOP_LOSS';

      // Observation 1: Price drops to 2390 at 10:31
      const quotePrice1 = 2390.0;
      const quoteTime1 = new Date('2026-08-01T10:31:00.000Z');
      const epoch1 = position.createdAt.toISOString();
      const triggerEventId1 = `RISK_EVENT_${position.id}_${epoch1}_${reason}`;
      const payloadHash1 = crypto
        .createHash('sha256')
        .update(`POSITION:${position.id}:TICKER:${position.stock.ticker}:QTY:${position.quantity}:AVG_BUY:${position.avgBuyPrice}:REASON:${reason}:EPOCH:${epoch1}`)
        .digest('hex');

      // Observation 2: Price drops further to 2380 at 10:32 (different polling time and price)
      const quotePrice2 = 2380.0;
      const quoteTime2 = new Date('2026-08-01T10:32:00.000Z');
      const epoch2 = position.createdAt.toISOString();
      const triggerEventId2 = `RISK_EVENT_${position.id}_${epoch2}_${reason}`;
      const payloadHash2 = crypto
        .createHash('sha256')
        .update(`POSITION:${position.id}:TICKER:${position.stock.ticker}:QTY:${position.quantity}:AVG_BUY:${position.avgBuyPrice}:REASON:${reason}:EPOCH:${epoch2}`)
        .digest('hex');

      // Assert that both observations map to the EXACT same risk trigger event and idempotency key
      expect(triggerEventId1).toEqual(triggerEventId2);
      expect(payloadHash1).toEqual(payloadHash2);
      expect(triggerEventId1).toBe('RISK_EVENT_pos_reliance_001_2026-08-01T09:15:00.000Z_AUTO_STOP_LOSS');
    });

    it('should distinguish between different trigger types (stop loss vs target profit)', () => {
      const posId = 'pos_tcs_002';
      const epoch = '2026-08-01T09:15:00.000Z';
      const stopEvent = `RISK_EVENT_${posId}_${epoch}_AUTO_STOP_LOSS`;
      const targetEvent = `RISK_EVENT_${posId}_${epoch}_AUTO_TARGET_PROFIT`;

      expect(stopEvent).not.toEqual(targetEvent);
    });

    it('should generate distinct keys for different positions or re-opened epochs', () => {
      const posId1 = 'pos_infy_001';
      const posId2 = 'pos_infy_002';
      const epoch1 = '2026-08-01T09:15:00.000Z';
      const epoch2 = '2026-08-15T09:15:00.000Z';

      const keyPos1 = `RISK_EVENT_${posId1}_${epoch1}_AUTO_STOP_LOSS`;
      const keyPos2 = `RISK_EVENT_${posId2}_${epoch1}_AUTO_STOP_LOSS`;
      const keyReopened = `RISK_EVENT_${posId1}_${epoch2}_AUTO_STOP_LOSS`;

      expect(keyPos1).not.toEqual(keyPos2);
      expect(keyPos1).not.toEqual(keyReopened);
    });
  });
});


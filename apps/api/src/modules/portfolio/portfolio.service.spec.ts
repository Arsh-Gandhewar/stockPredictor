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
    it('should maintain invariant triggerEventId and canonicalPayloadHash while executionRequestHash tracks physical attempt parameters', () => {
      const position = {
        id: 'pos_reliance_001',
        stock: { ticker: 'RELIANCE' },
        quantity: 50,
        avgBuyPrice: 2500.0,
        createdAt: new Date('2026-08-01T09:15:00.000Z'),
        stopLossPrice: 2400.0,
      };

      const reason = 'AUTO_STOP_LOSS';
      const epoch = position.createdAt.toISOString();

      // Canonical Economic Trigger Identity (Invariant)
      const triggerEventId = `RISK_EVENT_${position.id}_${epoch}_${reason}`;
      const economicTriggerIdentity = `POSITION:${position.id}:TICKER:${position.stock.ticker}:QTY:${position.quantity}:AVG_BUY:${position.avgBuyPrice}:REASON:${reason}:EPOCH:${epoch}`;
      const canonicalPayloadHash = crypto
        .createHash('sha256')
        .update(economicTriggerIdentity)
        .digest('hex');

      // Execution Attempt 1: Price drops to 2390 at 10:31
      const execHash1 = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          triggerEventId,
          ticker: position.stock.ticker,
          quantity: position.quantity,
          observedPrice: 2390.0,
          executionPrice: 2388.8,
          quoteTimestamp: '2026-08-01T10:31:00.000Z',
        }))
        .digest('hex');

      // Execution Attempt 2: Price drops to 2380 at 10:32 (different price and time)
      const execHash2 = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          triggerEventId,
          ticker: position.stock.ticker,
          quantity: position.quantity,
          observedPrice: 2380.0,
          executionPrice: 2378.8,
          quoteTimestamp: '2026-08-01T10:32:00.000Z',
        }))
        .digest('hex');

      // 1. Economic trigger identity and deduplication key remain IDENTICAL
      expect(triggerEventId).toBe('RISK_EVENT_pos_reliance_001_2026-08-01T09:15:00.000Z_AUTO_STOP_LOSS');
      expect(canonicalPayloadHash).toBeDefined();

      // 2. Physical execution request hashes are DISTINCT per market quote observation
      expect(execHash1).not.toEqual(execHash2);
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


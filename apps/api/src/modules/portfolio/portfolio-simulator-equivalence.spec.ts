import { EventDrivenPortfolioSimulator, OrderIntent } from './engines/portfolio-simulator';
import { MODEL_CONFIG } from '../prediction/engines/model-config';
import { Money } from '../../common/utils/money.util';

describe('P0 Invariant: Portfolio Simulator & Paper Execution Equivalence', () => {
  let simulator: EventDrivenPortfolioSimulator;

  beforeEach(() => {
    simulator = new EventDrivenPortfolioSimulator({
      initialCash: 1_000_000,
      maxStockWeight: 0.10, // 10% stock cap
      maxSectorWeight: 0.25, // 25% sector cap
      maxPositions: 10,
      maxGrossExposure: 1.0,
      brokerageRate: 0.0003, // 3 bps
      sttSellRate: 0.0010, // 10 bps
      slippageRate: 0.0005, // 5 bps
    });
  });

  describe('1. Long-Only Mandate & Short Prohibition', () => {
    it('should reject SELL order when no position is held (prohibits short selling)', () => {
      const result = simulator.processOrderIntent({
        ticker: 'TCS.NS',
        sector: 'Technology',
        type: 'SELL',
        price: 4000.0,
        date: '2026-03-01',
      });

      expect(result.executed).toBe(false);
      expect(result.quantity).toBe(0);
      expect(result.rejectionReason).toContain('UNSUPPORTED_SHORT');
      expect(simulator.positions.size).toBe(0);
      expect(simulator.cash).toBe(1_000_000);
    });

    it('should only permit position reduction or exit when position is held', () => {
      // First buy shares
      const buyResult = simulator.processOrderIntent({
        ticker: 'RELIANCE.NS',
        sector: 'Energy',
        type: 'BUY',
        price: 2500.0,
        date: '2026-03-01',
      });
      expect(buyResult.executed).toBe(true);
      const heldQty = simulator.positions.get('RELIANCE.NS')!.quantity;
      expect(heldQty).toBeGreaterThan(0);

      // Now sell held shares
      const sellResult = simulator.processOrderIntent({
        ticker: 'RELIANCE.NS',
        sector: 'Energy',
        type: 'SELL',
        price: 2600.0,
        date: '2026-03-05',
        quantity: heldQty,
      });

      expect(sellResult.executed).toBe(true);
      expect(sellResult.trade).toBeDefined();
      expect(sellResult.trade!.positionType).toBe('LONG');
      expect(simulator.positions.has('RELIANCE.NS')).toBe(false);
    });
  });

  describe('2. Portfolio Concentration Limits (10% Stock Cap & 25% Sector Cap)', () => {
    it('should strictly limit individual stock allocation to 10% of NAV', () => {
      // Attempt to buy with high price
      const buyResult = simulator.processOrderIntent({
        ticker: 'HDFCBANK.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 1500.0,
        date: '2026-03-01',
      });

      expect(buyResult.executed).toBe(true);
      const position = simulator.positions.get('HDFCBANK.NS')!;
      const notional = position.quantity * position.averagePrice;
      const nav = simulator.getNAV();

      // Allocation must not exceed 10% of NAV
      expect(notional / nav).toBeLessThanOrEqual(0.1001);

      // A subsequent buy in the same stock when capped should be rejected
      const secondBuy = simulator.processOrderIntent({
        ticker: 'HDFCBANK.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 1500.0,
        date: '2026-03-02',
      });
      expect(secondBuy.executed).toBe(false);
      expect(secondBuy.rejectionReason).toContain('STOCK_CAP_EXCEEDED');
    });

    it('should strictly limit cumulative sector allocation to 25% of NAV', () => {
      // Buy Stock 1 in Financial Services (approx 10%)
      const buy1 = simulator.processOrderIntent({
        ticker: 'HDFCBANK.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 1600.0,
        date: '2026-03-01',
      });
      expect(buy1.executed).toBe(true);

      // Buy Stock 2 in Financial Services (approx 10%)
      const buy2 = simulator.processOrderIntent({
        ticker: 'BAJFINANCE.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 7000.0,
        date: '2026-03-01',
      });
      expect(buy2.executed).toBe(true);

      // Buy Stock 3 in Financial Services: remaining sector cap is ~5%
      const buy3 = simulator.processOrderIntent({
        ticker: 'ICICIBANK.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 1200.0,
        date: '2026-03-01',
      });
      expect(buy3.executed).toBe(true);

      const totalSectorVal = simulator.getSectorValue('Financial Services');
      const nav = simulator.getNAV();
      expect(totalSectorVal / nav).toBeLessThanOrEqual(0.2501);

      // Attempting Stock 4 in Financial Services must be rejected
      const buy4 = simulator.processOrderIntent({
        ticker: 'KOTAKBANK.NS',
        sector: 'Financial Services',
        type: 'BUY',
        price: 1800.0,
        date: '2026-03-01',
      });
      expect(buy4.executed).toBe(false);
      expect(buy4.rejectionReason).toContain('SECTOR_CAP_EXCEEDED');
    });
  });

  describe('3. Maximum 10 Concurrent Positions Constraint', () => {
    it('should enforce exactly 10 concurrent active positions maximum', () => {
      const tickers = [
        { ticker: 'STK1.NS', sector: 'Sector1' },
        { ticker: 'STK2.NS', sector: 'Sector2' },
        { ticker: 'STK3.NS', sector: 'Sector3' },
        { ticker: 'STK4.NS', sector: 'Sector4' },
        { ticker: 'STK5.NS', sector: 'Sector5' },
        { ticker: 'STK6.NS', sector: 'Sector6' },
        { ticker: 'STK7.NS', sector: 'Sector7' },
        { ticker: 'STK8.NS', sector: 'Sector8' },
        { ticker: 'STK9.NS', sector: 'Sector9' },
        { ticker: 'STK10.NS', sector: 'Sector10' },
      ];

      for (const item of tickers) {
        const res = simulator.processOrderIntent({
          ticker: item.ticker,
          sector: item.sector,
          type: 'BUY',
          price: 100.0,
          date: '2026-03-01',
        });
        expect(res.executed).toBe(true);
      }

      expect(simulator.positions.size).toBe(10);

      // Attempting the 11th position must be rejected
      const res11 = simulator.processOrderIntent({
        ticker: 'STK11.NS',
        sector: 'Sector11',
        type: 'BUY',
        price: 100.0,
        date: '2026-03-01',
      });

      expect(res11.executed).toBe(false);
      expect(res11.rejectionReason).toContain('MAX_POSITIONS_REACHED');
      expect(simulator.positions.size).toBe(10);
    });
  });

  describe('4. Conservative Intraday Collision Priority', () => {
    it('should prioritize STOP_LOSS execution when high touches target and low touches stop on same candle', () => {
      simulator.processOrderIntent({
        ticker: 'LT.NS',
        sector: 'Construction',
        type: 'BUY',
        price: 3500.0,
        date: '2026-03-01',
        stopLossPrice: 3400.0,
        targetPrice: 3700.0,
      });

      // Candle where BOTH target (3750 >= 3700) and stop (3350 <= 3400) are touched
      const candle = {
        time: '2026-03-02',
        open: 3520.0,
        high: 3750.0,
        low: 3350.0,
        close: 3600.0,
      };

      const trade = simulator.processCandlePath('LT.NS', candle);

      expect(trade).not.toBeNull();
      expect(trade!.exitReason).toBe('STOP_LOSS');
      expect(trade!.exitPrice).toBeLessThanOrEqual(3400.0);
      expect(simulator.positions.has('LT.NS')).toBe(false);
    });
  });

  describe('5. Zero Cash Deficit Invariant (Gross Exposure <= 100%)', () => {
    it('should never permit cash balance to drop below zero', () => {
      simulator.cash = 500; // Only ₹500 remaining

      const res = simulator.processOrderIntent({
        ticker: 'RELIANCE.NS',
        sector: 'Energy',
        type: 'BUY',
        price: 2800.0, // Share price ₹2800 > ₹500
        date: '2026-03-01',
      });

      expect(res.executed).toBe(false);
      expect(simulator.cash).toBe(500);
      expect(simulator.cash).toBeGreaterThanOrEqual(0);
    });
  });
});

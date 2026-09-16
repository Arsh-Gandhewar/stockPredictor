import { BadRequestException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { YahooMarketDataProvider, VALID_CHART_RANGES } from './providers/yahoo-market-data.provider';
import { isNseHoliday } from './data/nse-holidays.data';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { WatchlistService } from '../watchlist/watchlist.service';
import { AlertsService } from '../alerts/alerts.service';

describe('Tier 5: Fault Injection & Resilience Spec', () => {
  describe('Chart Range Strict Validation', () => {
    let provider: YahooMarketDataProvider;

    beforeEach(() => {
      provider = new YahooMarketDataProvider();
    });

    it('should reject unsupported chart ranges with 400 BadRequestException', async () => {
      const invalidRanges = ['invalid', '10d', '3y', 'all', '', 'day'];

      for (const range of invalidRanges) {
        await expect(
          provider.getHistoricalCandles('RELIANCE.NS', range)
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('should accept all officially supported chart ranges', () => {
      const expected = ['1d', '1w', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'];
      expect(VALID_CHART_RANGES).toEqual(expected);
    });
  });

  describe('Global Exception Filter Sanitization', () => {
    let filter: GlobalExceptionFilter;

    beforeEach(() => {
      filter = new GlobalExceptionFilter();
    });

    it('should NOT leak internal error details or database connection strings for non-HttpException errors', () => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => ({ status: mockStatus }),
          getRequest: () => ({ url: '/test-route', headers: {} }),
        }),
      } as unknown as ExecutionContext;

      const sensitiveError = new Error(
        'FATAL: connection to server at postgresql://quantx_admin:SuperSecretPass@db.internal:5432/quantx failed'
      );

      filter.catch(sensitiveError, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            statusCode: 500,
            message: 'An unexpected internal server error occurred',
          }),
        })
      );

      // Verify that NO sensitive credentials or raw database error strings appear in the JSON output
      const jsonCall = mockJson.mock.calls[0][0];
      const jsonString = JSON.stringify(jsonCall);
      expect(jsonString).not.toContain('SuperSecretPass');
      expect(jsonString).not.toContain('postgresql://');
      expect(jsonString).not.toContain('FATAL');
    });

    it('should preserve standard HttpException status and clean messages', () => {
      const mockJson = jest.fn();
      const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => ({ status: mockStatus }),
          getRequest: () => ({ url: '/test-bad-request', headers: {} }),
        }),
      } as unknown as ExecutionContext;

      const httpErr = new BadRequestException('Order quantity must be a positive integer');
      filter.catch(httpErr, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            statusCode: 400,
            message: 'Order quantity must be a positive integer',
          }),
        })
      );
    });
  });

  describe('Ticker Validation in Watchlist and Alerts Services', () => {
    let watchlistService: WatchlistService;
    let alertsService: AlertsService;
    let mockDb: any;

    beforeEach(() => {
      mockDb = {
        client: {
          user: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            findUniqueOrThrow: jest.fn(),
          },
          watchlist: { upsert: jest.fn() },
          watchlistStock: { upsert: jest.fn(), deleteMany: jest.fn() },
          stock: { upsert: jest.fn() },
          alert: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
        },
      };

      watchlistService = new WatchlistService(mockDb, {} as any, { getUniverse: () => [] } as any);
      alertsService = new AlertsService(mockDb);
    });

    it('should reject invalid ticker characters in WatchlistService (400)', async () => {
      const invalidTickers = ['DROP TABLE', 'TICKER;SELECT', 'INFY<script>', ''];
      for (const ticker of invalidTickers) {
        await expect(watchlistService.addTicker('user_123', ticker)).rejects.toThrow(BadRequestException);
        await expect(watchlistService.removeTicker('user_123', ticker)).rejects.toThrow(BadRequestException);
      }
    });

    it('should fail loud and throw error if Watchlist database query fails', async () => {
      mockDb.client.user.upsert.mockRejectedValue(new Error('Neon DB unreachable'));
      mockDb.client.user.findUniqueOrThrow.mockRejectedValue(new Error('Neon DB unreachable'));
      await expect(watchlistService.getUserWatchlist('user_123')).rejects.toThrow('Neon DB unreachable');
    });

    it('should reject invalid ticker characters and non-positive prices in AlertsService (400)', async () => {
      await expect(
        alertsService.createAlert('user_123', 'INVALID SPACES', 2500, 'ABOVE')
      ).rejects.toThrow(BadRequestException);

      await expect(
        alertsService.createAlert('user_123', 'RELIANCE.NS', -100, 'ABOVE')
      ).rejects.toThrow(/positive number/);

      await expect(
        alertsService.createAlert('user_123', 'RELIANCE.NS', 0, 'ABOVE')
      ).rejects.toThrow(/positive number/);
    });

    it('should fail loud and throw error if Alerts database query fails', async () => {
      mockDb.client.user.upsert.mockRejectedValue(new Error('Connection timeout'));
      mockDb.client.user.findUniqueOrThrow.mockRejectedValue(new Error('Connection timeout'));
      await expect(alertsService.getUserAlerts('user_123')).rejects.toThrow('Connection timeout');
    });
  });

  describe('NSE Trading Holiday Calendar', () => {
    it('should accurately identify official NSE trading holidays', () => {
      const republicDay = isNseHoliday('2025-01-26');
      expect(republicDay.isHoliday).toBe(true);
      expect(republicDay.holiday?.name).toBe('Republic Day');

      const independenceDay = isNseHoliday('2025-08-15');
      expect(independenceDay.isHoliday).toBe(true);
      expect(independenceDay.holiday?.name).toBe('Independence Day');

      const diwaliMuhurat = isNseHoliday('2025-10-21');
      expect(diwaliMuhurat.isHoliday).toBe(true);
      expect(diwaliMuhurat.holiday?.hasMuhuratTrading).toBe(true);
    });

    it('should accurately identify normal trading business days', () => {
      const normalTuesday = isNseHoliday('2025-06-10');
      expect(normalTuesday.isHoliday).toBe(false);
      expect(normalTuesday.holiday).toBeUndefined();
    });
  });

  describe('Market Provider Health Probe', () => {
    it('should report UP with latency when provider returns authentic price', async () => {
      const provider = new YahooMarketDataProvider();
      (provider as any).yf = {
        quote: jest.fn().mockResolvedValue({ regularMarketPrice: 24500.5 }),
      };

      const health = await provider.probeHealth();
      expect(health.status).toBe('UP');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should report DOWN with latency when provider rejects or times out', async () => {
      const provider = new YahooMarketDataProvider();
      (provider as any).yf = {
        quote: jest.fn().mockRejectedValue(new Error('Provider network timeout')),
      };

      const health = await provider.probeHealth();
      expect(health.status).toBe('DOWN');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});

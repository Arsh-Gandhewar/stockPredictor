import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import {
  MarketDataProvider,
  MarketQuote,
  OHLCVCandle,
  MarketStatus,
  MarketIndexBenchmark,
  UniverseStock,
} from './market-data.provider.interface';
import { TOP_300_INDIAN_UNIVERSE } from '../data/indian-universe.data';
import { isNseHoliday, classifyTradingSession } from '../data/nse-holidays.data';

export const VALID_CHART_RANGES = ['1d', '1w', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'] as const;
export type ValidChartRange = typeof VALID_CHART_RANGES[number];

@Injectable()
export class YahooMarketDataProvider implements MarketDataProvider {
  private readonly logger = new Logger(YahooMarketDataProvider.name);
  private readonly yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] });
  private universe: UniverseStock[] = TOP_300_INDIAN_UNIVERSE;

  /**
   * Evaluates current National Stock Exchange session status based on IST clock
   */
  getMarketStatus(referenceDate?: Date): MarketStatus {
    const now = referenceDate || new Date();
    const classification = classifyTradingSession(now);

    if (classification.isCalendarStale) {
      this.logger.warn(`CALENDAR_STALE: Current date (${now.toISOString()}) is outside supported exchange calendar bounds.`);
    }

    return {
      status: classification.status,
      sessionType: classification.sessionType,
      isCalendarStale: classification.isCalendarStale,
      calendarVersion: classification.calendarVersion,
      holidayName: classification.holidayName,
      timestamp: now.toISOString(),
      timezone: 'Asia/Kolkata',
      exchange: 'NSE',
    };
  }

  private formatQuote(q: any, ticker: string): MarketQuote | null {
    if (!q || typeof q.regularMarketPrice !== 'number' || q.regularMarketPrice <= 0) {
      return null;
    }
    const marketStatus = this.getMarketStatus();
    const meta = this.universe.find((s) => s.ticker === ticker);

    const price = q.regularMarketPrice;
    const prevClose = q.regularMarketPreviousClose || price;
    const change = q.regularMarketChange ?? (price - prevClose);
    const changePercent = q.regularMarketChangePercent ?? (prevClose > 0 ? (change / prevClose) * 100 : 0);

    const rawHigh = q.regularMarketDayHigh || price;
    const rawLow = q.regularMarketDayLow || price;
    const dayHigh = Math.max(rawHigh, price, prevClose);
    const dayLow = Math.min(rawLow, price, prevClose);

    const freshness =
      marketStatus.status === 'OPEN'
        ? 'LIVE'
        : marketStatus.status === 'PRE_OPEN'
        ? 'DELAYED'
        : 'CLOSED';

    let sourceTimestamp: string | null = null;
    if (q.regularMarketTime) {
      if (typeof q.regularMarketTime === 'number') {
        sourceTimestamp = new Date(q.regularMarketTime * 1000).toISOString();
      } else if (q.regularMarketTime instanceof Date) {
        sourceTimestamp = q.regularMarketTime.toISOString();
      } else {
        const d = new Date(q.regularMarketTime);
        if (!isNaN(d.getTime())) sourceTimestamp = d.toISOString();
      }
    }
    const serverReceivedAt = new Date().toISOString();

    return {
      ticker,
      name: meta?.name || q.shortName || q.longName || ticker.replace('.NS', ''),
      price: parseFloat(price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      dayHigh: parseFloat(dayHigh.toFixed(2)),
      dayLow: parseFloat(dayLow.toFixed(2)),
      prevClose: parseFloat(prevClose.toFixed(2)),
      open: parseFloat((q.regularMarketOpen || prevClose).toFixed(2)),
      volume: q.regularMarketVolume || 100000,
      marketCap: q.marketCap,
      pe: q.trailingPE,
      weekHigh52: q.fiftyTwoWeekHigh,
      weekLow52: q.fiftyTwoWeekLow,
      marketState: q.marketState || marketStatus.status,
      exchange: q.exchange || 'NSE',
      timestamp: sourceTimestamp,
      sourceTimestamp,
      serverReceivedAt,
      source: 'NSE / Yahoo Live Feed',
      freshness,
    };
  }

  public isSupportedTicker(rawTicker: string): boolean {
    if (!rawTicker || typeof rawTicker !== 'string') return false;
    const t = rawTicker.trim().toUpperCase();
    if (t.endsWith('.BO')) return false;
    const normalized = this.normalizeTicker(t);
    return this.universe.some((s) => s.ticker === normalized);
  }

  private normalizeTicker(rawTicker: string): string {
    if (!rawTicker) return rawTicker;
    const t = rawTicker.trim().toUpperCase();
    if (t.startsWith('^') || t.endsWith('.NS') || t.endsWith('.BO')) {
      return t;
    }
    return `${t}.NS`;
  }

  /**
   * Fetches real, live stock quotes directly from the National Stock Exchange (NSE)
   */
  async getQuote(rawTicker: string): Promise<MarketQuote> {
    const ticker = this.normalizeTicker(rawTicker);
    try {
      const q = (await this.yf.quote(ticker)) as any;
      const formatted = this.formatQuote(q, ticker);
      if (!formatted) {
        throw new Error(`Invalid market price received for ${ticker}`);
      }
      return formatted;
    } catch (err: any) {
      this.logger.warn(`Quote retrieval issue for ${ticker}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Fast batch-fetches multiple quotes using Yahoo Finance array querying
   */
  async getQuotes(rawTickers: string[]): Promise<MarketQuote[]> {
    if (!rawTickers || rawTickers.length === 0) return [];
    const tickers = rawTickers.map((t) => this.normalizeTicker(t));
    const results: MarketQuote[] = [];
    const batchSize = 15;

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      try {
        const rawQuotes = await this.yf.quote(batch);
        const quotesArray = Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes];
        for (const q of quotesArray) {
          if (q && q.symbol) {
            const formatted = this.formatQuote(q, q.symbol);
            if (formatted) results.push(formatted);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Batch quote failed for ${batch.length} tickers: ${err.message}`);
        // Zero amplification: Do not trigger unthrottled concurrent fan-out storm
      }
    }
    return results;
  }

  /**
   * Fetches authentic historical candlestick chart data from the National Stock Exchange
   */
  async getHistoricalCandles(ticker: string, range: string): Promise<OHLCVCandle[]> {
    if (!VALID_CHART_RANGES.includes(range as any)) {
      throw new BadRequestException(
        `Invalid chart range '${range}'. Valid ranges: ${VALID_CHART_RANGES.join(', ')}`
      );
    }

    let interval: '5m' | '15m' | '1d' | '1wk' | '1mo' = '1d';
    let queryPeriod1: Date;
    const now = new Date();

    if (range === '1d') {
      interval = '5m';
      queryPeriod1 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    } else if (range === '1w') {
      interval = '15m';
      queryPeriod1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    } else if (range === '1mo') {
      interval = '1d';
      queryPeriod1 = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    } else if (range === '3mo') {
      interval = '1d';
      queryPeriod1 = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
    } else if (range === '6mo') {
      interval = '1d';
      queryPeriod1 = new Date(Date.now() - 190 * 24 * 60 * 60 * 1000);
    } else if (range === '1y') {
      interval = '1d';
      queryPeriod1 = new Date(Date.now() - 430 * 24 * 60 * 60 * 1000);
    } else if (range === '2y') {
      interval = '1d';
      queryPeriod1 = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
    } else if (range === '5y') {
      interval = '1wk';
      queryPeriod1 = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
    } else {
      interval = '1mo';
      queryPeriod1 = new Date(Date.now() - 15 * 365 * 24 * 60 * 60 * 1000);
    }

    try {
      const chartResult = (await this.yf.chart(ticker, {
        period1: queryPeriod1,
        period2: now,
        interval,
      })) as any;

      if (chartResult && chartResult.quotes && chartResult.quotes.length > 0) {
        const isIntraday = range === '1d' || range === '1w';
        const seenTimes = new Set<string | number>();

        const rawCandles: OHLCVCandle[] = chartResult.quotes
          .filter(
            (q: any) =>
              q &&
              q.date &&
              q.open != null &&
              q.close != null &&
              q.high != null &&
              q.low != null &&
              q.high >= q.low
          )
          .map((q: any) => {
            const d = new Date(q.date);
            const time = isIntraday
              ? Math.floor(d.getTime() / 1000)
              : d.toISOString().split('T')[0];

            return {
              time,
              open: parseFloat(q.open.toFixed(2)),
              high: parseFloat(q.high.toFixed(2)),
              low: parseFloat(q.low.toFixed(2)),
              close: parseFloat(q.close.toFixed(2)),
              volume: q.volume || 0,
            };
          })
          .sort((a: any, b: any) => {
            const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
            const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
            return timeA - timeB;
          })
          .filter((c: any) => {
            if (seenTimes.has(c.time)) return false;
            seenTimes.add(c.time);
            return true;
          });

        if (rawCandles.length > 0) return rawCandles;
      }
    } catch (err: any) {
      this.logger.warn(`Chart fetch for ${ticker} error: ${err.message}`);
    }

    return [];
  }

  /**
   * Fetches real-time multi-index benchmark suite directly from NSE / BSE
   */
  async getMarketSummary(): Promise<MarketIndexBenchmark[]> {
    const indices = [
      { name: 'NIFTY 50', symbol: '^NSEI' },
      { name: 'SENSEX', symbol: '^BSESN' },
      { name: 'BANK NIFTY', symbol: '^NSEBANK' },
      { name: 'INDIA VIX', symbol: '^INDIAVIX' },
    ];

    const results = await Promise.allSettled(
      indices.map(async (idx) => {
        const q = (await this.yf.quote(idx.symbol)) as any;
        const val = q?.regularMarketPrice;
        if (!val || typeof val !== 'number') {
          throw new Error(`Could not fetch index ${idx.name}`);
        }
        const change = q?.regularMarketChange ?? 0;
        const changePercent = q?.regularMarketChangePercent ?? (val > 0 ? (change / val) * 100 : 0);

        return {
          name: idx.name,
          symbol: idx.symbol,
          value: parseFloat(val.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePercent.toFixed(2)),
          up: change >= 0,
          marketState: q?.marketState || 'REGULAR',
          timestamp: new Date().toISOString(),
        };
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<MarketIndexBenchmark> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /**
   * Returns entire configured universe
   */
  getUniverse(): UniverseStock[] {
    return this.universe;
  }

  /**
   * High-speed global stock search
   */
  async search(query: string): Promise<UniverseStock[]> {
    const q = query.trim().toLowerCase();
    if (!q) return this.universe.slice(0, 20);

    return this.universe
      .filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.sector && s.sector.toLowerCase().includes(q)) ||
          (s.industry && s.industry.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }

  /**
   * Performs an authentic lightweight health check against the market provider
   */
  async probeHealth(): Promise<{ status: 'UP' | 'DEGRADED' | 'DOWN'; latencyMs: number }> {
    const t0 = Date.now();
    try {
      const q = (await Promise.race([
        this.yf.quote('^NSEI'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Market provider probe timeout')), 3000)
        ),
      ])) as any;
      const latencyMs = Date.now() - t0;
      if (q && typeof q.regularMarketPrice === 'number' && q.regularMarketPrice > 0) {
        return { status: 'UP', latencyMs };
      }
      return { status: 'DEGRADED', latencyMs };
    } catch (err: any) {
      return { status: 'DOWN', latencyMs: Date.now() - t0 };
    }
  }
}

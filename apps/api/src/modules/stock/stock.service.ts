import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import { DatabaseService } from '../../database/database.service';
import { RSI, MACD, EMA, SMA, BollingerBands, ATR, ADX } from 'technicalindicators';

// Properly instantiate yahoo-finance2 v4
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// ── Types ──────────────────────────────────────────────────────────────
export interface StockQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;
  open: number;
  volume: number;
  marketCap?: number;
  pe?: number;
  weekHigh52?: number;
  weekLow52?: number;
  marketState: string;
  exchange: string;
  timestamp: string;
  source: string;
  freshness: 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED';
}

export interface MarketIndex {
  name: string;
  symbol: string;
  value: number;
  change: number;
  changePercent: number;
  up: boolean;
  marketState: string;
  timestamp: string;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ── IST Market Hours Utilities ─────────────────────────────────────────
function getISTNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function getMarketStatus(): 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'HOLIDAY' {
  const now = getISTNow();
  const day = now.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return 'CLOSED';

  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeMinutes = hour * 60 + minute;

  // NSE: Pre-open 9:00-9:15, Market 9:15-15:30
  if (timeMinutes >= 540 && timeMinutes < 555) return 'PRE_OPEN';
  if (timeMinutes >= 555 && timeMinutes <= 930) return 'OPEN';
  return 'CLOSED';
}

function determineFreshness(marketState: string, quoteTimestamp?: Date): 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED' {
  if (marketState === 'REGULAR' || marketState === 'OPEN') {
    if (!quoteTimestamp) return 'DELAYED';
    const ageMs = Date.now() - quoteTimestamp.getTime();
    if (ageMs < 60_000) return 'LIVE';
    if (ageMs < 300_000) return 'DELAYED';
    return 'STALE';
  }
  return 'CLOSED';
}

// ── Service ────────────────────────────────────────────────────────────
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);
  private cache = new Map<string, { data: any; expiresAt: number }>();

  constructor(private readonly db: DatabaseService) {}

  // ── Cache helper ──
  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    return null;
  }

  private setCache(key: string, data: any, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private getCacheTtl(): number {
    const status = getMarketStatus();
    return status === 'OPEN' ? 5_000 : 30_000; // 5s during market, 30s otherwise
  }

  // ── Live Quote ──
  async getQuote(ticker: string): Promise<StockQuote> {
    const cacheKey = `quote:${ticker}`;
    const cached = this.getCached<StockQuote>(cacheKey);
    if (cached) return cached;

    try {
      const q = await yahooFinance.quote(ticker) as any;
      if (!q || !q.regularMarketPrice) {
        throw new NotFoundException(`No quote data available for ${ticker}`);
      }

      const quote: StockQuote = {
        ticker,
        name: q.longName || q.shortName || ticker,
        price: q.regularMarketPrice,
        change: q.regularMarketChange || 0,
        changePercent: q.regularMarketChangePercent || 0,
        dayHigh: q.regularMarketDayHigh || 0,
        dayLow: q.regularMarketDayLow || 0,
        prevClose: q.regularMarketPreviousClose || 0,
        open: q.regularMarketOpen || 0,
        volume: q.regularMarketVolume || 0,
        marketCap: q.marketCap || undefined,
        pe: q.trailingPE || undefined,
        weekHigh52: q.fiftyTwoWeekHigh || undefined,
        weekLow52: q.fiftyTwoWeekLow || undefined,
        marketState: q.marketState || 'UNKNOWN',
        exchange: q.fullExchangeName || q.exchange || 'NSE',
        timestamp: new Date().toISOString(),
        source: 'yahoo-finance',
        freshness: determineFreshness(q.marketState),
      };

      this.setCache(cacheKey, quote, this.getCacheTtl());
      return quote;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to fetch quote for ${ticker}: ${error.message}`);
      throw new NotFoundException(`Unable to fetch data for ${ticker}. Please verify the ticker symbol.`);
    }
  }

  // ── Market Summary (Indices) ──
  async getMarketSummary(): Promise<MarketIndex[]> {
    const cached = this.getCached<MarketIndex[]>('market-summary');
    if (cached) return cached;

    const indices = [
      { name: 'NIFTY 50', symbol: '^NSEI' },
      { name: 'SENSEX', symbol: '^BSESN' },
      { name: 'BANK NIFTY', symbol: '^NSEBANK' },
      { name: 'INDIA VIX', symbol: '^INDIAVIX' },
    ];

    const results: MarketIndex[] = [];
    const quotes = await Promise.allSettled(
      indices.map(idx => yahooFinance.quote(idx.symbol))
    );

    for (let i = 0; i < indices.length; i++) {
      const result = quotes[i];
      if (result.status === 'fulfilled' && result.value) {
        const q = result.value as any;
        results.push({
          name: indices[i].name,
          symbol: indices[i].symbol,
          value: q.regularMarketPrice || 0,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          up: (q.regularMarketChangePercent || 0) >= 0,
          marketState: q.marketState || 'UNKNOWN',
          timestamp: new Date().toISOString(),
        });
      } else {
        this.logger.warn(`Failed to fetch index ${indices[i].symbol}`);
        results.push({
          name: indices[i].name,
          symbol: indices[i].symbol,
          value: 0,
          change: 0,
          changePercent: 0,
          up: true,
          marketState: 'DATA_UNAVAILABLE',
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.setCache('market-summary', results, this.getCacheTtl());
    return results;
  }

  // ── Market Status ──
  async getMarketStatusInfo() {
    return {
      status: getMarketStatus(),
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      exchange: 'NSE',
    };
  }

  // ── Historical Chart Data (from Yahoo Finance, NOT stale DB) ──
  async getChartData(ticker: string, range: string = '6mo'): Promise<Candle[]> {
    const cacheKey = `chart:${ticker}:${range}`;
    const cached = this.getCached<Candle[]>(cacheKey);
    if (cached) return cached;

    // Map range string to yahoo-finance2 chart params (with weekend-safe lookback)
    const rangeMap: Record<string, { period1: string; interval: string }> = {
      '1d':  { period1: this.daysAgo(4),   interval: '5m' },
      '1w':  { period1: this.daysAgo(10),  interval: '15m' },
      '1mo': { period1: this.daysAgo(30),  interval: '1d' },
      '3mo': { period1: this.daysAgo(90),  interval: '1d' },
      '6mo': { period1: this.daysAgo(180), interval: '1d' },
      '1y':  { period1: this.daysAgo(365), interval: '1wk' },
      '5y':  { period1: this.daysAgo(1825), interval: '1mo' },
    };

    const params = rangeMap[range] || rangeMap['6mo'];

    try {
      const result = await yahooFinance.chart(ticker, {
        period1: params.period1,
        interval: params.interval as any,
      });

      if (!result || !result.quotes || result.quotes.length === 0) {
        return [];
      }

      const rawCandles = result.quotes
        .filter((q: any) => q.close !== null && q.open !== null && q.high !== null && q.low !== null)
        .map((q: any) => {
          const dt = q.date instanceof Date ? q.date : new Date(q.date);
          const isIntraday = ['1d', '1w'].includes(range);
          return {
            time: isIntraday 
              ? Math.floor(dt.getTime() / 1000) 
              : dt.toISOString().split('T')[0],
            rawTime: dt.getTime(),
            open: Number(q.open?.toFixed(2)),
            high: Number(q.high?.toFixed(2)),
            low: Number(q.low?.toFixed(2)),
            close: Number(q.close?.toFixed(2)),
            volume: q.volume || 0,
          };
        })
        .sort((a: any, b: any) => a.rawTime - b.rawTime);

      // Strictly deduplicate by time key to guarantee Lightweight Charts never receives duplicate timestamps
      const seenTimes = new Set<string | number>();
      const candles: Candle[] = [];
      for (const c of rawCandles) {
        if (!seenTimes.has(c.time)) {
          seenTimes.add(c.time);
          candles.push({
            time: c.time as any,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          });
        }
      }

      // Cache charts longer since historical data doesn't change often
      this.setCache(cacheKey, candles, range === '1d' ? 60_000 : 600_000);
      return candles;
    } catch (error: any) {
      this.logger.error(`Failed to fetch chart data for ${ticker}: ${error.message}`);
      return [];
    }
  }

  private daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  // ── Stock Profile (live quote + DB metadata + AI insight) ──
  async getStockProfile(ticker: string) {
    // Fetch live quote and DB data in parallel
    const [quote, dbStock] = await Promise.all([
      this.getQuote(ticker).catch(() => null),
      this.db.client.stock.findUnique({
        where: { ticker },
        include: {
          aiInsights: { orderBy: { timestamp: 'desc' }, take: 1 },
          technicalIndicators: { orderBy: { timestamp: 'desc' }, take: 1 },
        },
      }),
    ]);

    if (!quote && !dbStock) {
      throw new NotFoundException(`Stock ${ticker} not found`);
    }

    return {
      ticker,
      name: quote?.name || dbStock?.name || ticker,
      sector: dbStock?.sector || null,
      exchange: quote?.exchange || dbStock?.exchange || 'NSE',
      // Live price data
      price: quote?.price || 0,
      change: quote?.change || 0,
      changePercent: quote?.changePercent || 0,
      dayHigh: quote?.dayHigh || 0,
      dayLow: quote?.dayLow || 0,
      prevClose: quote?.prevClose || 0,
      open: quote?.open || 0,
      volume: quote?.volume || 0,
      marketCap: quote?.marketCap || null,
      pe: quote?.pe || null,
      weekHigh52: quote?.weekHigh52 || null,
      weekLow52: quote?.weekLow52 || null,
      // Market status
      marketState: quote?.marketState || 'UNKNOWN',
      freshness: quote?.freshness || 'STALE',
      timestamp: quote?.timestamp || new Date().toISOString(),
      source: 'yahoo-finance',
      // AI insight
      insight: dbStock?.aiInsights?.[0] || null,
      // Technical indicators
      technicals: dbStock?.technicalIndicators?.[0] || null,
    };
  }

  // ── Top Picks (live prices from Yahoo) ──
  async getTopPicks() {
    const cached = this.getCached<any[]>('top-picks');
    if (cached) return cached;

    const stocks = await this.db.client.stock.findMany({
      include: {
        aiInsights: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      take: 10,
    });

    // Fetch live prices in parallel
    const results = await Promise.allSettled(
      stocks.map(async (stock: any) => {
        const quote = await this.getQuote(stock.ticker).catch(() => null);
        const insight = stock.aiInsights[0];
        return {
          ticker: stock.ticker,
          name: stock.name,
          sector: stock.sector,
          price: quote?.price || 0,
          change: quote?.change || 0,
          changePercent: quote?.changePercent || 0,
          volume: quote?.volume || 0,
          recommendation: insight?.recommendation || 'HOLD',
          confidence: insight?.confidenceScore || 50,
          freshness: quote?.freshness || 'STALE',
          timestamp: quote?.timestamp || new Date().toISOString(),
        };
      })
    );

    const picks = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(p => p.price > 0)
      .sort((a, b) => b.confidence - a.confidence);

    this.setCache('top-picks', picks, this.getCacheTtl());
    return picks;
  }

  // ── Market Movers (Gainers, Losers, Most Active) ──
  async getMarketMovers() {
    const cached = this.getCached<any>('market-movers');
    if (cached) return cached;

    const stocks = await this.db.client.stock.findMany({ take: 50 });
    
    const quotes = await Promise.allSettled(
      stocks.map(s => this.getQuote(s.ticker).catch(() => null))
    );

    const validQuotes = quotes
      .filter((r): r is PromiseFulfilledResult<StockQuote | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((q): q is StockQuote => q !== null && q.price > 0);

    const sorted = [...validQuotes].sort((a, b) => b.changePercent - a.changePercent);

    const result = {
      gainers: sorted.filter(q => q.changePercent > 0).slice(0, 5).map(this.formatMover),
      losers: sorted.filter(q => q.changePercent < 0).reverse().slice(0, 5).map(this.formatMover),
      mostActive: [...validQuotes].sort((a, b) => b.volume - a.volume).slice(0, 5).map(this.formatMover),
      timestamp: new Date().toISOString(),
    };

    this.setCache('market-movers', result, this.getCacheTtl());
    return result;
  }

  private formatMover(q: StockQuote) {
    return {
      ticker: q.ticker,
      name: q.name,
      price: q.price,
      change: q.change,
      changePercent: q.changePercent,
      volume: q.volume,
    };
  }

  // ── High Risk • High Reward Opportunities ──
  async getHighRiskHighRewardOpportunities() {
    const cached = this.getCached<any[]>('high-risk-high-reward');
    if (cached) return cached;

    // High Beta & Volatile Blue Chips in Indian Markets
    const highRiskUniverse = [
      { ticker: 'ADANIENT.NS', catalyst: 'Capex Acceleration & Infrastructure Buildout', beta: 1.85, baseUpside: 24.5, stopLoss: -6.2, riskLevel: 'VERY HIGH' },
      { ticker: 'TATASTEEL.NS', catalyst: 'Global Metals Cycle & European Plant Turnaround', beta: 1.62, baseUpside: 19.8, stopLoss: -5.4, riskLevel: 'HIGH' },
      { ticker: 'BAJFINANCE.NS', catalyst: 'Omnichannel Credit Velocity & Asset Expansion', beta: 1.48, baseUpside: 18.2, stopLoss: -4.8, riskLevel: 'HIGH' },
      { ticker: 'JSWSTEEL.NS', catalyst: 'Export Duty Tailwinds & Green Steel Capacity', beta: 1.55, baseUpside: 16.5, stopLoss: -5.1, riskLevel: 'HIGH' },
      { ticker: 'INDUSINDBK.NS', catalyst: 'Commercial Vehicle Loan Growth Recovery', beta: 1.42, baseUpside: 17.4, stopLoss: -4.5, riskLevel: 'HIGH' },
      { ticker: 'COALINDIA.NS', catalyst: 'Power Peak Demand Surge & Higher E-Auction Realization', beta: 1.38, baseUpside: 15.6, stopLoss: -4.2, riskLevel: 'HIGH' },
      { ticker: 'ADANIPORTS.NS', catalyst: 'Cargo Volume Expansion & Logistics Corridor Monopolization', beta: 1.72, baseUpside: 21.0, stopLoss: -5.8, riskLevel: 'VERY HIGH' },
      { ticker: 'HINDALCO.NS', catalyst: 'Novelis Expansion & Aluminum Price Strength', beta: 1.58, baseUpside: 18.9, stopLoss: -5.2, riskLevel: 'HIGH' },
    ];

    const results = await Promise.allSettled(
      highRiskUniverse.map(async (item) => {
        const quote = await this.getQuote(item.ticker).catch(() => null);
        const dayRangeSpread = quote && quote.dayLow > 0
          ? ((quote.dayHigh - quote.dayLow) / quote.dayLow) * 100
          : 3.2;

        return {
          ticker: item.ticker,
          name: quote?.name || item.ticker.replace('.NS', ''),
          price: quote?.price || 0,
          change: quote?.change || 0,
          changePercent: quote?.changePercent || 0,
          dayHigh: quote?.dayHigh || 0,
          dayLow: quote?.dayLow || 0,
          volume: quote?.volume || 0,
          beta: item.beta,
          intradayVolatility: Number(dayRangeSpread.toFixed(2)),
          catalyst: item.catalyst,
          targetUpsidePercent: item.baseUpside,
          stopLossPercent: item.stopLoss,
          targetPrice: quote?.price ? Number((quote.price * (1 + item.baseUpside / 100)).toFixed(2)) : 0,
          stopLossPrice: quote?.price ? Number((quote.price * (1 + item.stopLoss / 100)).toFixed(2)) : 0,
          riskRewardRatio: `1:${(Math.abs(item.baseUpside / item.stopLoss)).toFixed(1)}`,
          riskLevel: item.riskLevel,
          convictionScore: Math.floor(84 + (Math.abs(quote?.changePercent || 0) * 1.5) % 12),
        };
      })
    );

    const highRiskPicks = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(p => p.price > 0)
      .sort((a, b) => b.beta - a.beta);

    this.setCache('high-risk-high-reward', highRiskPicks, this.getCacheTtl());
    return highRiskPicks;
  }

  // ── Search ──
  async searchStocks(query: string) {
    if (!query || query.length < 1) return [];

    const q = query.toUpperCase();
    
    // Search local DB first
    const dbResults = await this.db.client.stock.findMany({
      where: {
        OR: [
          { ticker: { contains: q, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { sector: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });

    return dbResults.map((s: any) => ({
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      exchange: s.exchange,
    }));
  }

  // ── All Stocks List ──
  async getAllStocks() {
    return this.db.client.stock.findMany({
      select: {
        ticker: true,
        name: true,
        sector: true,
        exchange: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // ── Get Latest Quote (used by PortfolioService) ──
  async getLatestQuote(ticker: string) {
    return yahooFinance.quote(ticker);
  }

  // ── Sync Historical Data (for background jobs) ──
  async syncHistoricalData(ticker: string, period1: string, period2: string = new Date().toISOString().split('T')[0]) {
    try {
      this.logger.log(`Syncing historical data for ${ticker}...`);
      const stock = await this.db.client.stock.findUnique({ where: { ticker } });
      if (!stock) throw new NotFoundException(`Stock ${ticker} not found in DB`);

      const result = await yahooFinance.chart(ticker, {
        period1,
        period2,
        interval: '1d' as any,
      });

      if (!result?.quotes?.length) {
        this.logger.warn(`No historical data returned for ${ticker}`);
        return;
      }

      // Batch insert with createMany (skip duplicates)
      const records = result.quotes
        .filter((q: any) => q.close !== null && q.open !== null)
        .map((q: any) => ({
          stockId: stock.id,
          date: q.date instanceof Date ? q.date : new Date(q.date),
          open: Number(q.open),
          high: Number(q.high),
          low: Number(q.low),
          close: Number(q.close),
          volume: BigInt(q.volume || 0),
        }));

      // Use upsert in batches of 50 for safety
      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        await Promise.all(batch.map(record =>
          this.db.client.priceHistory.upsert({
            where: { stockId_date: { stockId: record.stockId, date: record.date } },
            update: { open: record.open, high: record.high, low: record.low, close: record.close, volume: record.volume },
            create: record,
          })
        ));
      }

      this.logger.log(`Synced ${records.length} records for ${ticker}`);
    } catch (error: any) {
      this.logger.error(`Error syncing ${ticker}: ${error.message}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from './providers/yahoo-market-data.provider';
import { NewsService } from '../news/news.service';
import {
  MarketQuote,
  OHLCVCandle,
  MarketIndexBenchmark,
  UniverseStock,
} from './providers/market-data.provider.interface';
import { Money } from '../../common/utils/money.util';
import { RSI, MACD, SMA, BollingerBands } from 'technicalindicators';

export interface MovementCatalyst {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  volumeSurgeRatio: number;
  primaryDriver: string;
  catalystType: 'TECHNICAL_BREAKOUT' | 'EARNINGS_ANNOUNCEMENT' | 'SECTOR_RALLY' | 'VOLUME_SPIKE' | 'BROAD_MARKET' | 'PROFIT_BOOKING' | 'MOMENTUM_BREAKOUT' | 'ORDERBOOK_PIPELINE' | 'RANGE_ACCUMULATION';
  confidenceScore: number;
  keyFactors: string[];
  invalidationLevel: number;
  newsSentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  topHeadline?: string;
}

export interface StockProfileData {
  stock: UniverseStock & { id?: string };
  quote: MarketQuote;
  chart: OHLCVCandle[];
  technicals: {
    rsi: number;
    rsiStance: string;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
      trend: string;
    };
    sma50: number;
    sma200: number;
    goldenCross: boolean;
    bollinger: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
  catalyst: MovementCatalyst;
}

export interface TopPick {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  recommendation: string;
  confidenceScore: number;
  convictionScore: number;
  newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  newsImpactScore: number;
  topHeadline?: string;
  reasoning: string;
  target: number;
  stopLoss: number;
  rewardRiskRatio: number;
  rank?: number;
}

export interface HighRiskPick {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  beta: number;
  rewardRiskRatio: number;
  targetPrice: number;
  stopLossPrice: number;
  targetPercent: number;
  stopLossPercent: number;
  alphaScore: number;
  newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  topHeadline?: string;
  catalyst: string;
  rank?: number;
  volatilityRank?: string;
}

@Injectable()
export class StockService {
  private static readonly CONFIDENCE = {
    BASE: 76,
    MOMENTUM_WEIGHT: 3.5,
    HIGH_VOLUME_THRESHOLD: 1_000_000,
    HIGH_VOLUME_BONUS: 5,
    MIN: 50,
    MAX: 98,
  } as const;

  private readonly logger = new Logger(StockService.name);
  private cache = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly marketProvider: YahooMarketDataProvider,
    private readonly newsService: NewsService
  ) {
    // Clean expired cache entries every 60 seconds
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) this.cache.delete(key);
      }
    }, 60_000);
  }

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
    return null;
  }

  private setCache(key: string, data: any, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private getCacheTtl(): number {
    const status = this.marketProvider.getMarketStatus();
    return status.status === 'OPEN' ? 2_000 : 10_000; // 2s during market, 10s otherwise
  }

  async getMarketSummary(): Promise<MarketIndexBenchmark[]> {
    const cached = this.getCached<MarketIndexBenchmark[]>('market-summary');
    if (cached) return cached;

    const data = await this.marketProvider.getMarketSummary();
    this.setCache('market-summary', data, this.getCacheTtl());
    return data;
  }

  getMarketStatusInfo() {
    return this.marketProvider.getMarketStatus();
  }

  async getQuote(ticker: string): Promise<MarketQuote> {
    const cacheKey = `quote:${ticker}`;
    const cached = this.getCached<MarketQuote>(cacheKey);
    if (cached) return cached;

    const quote = await this.marketProvider.getQuote(ticker);
    this.setCache(cacheKey, quote, this.getCacheTtl());
    return quote;
  }

  async getQuotes(tickers: string[]): Promise<MarketQuote[]> {
    const uncached = [];
    const results = [];
    for (const ticker of tickers) {
      const cached = this.getCached<MarketQuote>(`quote:${ticker}`);
      if (cached) results.push(cached);
      else uncached.push(ticker);
    }
    
    if (uncached.length > 0) {
      const freshQuotes = await this.marketProvider.getQuotes(uncached);
      for (const q of freshQuotes) {
        this.setCache(`quote:${q.ticker}`, q, this.getCacheTtl());
        results.push(q);
      }
    }
    
    return results;
  }

  async getChartData(ticker: string, range: string = '6mo'): Promise<OHLCVCandle[]> {
    const cacheKey = `chart:${ticker}:${range}`;
    const cached = this.getCached<OHLCVCandle[]>(cacheKey);
    if (cached) return cached;

    const candles = await this.marketProvider.getHistoricalCandles(ticker, range);
    this.setCache(cacheKey, candles, range === '1d' ? 2_000 : 30_000);
    return candles;
  }

  async getAllStocks(): Promise<UniverseStock[]> {
    return this.marketProvider.getUniverse();
  }

  async searchStocks(query: string): Promise<UniverseStock[]> {
    return this.marketProvider.search(query);
  }

  async getMarketMovers(): Promise<{
    gainers: any[];
    losers: any[];
    mostActive: any[];
  }> {
    const cached = this.getCached<any>('market-movers');
    if (cached) return cached;

    // Scan top universe leaders for real-time movers
    const scanUniverse = this.marketProvider.getUniverse().slice(0, 50);
    const quotes = await this.marketProvider.getQuotes(scanUniverse.map((s) => s.ticker));

    const sortedByChange = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
    const sortedByVolume = [...quotes].sort((a, b) => (b.volume || 0) - (a.volume || 0));

    const result = {
      gainers: sortedByChange.slice(0, 10),
      losers: [...sortedByChange].reverse().slice(0, 10),
      mostActive: sortedByVolume.slice(0, 10),
    };

    this.setCache('market-movers', result, this.getCacheTtl());
    return result;
  }

  async getTopPicks(): Promise<TopPick[]> {
    const cached = this.getCached<TopPick[]>('top-picks');
    if (cached) return cached;

    // Scan top 25 universe equities
    const monitored = this.marketProvider.getUniverse().slice(0, 25);
    const quotes = await this.marketProvider.getQuotes(monitored.map((s) => s.ticker));

    const picks = await Promise.all(
      quotes.map(async (q) => {
        const isBullish = q.changePercent >= 0;
        const meta = this.marketProvider.getUniverse().find((u) => u.ticker === q.ticker);
        const sector = meta?.sector || 'Core Equities';
        const companyName = meta?.name || q.name;

        // 1. Live news sentiment impact score (-20 to +20)
        let newsData: { sentimentScore: number; sentimentLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string; newsCount: number } = { sentimentScore: 0, sentimentLabel: 'NEUTRAL', topHeadline: undefined, newsCount: 0 };
        try {
          newsData = await this.newsService.getSentimentScoreForStock(q.ticker, sector, companyName);
        } catch { /* gracefully degrade to neutral */ }

        // 2. Base technical confidence score
        const baseConfidence = Math.min(
          94,
          Math.max(68, Math.round(StockService.CONFIDENCE.BASE + q.changePercent * StockService.CONFIDENCE.MOMENTUM_WEIGHT + ((q.volume || 0) > StockService.CONFIDENCE.HIGH_VOLUME_THRESHOLD ? StockService.CONFIDENCE.HIGH_VOLUME_BONUS : 0)))
        );

        // 3. Final Buying Confidence adjusted by live 5-min news sentiment
        const finalConfidenceScore = Math.min(StockService.CONFIDENCE.MAX, Math.max(StockService.CONFIDENCE.MIN, baseConfidence + newsData.sentimentScore));

        // 4. Recommendation tier based on news-adjusted buying confidence
        const recommendation =
          finalConfidenceScore >= 88 && q.changePercent >= 0.5
            ? 'STRONG_BUY'
            : finalConfidenceScore >= 78
            ? 'BUY'
            : finalConfidenceScore >= 65
            ? 'ACCUMULATE'
            : 'HOLD';

        // 5. Descending conviction score
        const convictionScore =
          (recommendation === 'STRONG_BUY' ? 100 : recommendation === 'BUY' ? 80 : recommendation === 'ACCUMULATE' ? 60 : 40) +
          finalConfidenceScore +
          (q.changePercent * 2) +
          newsData.sentimentScore;

        const targetPercent = isBullish
          ? parseFloat((6.5 + Math.min(8, q.changePercent * 1.5) + (newsData.sentimentScore > 0 ? 1.5 : 0)).toFixed(1))
          : 5.0;
        const stopLossPercent = parseFloat((targetPercent / 2.2).toFixed(1));

        let reasoning = `High institutional liquidity and positive momentum alignment with ${recommendation.replace('_', ' ')} conviction.`;
        if (newsData.topHeadline) {
          reasoning = `Live news catalyst (${newsData.sentimentLabel}): "${newsData.topHeadline}" (${newsData.sentimentScore >= 0 ? '+' : ''}${newsData.sentimentScore}pt impact).`;
        }

        return {
          ticker: q.ticker,
          name: companyName,
          sector,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          recommendation,
          confidenceScore: finalConfidenceScore,
          convictionScore,
          newsSentiment: newsData.sentimentLabel,
          newsImpactScore: newsData.sentimentScore,
          topHeadline: newsData.topHeadline,
          reasoning,
          target: Money.round(q.price * (1 + targetPercent / 100)),
          stopLoss: Money.round(q.price * (1 - stopLossPercent / 100)),
          rewardRiskRatio: 2.2,
        };
      })
    );

    // Sort strictly in descending order of Buy Conviction Score (Best Buy on Top)
    const sortedPicks = picks
      .sort((a, b) => b.convictionScore - a.convictionScore)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));

    this.setCache('top-picks', sortedPicks, this.getCacheTtl());
    return sortedPicks;
  }

  async getHighRiskHighRewardOpportunities(): Promise<HighRiskPick[]> {
    const cached = this.getCached<HighRiskPick[]>('high-risk-high-reward');
    if (cached) return cached;

    // Scan high beta growth leaders across Defense, Rail, Tech, PSU & High-Growth
    const candidates = [
      'SUZLON.NS', 'RVNL.NS', 'MAZDOCK.NS', 'IREDA.NS', 'KAYNES.NS',
      'DIXON.NS', 'COCHINSHIP.NS', 'DATAPATTNS.NS', 'PERSISTENT.NS', 'TRENT.NS',
      'BSE.NS', 'HAL.NS', 'CDSL.NS', 'BEL.NS', 'POLICYBZR.NS'
    ];

    const quotes = await this.marketProvider.getQuotes(candidates);
    
    // Map with rich risk-reward metrics & news sentiment adjusted alpha score
    const computedPicks = await Promise.all(
      quotes.map(async (q) => {
        const meta = this.marketProvider.getUniverse().find((u) => u.ticker === q.ticker);
        let newsData: { sentimentScore: number; sentimentLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string; newsCount: number } = { sentimentScore: 0, sentimentLabel: 'NEUTRAL', topHeadline: undefined, newsCount: 0 };
        try {
          newsData = await this.newsService.getSentimentScoreForStock(q.ticker, meta?.sector || undefined, meta?.name || q.name);
        } catch { /* gracefully degrade to neutral */ }

        const estimatedBeta = parseFloat((1.65 + Math.abs(q.changePercent) * 0.12).toFixed(2));
        const targetPercent = parseFloat((14.0 + Math.max(0, q.changePercent * 2) + (newsData.sentimentScore > 0 ? 2 : 0)).toFixed(1));
        const rewardRiskRatio = parseFloat((3.2 + (q.changePercent >= 0 ? 0.4 : 0) + (newsData.sentimentScore > 0 ? 0.2 : 0)).toFixed(1));
        const stopLossPercent = parseFloat((targetPercent / rewardRiskRatio).toFixed(1));

        // Alpha Conviction Score: prioritize strong upside + favorable R:R + positive momentum + news sentiment
        const alphaScore =
          (rewardRiskRatio * 20) +
          (targetPercent * 2) +
          (q.changePercent > 0 ? 15 : 0) +
          (q.changePercent * 3) +
          (newsData.sentimentScore * 1.5);

        let catalystText = `High momentum velocity with ${estimatedBeta}x beta and asymmetric 1:${rewardRiskRatio} R:R upside potential.`;
        if (newsData.topHeadline) {
          catalystText += ` Supported by live headline: "${newsData.topHeadline}".`;
        }

        return {
          ticker: q.ticker,
          name: q.name,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          beta: estimatedBeta,
          rewardRiskRatio,
          targetPrice: Money.round(q.price * (1 + targetPercent / 100)),
          stopLossPrice: Money.round(q.price * (1 - stopLossPercent / 100)),
          targetPercent,
          stopLossPercent,
          alphaScore,
          newsSentiment: newsData.sentimentLabel,
          topHeadline: newsData.topHeadline,
          catalyst: catalystText,
        };
      })
    );

    // Sort strictly in descending order so the one most likely to buy appears on top
    const ranked = computedPicks
      .sort((a, b) => b.alphaScore - a.alphaScore)
      .slice(0, 5)
      .map((pick, idx) => ({
        ...pick,
        rank: idx + 1,
        volatilityRank: idx === 0 ? 'Top Alpha Buy (#1)' : idx === 1 ? 'High Alpha (#2)' : `Momentum Setup (#${idx + 1})`,
      }));

    this.setCache('high-risk-high-reward', ranked, this.getCacheTtl());
    return ranked;
  }

  /**
   * "Why is this Stock Moving Today?" Contextual Multi-Factor Catalyst Synthesis Engine
   */
  async getMovementCatalyst(ticker: string): Promise<MovementCatalyst> {
    const quote = await this.getQuote(ticker);
    const candles = await this.getChartData(ticker, '3mo');
    const universe = this.marketProvider.getUniverse();
    const meta = universe.find((s) => s.ticker === ticker);

    const change = quote.changePercent;
    const direction: 'UP' | 'DOWN' | 'FLAT' = change > 0.2 ? 'UP' : change < -0.2 ? 'DOWN' : 'FLAT';
    const isGain = change >= 0;

    const companyName = meta?.name || quote.name || ticker.replace('.NS', '');
    const cleanTicker = ticker.replace('.NS', '');
    const sector = meta?.sector || 'Core Equities';
    const industry = meta?.industry || 'Equities';
    const tier = meta?.marketCapTier || 'LARGE_CAP';

    // Live news sentiment for this stock
    let newsData: { sentimentScore: number; sentimentLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; topHeadline?: string; newsCount: number } = { sentimentScore: 0, sentimentLabel: 'NEUTRAL', topHeadline: undefined, newsCount: 0 };
    try {
      newsData = await this.newsService.getSentimentScoreForStock(ticker, sector, companyName);
    } catch { /* gracefully degrade to neutral */ }

    // 1. Calculate historical volume baseline & surge ratio
    const closes = candles.map((c) => c.close);
    let avgVolume = quote.volume || 1;
    if (candles.length >= 5) {
      const totalVol = candles.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0);
      avgVolume = Math.max(1, totalVol / Math.min(20, candles.length));
    }
    const volumeSurgeRatio = parseFloat(((quote.volume || avgVolume) / avgVolume).toFixed(2));

    // 2. Compute dynamic technical indicators
    let rsiVal = 52.0;
    try {
      if (closes.length >= 15) {
        const rsiArr = RSI.calculate({ values: closes, period: 14 });
        if (rsiArr.length > 0) rsiVal = parseFloat(rsiArr[rsiArr.length - 1].toFixed(1));
      }
    } catch {}

    let sma50Val = quote.price;
    try {
      if (closes.length >= 25) {
        const arr = SMA.calculate({ values: closes, period: Math.min(50, closes.length) });
        if (arr.length > 0) sma50Val = parseFloat(arr[arr.length - 1].toFixed(2));
      }
    } catch {}

    const isAboveSma50 = quote.price >= sma50Val;

    // 3. Evaluate Day Range & 52-Week Range Dynamics
    const dayRange = Math.max(0.1, (quote.dayHigh || quote.price) - (quote.dayLow || quote.price));
    const rangePosition = Math.min(1, Math.max(0, (quote.price - (quote.dayLow || quote.price)) / dayRange));
    
    let proximity52w = '';
    if (quote.weekHigh52 && quote.price >= quote.weekHigh52 * 0.95) {
      proximity52w = `trading within ${(100 - (quote.price / quote.weekHigh52) * 100).toFixed(1)}% of its 52-week high (₹${quote.weekHigh52.toFixed(2)})`;
    } else if (quote.weekLow52 && quote.price <= quote.weekLow52 * 1.08) {
      proximity52w = `testing support within ${(((quote.price - quote.weekLow52) / quote.weekLow52) * 100).toFixed(1)}% of its 52-week low (₹${quote.weekLow52.toFixed(2)})`;
    }

    // 4. Sector-Specific Thematic Driver Library
    const sectorThemes: Record<string, string> = {
      'Railway Infrastructure': 'railway modernization, capex order book visibility, and freight corridor execution',
      'Renewable Energy': 'capacity commissioning milestones, renewable tenders, and green energy capex',
      'Defense & Aerospace': 'defense indigenization mandates (Aatmanirbhar Bharat), export orders, and fleet modernization',
      'Private Banking': 'credit growth demand, Net Interest Margin (NIM) stability, and retail loan expansion',
      'Public Banking': 'asset quality improvement, corporate credit cycles, and attractive dividend yield support',
      'Information Technology': 'BFSI client discretionary spend, digital transformation deal wins, and US tech budget cycles',
      'Automobiles': 'monthly wholesale dispatch momentum, EV transition pipeline, and premiumization demand',
      'Metals & Mining': 'global commodity price trends, domestic infrastructure steel demand, and input cost trends',
      'Pharmaceuticals': 'US generic pricing stabilization, domestic formulation growth, and CDMO pipeline traction',
      'FMCG': 'rural demand resilience, raw material margin expansion, and urban premium portfolio volume growth',
      'Real Estate': 'pre-sales booking velocity, inventory absorption, and new residential project launch pipeline',
      'Energy & Power': 'power peak demand surges, thermal PLF improvement, and transmission capacity additions',
      'Oil, Gas & Consumable Fuels': 'Gross Refining Margins (GRM), benchmark crude price fluctuations, and marketing margins',
      'Chemicals': 'specialty chemical export demand, destocking cycle recovery, and import substitution',
      'Capital Goods': 'private capex cycle acceleration, infrastructure order inflows, and high operating leverage',
    };

    const thematicFocus =
      sectorThemes[industry] ||
      sectorThemes[sector] ||
      `${sector.toLowerCase()} sector demand trends and macroeconomic liquidity`;

    // 5. Dynamic Catalyst Type & Narrative Construction
    let catalystType: MovementCatalyst['catalystType'] = 'TECHNICAL_BREAKOUT';
    let primaryDriver = '';
    const keyFactors: string[] = [];

    // Inject live news headline as top key factor if present
    if (newsData.topHeadline) {
      keyFactors.push(`Live News Catalyst (${newsData.sentimentLabel}): "${newsData.topHeadline}"`);
    }

    if (volumeSurgeRatio >= 1.6 && Math.abs(change) >= 1.5) {
      catalystType = 'VOLUME_SPIKE';
      primaryDriver = `${companyName} (${cleanTicker}) is experiencing elevated institutional participation with volume surging ${volumeSurgeRatio}x its 20-day average. The stock is ${isGain ? 'surging' : 'pulling back'} ${Math.abs(change).toFixed(2)}% as active block orders drive price discovery in the ${industry} space.`;
      keyFactors.push(`Unusual volume expansion of ${volumeSurgeRatio}x relative to the 20-day baseline.`);
      keyFactors.push(`Trading ${isAboveSma50 ? 'comfortably above' : 'below'} the 50-day moving average (₹${sma50Val.toFixed(2)}).`);
      keyFactors.push(`Sector tailwinds: Driven by ${thematicFocus}.`);
      keyFactors.push(`Intraday price action closed at ${(rangePosition * 100).toFixed(0)}% of today's session range (₹${quote.dayLow?.toFixed(2)} - ₹${quote.dayHigh?.toFixed(2)}).`);
    } else if (change >= 2.0) {
      catalystType = 'MOMENTUM_BREAKOUT';
      primaryDriver = `${companyName} is leading ${sector} momentum today with a strong gain of +${change.toFixed(2)}% at ₹${quote.price.toFixed(2)}. Bullish momentum is reinforced by RSI at ${rsiVal} and positive market breadth across ${industry} peers.`;
      keyFactors.push(`Bullish price momentum with RSI at ${rsiVal} (${rsiVal > 70 ? 'Overbought strength' : 'Healthy expansion'}).`);
      keyFactors.push(proximity52w ? `High-level testing: Currently ${proximity52w}.` : `Sustaining firm support above 50-day SMA of ₹${sma50Val.toFixed(2)}.`);
      keyFactors.push(`Industry catalysts: Benefiting from ${thematicFocus}.`);
      keyFactors.push(`Volume participation: Trading at ${volumeSurgeRatio}x average turnover.`);
    } else if (change <= -2.0) {
      catalystType = 'PROFIT_BOOKING';
      primaryDriver = `${companyName} is witnessing intraday profit-booking of ${change.toFixed(2)}% down to ₹${quote.price.toFixed(2)} as short-term traders lock in gains following recent extensions in the ${sector} sector.`;
      keyFactors.push(`Mean-reversion pull-back cooling technical indicators (RSI currently at ${rsiVal}).`);
      keyFactors.push(`Key support watch: 50-day moving average sits at ₹${sma50Val.toFixed(2)}.`);
      keyFactors.push(`Sector sentiment: Temporary consolidation across ${industry} peers.`);
      keyFactors.push(`Order flow: Volume ratio at ${volumeSurgeRatio}x indicates measured institutional repositioning.`);
    } else if (isAboveSma50 && isGain) {
      catalystType = 'TECHNICAL_BREAKOUT';
      primaryDriver = `${companyName} is demonstrating constructive consolidation with a positive bias (+${change.toFixed(2)}% at ₹${quote.price.toFixed(2)}). The stock maintains its structural uptrend above the 50-day moving average (₹${sma50Val.toFixed(2)}), supported by healthy order flow in ${industry}.`;
      keyFactors.push(`Structural trend: Holding firmly above 50-day SMA (₹${sma50Val.toFixed(2)}).`);
      keyFactors.push(`Momentum stance: RSI is balanced at ${rsiVal}, offering favorable risk-reward.`);
      keyFactors.push(`Thematic driver: Core fundamentals anchored by ${thematicFocus}.`);
      keyFactors.push(proximity52w ? `Price positioning: ${proximity52w}.` : `Session breadth: Trading at ${(rangePosition * 100).toFixed(0)}% of the daily high-low range.`);
    } else if (!isAboveSma50 && !isGain) {
      catalystType = 'SECTOR_RALLY';
      primaryDriver = `${companyName} is consolidating in a defensive range (${change.toFixed(2)}% at ₹${quote.price.toFixed(2)}), with price action respecting lower trend support near ₹${sma50Val.toFixed(2)} as ${sector} participants await fresh sector catalysts.`;
      keyFactors.push(`Support testing: 50-day moving average baseline at ₹${sma50Val.toFixed(2)}.`);
      keyFactors.push(`RSI momentum: Currently at ${rsiVal} showing stabilization in accumulation territory.`);
      keyFactors.push(`Macro landscape: Ongoing developments in ${thematicFocus}.`);
      keyFactors.push(`Liquidity: Controlled volume surge ratio of ${volumeSurgeRatio}x.`);
    } else {
      catalystType = 'TECHNICAL_BREAKOUT';
      primaryDriver = `${companyName} is trading in an orderly ${tier.replace('_', '-').toLowerCase()} consolidation range (${isGain ? '+' : ''}${change.toFixed(2)}% at ₹${quote.price.toFixed(2)}), absorbing liquidity near key moving averages amidst sector rotation in ${sector}.`;
      keyFactors.push(`Trend baseline: 50-day SMA at ₹${sma50Val.toFixed(2)} providing dynamic pivot.`);
      keyFactors.push(`RSI indicator: Steady at ${rsiVal} signaling controlled momentum.`);
      keyFactors.push(`Thematic context: Influenced by ${thematicFocus}.`);
      keyFactors.push(`Session range: Intraday bounds established between ₹${quote.dayLow?.toFixed(2)} and ₹${quote.dayHigh?.toFixed(2)}.`);
    }

    const invalidationLevel =
      direction === 'UP'
        ? Money.round(Math.min(quote.price * 0.96, sma50Val * 0.98))
        : Money.round(Math.max(quote.price * 1.04, sma50Val * 1.02));

    const finalConfidence = Math.min(
      98,
      Math.max(68, Math.round(78 + Math.abs(change) * 3 + (volumeSurgeRatio > 1.2 ? 5 : 0) + newsData.sentimentScore))
    );

    return {
      ticker,
      name: companyName,
      price: quote.price,
      changePercent: quote.changePercent,
      direction,
      volumeSurgeRatio,
      primaryDriver,
      catalystType,
      confidenceScore: finalConfidence,
      keyFactors,
      invalidationLevel,
      newsSentiment: newsData.sentimentLabel,
      topHeadline: newsData.topHeadline,
    };
  }

  /**
   * Generates comprehensive Stock Profile with live technical indicators and catalyst explanation
   */
  async getStockProfile(ticker: string): Promise<StockProfileData> {
    const quote = await this.getQuote(ticker);
    const chart = await this.getChartData(ticker, '6mo');
    const catalyst = await this.getMovementCatalyst(ticker);

    const closes = chart.map((c) => c.close);

    // Compute RSI 14
    let rsiVal = 52.4;
    try {
      if (closes.length >= 15) {
        const rsiArr = RSI.calculate({ values: closes, period: 14 });
        if (rsiArr.length > 0) rsiVal = parseFloat(rsiArr[rsiArr.length - 1].toFixed(2));
      }
    } catch {}

    const rsiStance =
      rsiVal > 70
        ? 'Overbought (Extended Momentum)'
        : rsiVal < 30
        ? 'Oversold (Mean Reversion Zone)'
        : 'Neutral Momentum Zone';

    // Compute MACD (12, 26, 9)
    let macdVal = { macd: 0, signal: 0, histogram: 0, trend: 'Bullish' };
    try {
      if (closes.length >= 35) {
        const macdArr = MACD.calculate({
          values: closes,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          SimpleMAOscillator: false,
          SimpleMASignal: false,
        });
        if (macdArr.length > 0) {
          const last = macdArr[macdArr.length - 1];
          macdVal = {
            macd: parseFloat((last.MACD || 0).toFixed(2)),
            signal: parseFloat((last.signal || 0).toFixed(2)),
            histogram: parseFloat((last.histogram || 0).toFixed(2)),
            trend: (last.histogram || 0) >= 0 ? 'Bullish Crossover' : 'Bearish Crossover',
          };
        }
      }
    } catch {}

    // Compute SMA 50 & SMA 200
    let sma50Val = quote.price;
    let sma200Val = quote.price;
    try {
      if (closes.length >= 50) {
        const arr = SMA.calculate({ values: closes, period: 50 });
        if (arr.length > 0) sma50Val = parseFloat(arr[arr.length - 1].toFixed(2));
      }
      if (closes.length >= 150) {
        const arr = SMA.calculate({ values: closes, period: Math.min(200, closes.length) });
        if (arr.length > 0) sma200Val = parseFloat(arr[arr.length - 1].toFixed(2));
      }
    } catch {}

    // Compute Bollinger Bands (20, 2)
    let bbVal = { upper: quote.price * 1.05, middle: quote.price, lower: quote.price * 0.95 };
    try {
      if (closes.length >= 20) {
        const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
        if (bbArr.length > 0) {
          const last = bbArr[bbArr.length - 1];
          bbVal = {
            upper: parseFloat(last.upper.toFixed(2)),
            middle: parseFloat(last.middle.toFixed(2)),
            lower: parseFloat(last.lower.toFixed(2)),
          };
        }
      }
    } catch {}

    const stockMeta =
      this.marketProvider.getUniverse().find((u) => u.ticker === ticker) || {
        ticker,
        name: quote.name,
        exchange: 'NSE',
        sector: 'Equities',
      };

    return {
      stock: stockMeta,
      quote,
      chart,
      technicals: {
        rsi: rsiVal,
        rsiStance,
        macd: macdVal,
        sma50: sma50Val,
        sma200: sma200Val,
        goldenCross: sma50Val >= sma200Val,
        bollinger: bbVal,
      },
      catalyst,
    };
  }
}

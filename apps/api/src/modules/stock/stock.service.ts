import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from './providers/yahoo-market-data.provider';
import { NewsService } from '../news/news.service';
import { QuantPredictionService } from '../prediction/prediction.service';
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
    private readonly newsService: NewsService,
    @Inject(forwardRef(() => QuantPredictionService))
    private readonly predictionService: QuantPredictionService
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
    return status.status === 'OPEN' ? 5_000 : 30_000; // 5s during market, 30s otherwise
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
    this.setCache(cacheKey, candles, range === '1d' ? 5_000 : 60_000);
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
    const scanUniverse = this.marketProvider.getUniverse().slice(0, 35);
    const quotes = await this.getQuotes(scanUniverse.map((s) => s.ticker));

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

    const rankedPredictions = await this.predictionService.getUniversePredictions();
    const candidates = rankedPredictions
      .filter((p) => p.decision === 'STRONG_BUY' || p.decision === 'BUY' || p.decision === 'ACCUMULATE')
      .slice(0, 10);

    const activeList = candidates.length > 0 ? candidates : rankedPredictions.slice(0, 10);

    const picks: TopPick[] = activeList.map((p, idx) => {
      const newsEvidence = p.evidence.find((e) => e.type === 'NEWS');
      const newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = newsEvidence?.description.includes('BEARISH')
        ? 'BEARISH'
        : newsEvidence?.description.includes('BULLISH')
        ? 'BULLISH'
        : 'NEUTRAL';
      const topHeadline = newsEvidence?.description.replace(/^\[.*?\]\s*/, '').replace(/\s*\(Sentiment score:.*?\)/, '');

      const confidenceScore = Math.round(p.prediction['20d'].calibratedProbability * 100);
      const convictionScore = Math.round(
        (p.decision === 'STRONG_BUY' ? 100 : p.decision === 'BUY' ? 80 : p.decision === 'ACCUMULATE' ? 60 : 40) +
        confidenceScore +
        p.risk.rewardRiskRatio * 10
      );

      let reasoning = `Quant Model ${p.modelVersion} forecast: ${(p.prediction['20d'].calibratedProbability * 100).toFixed(0)}% 20-day directional probability with 1:${p.risk.rewardRiskRatio} R:R.`;
      if (topHeadline) {
        reasoning = `Live catalyst (${newsSentiment}): "${topHeadline}". Conviction: ${p.decision}.`;
      }

      const quotePrice = p.stock.price || 0;
      const quoteChange = p.stock.change || 0;
      const quoteChangePercent = p.stock.changePercent || 0;

      return {
        ticker: p.stock.ticker,
        name: p.stock.name,
        sector: p.stock.sector,
        price: quotePrice,
        change: quoteChange,
        changePercent: quoteChangePercent,
        recommendation: p.decision,
        confidenceScore,
        convictionScore,
        newsSentiment,
        newsImpactScore: Math.round((p.prediction['20d'].calibratedProbability - 0.5) * 40),
        topHeadline,
        reasoning,
        target: p.risk.targetPrice,
        stopLoss: p.risk.stopLossPrice,
        rewardRiskRatio: p.risk.rewardRiskRatio,
        rank: p.ranking?.rank || idx + 1,
      };
    });

    const sortedPicks = picks.sort((a, b) => b.convictionScore - a.convictionScore);
    this.setCache('top-picks', sortedPicks, this.getCacheTtl());
    return sortedPicks;
  }

  async getHighRiskHighRewardOpportunities(): Promise<HighRiskPick[]> {
    const cached = this.getCached<HighRiskPick[]>('high-risk-high-reward');
    if (cached) return cached;

    const highRiskPredictions = await this.predictionService.getHighRiskOpportunities();
    const ranked: HighRiskPick[] = highRiskPredictions.map((p, idx) => {
      const newsEvidence = p.evidence.find((e) => e.type === 'NEWS');
      const newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = newsEvidence?.description.includes('BEARISH')
        ? 'BEARISH'
        : newsEvidence?.description.includes('BULLISH')
        ? 'BULLISH'
        : 'NEUTRAL';
      const topHeadline = newsEvidence?.description.replace(/^\[.*?\]\s*/, '').replace(/\s*\(Sentiment score:.*?\)/, '');

      const estimatedBeta = parseFloat((1.35 + p.risk.volatility * 25).toFixed(2));
      const targetPercent = parseFloat((((p.risk.targetPrice - (p.stock.price || 1)) / (p.stock.price || 1)) * 100).toFixed(1));
      const stopLossPercent = parseFloat(((((p.stock.price || 1) - p.risk.stopLossPrice) / (p.stock.price || 1)) * 100).toFixed(1));

      const alphaScore = Math.round(
        p.prediction['20d'].calibratedProbability * 100 +
        p.risk.rewardRiskRatio * 20 +
        p.risk.volatility * 500
      );

      let catalystText = `High beta (${estimatedBeta}x) momentum setup with 1:${p.risk.rewardRiskRatio} R:R and ${p.decision} signal.`;
      if (topHeadline) {
        catalystText += ` Catalyst: "${topHeadline}".`;
      }

      return {
        ticker: p.stock.ticker,
        name: p.stock.name,
        price: p.stock.price || 0,
        change: p.stock.change || 0,
        changePercent: p.stock.changePercent || 0,
        beta: estimatedBeta,
        rewardRiskRatio: p.risk.rewardRiskRatio,
        targetPrice: p.risk.targetPrice,
        stopLossPrice: p.risk.stopLossPrice,
        targetPercent,
        stopLossPercent,
        alphaScore,
        newsSentiment,
        topHeadline,
        catalyst: catalystText,
        rank: idx + 1,
        volatilityRank: idx === 0 ? 'Top Alpha Buy (#1)' : idx === 1 ? 'High Alpha (#2)' : `Momentum Setup (#${idx + 1})`,
      };
    });

    this.setCache('high-risk-high-reward', ranked, this.getCacheTtl());
    return ranked;
  }

  /**
   * "Why is this Stock Moving Today?" Contextual Multi-Factor Catalyst Synthesis Engine
   */
  async getMovementCatalyst(ticker: string): Promise<MovementCatalyst> {
    const pred = await this.predictionService.getPrediction(ticker);
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

    const newsEvidence = pred.evidence.find((e) => e.type === 'NEWS');
    const topHeadline = newsEvidence ? newsEvidence.description.replace(/^\[.*?\]\s*/, '').replace(/\s*\(Sentiment score:.*?\)/, '') : undefined;
    const newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = newsEvidence?.description.includes('BEARISH')
      ? 'BEARISH'
      : newsEvidence?.description.includes('BULLISH')
      ? 'BULLISH'
      : 'NEUTRAL';

    let avgVolume = quote.volume || 1;
    if (candles.length >= 5) {
      const totalVol = candles.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0);
      avgVolume = Math.max(1, totalVol / Math.min(20, candles.length));
    }
    const volumeSurgeRatio = parseFloat(((quote.volume || avgVolume) / avgVolume).toFixed(2));

    let catalystType: MovementCatalyst['catalystType'] = 'TECHNICAL_BREAKOUT';
    if (volumeSurgeRatio >= 1.6 && Math.abs(change) >= 1.5) {
      catalystType = 'VOLUME_SPIKE';
    } else if (change >= 2.0) {
      catalystType = 'MOMENTUM_BREAKOUT';
    } else if (change <= -2.0) {
      catalystType = 'PROFIT_BOOKING';
    } else if (isGain) {
      catalystType = 'TECHNICAL_BREAKOUT';
    } else {
      catalystType = 'RANGE_ACCUMULATION';
    }

    const primaryDriver = pred.evidence.map((e) => e.description).join('. ') +
      ` Model stance: ${pred.decision} (20d probability ${(pred.prediction['20d'].calibratedProbability * 100).toFixed(0)}%).`;

    const keyFactors = [
      ...pred.evidence.map((e) => e.description),
      ...pred.invalidationConditions.slice(0, 2),
    ];

    return {
      ticker,
      name: companyName,
      price: quote.price,
      changePercent: quote.changePercent,
      direction,
      volumeSurgeRatio,
      primaryDriver,
      catalystType,
      confidenceScore: Math.max(60, Math.round(Math.max(pred.prediction['20d'].calibratedProbability, 1 - pred.prediction['20d'].calibratedProbability, 0.65) * 100)),
      keyFactors,
      invalidationLevel: pred.risk.stopLossPrice,
      newsSentiment,
      topHeadline,
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

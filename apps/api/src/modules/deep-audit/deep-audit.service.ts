import { Injectable, Inject, forwardRef, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';
import { NewsService } from '../news/news.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';
import { PatternDetectionEngine } from './engines/pattern-detection.engine';
import { BuySellPatternEngine } from './engines/buy-sell-pattern.engine';
import { DeepAuditReport, ResolvedTickerInfo, HistoryAudit, NewsAnalysis, QuantPrediction, PatternAnalysis, BuySellAnalysis, AuditVerdict } from './deep-audit.types';
import { OHLCVCandle as Candle } from '../stock/providers/market-data.provider.interface';

@Injectable()
export class DeepAuditService {
  private readonly logger = new Logger(DeepAuditService.name);
  private cache = new Map<string, { data: DeepAuditReport; expiresAt: number }>();

  constructor(
    @Inject(forwardRef(() => StockService)) private readonly stockService: StockService,
    @Inject(forwardRef(() => QuantPredictionService)) private readonly predictionService: QuantPredictionService,
    private readonly aiService: AiService,
    private readonly newsService: NewsService,
    private readonly marketProvider: YahooMarketDataProvider,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (value.expiresAt < now) {
          this.cache.delete(key);
        }
      }
    }, 120_000);
  }

  async searchStocks(query: string): Promise<ResolvedTickerInfo[]> {
    return this.marketProvider.searchUniversalStocks(query) as unknown as Promise<ResolvedTickerInfo[]>;
  }

  async audit(ticker: string): Promise<DeepAuditReport> {
    const rawKey = ticker.trim().toUpperCase();
    const aliasTarget = (this.marketProvider as any).TICKER_ALIASES?.[rawKey] || rawKey;
    const tickerNs = aliasTarget.endsWith('.NS') || aliasTarget.endsWith('.BO') ? aliasTarget : `${aliasTarget}.NS`;

    const cached = this.cache.get(tickerNs) || this.cache.get(rawKey) || this.cache.get(aliasTarget);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const resolvedInfo = await this.marketProvider.resolveAnyTicker(ticker);
    if (!resolvedInfo) {
      throw new NotFoundException(`Ticker ${ticker} not found`);
    }

    // Check cache by resolved ticker as well
    const cachedByResolved = this.cache.get(resolvedInfo.ticker.toUpperCase());
    if (cachedByResolved && cachedByResolved.expiresAt > Date.now()) {
      return cachedByResolved.data;
    }

    // Fetch 2 years of daily candles (~500 trading days) - fast, lightweight, and complete
    let candles = await this.marketProvider.getExtendedHistoricalCandles(resolvedInfo.ticker, 2);
    if (!candles || candles.length < 20) {
      candles = await this.marketProvider.getHistoricalCandles(resolvedInfo.ticker, '1y');
    }
    if (!candles || candles.length < 20) {
      throw new BadRequestException(`Insufficient historical data for ${ticker} (minimum 20 trading days required)`);
    }

    // 1. Synchronous quantitative engines execute in <15ms
    const historyAudit = this.analyzeHistory(candles);
    const patterns = this.detectPatterns(candles);
    const buySellAnalysis = this.analyzeBuySellPatterns(candles);

    // 2. High-speed bounded quant prediction (skipped for non-universe, 1200ms timeout for universe)
    const quantPrediction = await this.getQuantPrediction(resolvedInfo.ticker, resolvedInfo.isInUniverse);

    const lastCandle = candles[candles.length - 1];

    // 3. High-speed unified AI synthesis (< 2s max timeout with zero-delay mathematical fallback)
    const { newsAnalysis, verdict } = await this.aiService.synthesizeDeepAuditUnified({
      ticker: resolvedInfo.ticker,
      companyName: resolvedInfo.name,
      sector: resolvedInfo.sector,
      currentPrice: lastCandle.close,
      historyAudit,
      patterns,
      buySellAnalysis,
      quantPrediction
    });

    const report: DeepAuditReport = {
      ticker: resolvedInfo.ticker,
      resolvedInfo,
      auditTimestamp: new Date().toISOString(),
      historyAudit,
      patterns,
      buySellAnalysis,
      newsAnalysis,
      quantPrediction,
      verdict
    };

    // Cache report for 30 minutes across all ticker representations
    const expiresAt = Date.now() + 1800_000;
    this.cache.set(tickerNs, { data: report, expiresAt });
    this.cache.set(rawKey, { data: report, expiresAt });
    this.cache.set(aliasTarget, { data: report, expiresAt });
    this.cache.set(resolvedInfo.ticker.toUpperCase(), { data: report, expiresAt });

    return report;
  }

  private analyzeHistory(candles: Candle[]): HistoryAudit {
    const totalTradingDays = candles.length;
    const dataYears = totalTradingDays / 252;
    
    const getIsoDate = (c: Candle): string => {
      try {
        const t = c.time;
        const d = typeof t === 'number' ? new Date(t > 1e11 ? t : t * 1000) : new Date(t);
        return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } catch {
        return new Date().toISOString();
      }
    };

    const firstClose = candles[0].close;
    const lastClose = candles[candles.length - 1].close;
    
    const dailyReturns: number[] = [];
    let maxDrawdown = 0;
    let maxDrawdownDate = '';
    let runningMax = candles[0].high;
    let allTimeHigh = { price: candles[0].high, date: getIsoDate(candles[0]) };
    let allTimeLow = { price: candles[0].low, date: getIsoDate(candles[0]) };
    
    for (let i = 1; i < candles.length; i++) {
      const ret = candles[i].close / candles[i - 1].close - 1;
      dailyReturns.push(ret);
      
      if (candles[i].high > runningMax) {
        runningMax = candles[i].high;
      }
      const drawdown = (runningMax - candles[i].low) / runningMax;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDate = getIsoDate(candles[i]);
      }
      
      if (candles[i].close > allTimeHigh.price) {
        allTimeHigh = { price: candles[i].close, date: getIsoDate(candles[i]) };
      }
      if (candles[i].close < allTimeLow.price) {
        allTimeLow = { price: candles[i].close, date: getIsoDate(candles[i]) };
      }
    }
    
    const totalReturn = firstClose > 0 ? (lastClose / firstClose) - 1 : 0;
    let cagr = 0;
    if (dataYears >= 0.5 && firstClose > 0 && lastClose > 0) {
      cagr = Math.pow(lastClose / firstClose, 1 / dataYears) - 1;
    } else if (dataYears > 0 && firstClose > 0) {
      cagr = totalReturn * (1 / dataYears);
    }
    if (isNaN(cagr) || !isFinite(cagr)) cagr = 0;
    
    const meanReturn = dailyReturns.length > 0 ? dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length : 0;
    const variance = dailyReturns.length > 1 ? dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1) : 0;
    const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(252);
    
    const rawSharpe = annualizedVolatility > 0 && isFinite(annualizedVolatility) ? (cagr - 0.065) / annualizedVolatility : 0;
    const sharpeRatio = isNaN(rawSharpe) || !isFinite(rawSharpe) ? 0 : Math.max(-5, Math.min(5, rawSharpe));
    
    const last252 = candles.slice(-252);
    const current52wHigh = Math.max(...last252.map(c => c.high));
    const current52wLow = Math.min(...last252.map(c => c.low));
    
    const monthlyReturnsMap = new Map<string, { first: number, last: number }>();
    for (const c of candles) {
      const dStr = getIsoDate(c);
      const month = dStr.substring(0, 7);
      if (!monthlyReturnsMap.has(month)) {
        monthlyReturnsMap.set(month, { first: c.close, last: c.close });
      } else {
        monthlyReturnsMap.get(month)!.last = c.close;
      }
    }
    const monthlyReturns = Array.from(monthlyReturnsMap.entries())
      .slice(-12)
      .map(([month, data]) => ({ month, return: (data.last / data.first) - 1 }));

    const yearlyReturnsMap = new Map<number, { first: number, last: number }>();
    for (const c of candles) {
      const dStr = getIsoDate(c);
      const year = parseInt(dStr.substring(0, 4), 10);
      if (!yearlyReturnsMap.has(year)) {
        yearlyReturnsMap.set(year, { first: c.close, last: c.close });
      } else {
        yearlyReturnsMap.get(year)!.last = c.close;
      }
    }
    const yearlyReturns = Array.from(yearlyReturnsMap.entries()).map(([year, data]) => ({
      year,
      return: (data.last / data.first) - 1
    }));

    return {
      dataYears,
      totalTradingDays,
      cagr,
      totalReturn,
      maxDrawdown,
      maxDrawdownDate,
      allTimeHigh,
      allTimeLow,
      current52wHigh,
      current52wLow,
      annualizedVolatility,
      sharpeRatio,
      monthlyReturns,
      yearlyReturns
    };
  }

  private detectPatterns(candles: Candle[]): PatternAnalysis {
    const engine = new PatternDetectionEngine();
    return engine.analyze(candles) as any;
  }
  
  private analyzeBuySellPatterns(candles: Candle[]): BuySellAnalysis {
    const engine = new BuySellPatternEngine();
    return engine.analyze(candles) as any;
  }

  private async analyzeNews(info: ResolvedTickerInfo): Promise<NewsAnalysis> {
    try {
      return (await this.aiService.analyzeStockNews(info.ticker, info.name, info.sector)) as NewsAnalysis;
    } catch (e) {
      this.logger.error(`Failed to analyze news via AI for ${info.ticker}`, e);
      return {
        overallSentiment: 'NEUTRAL',
        sentimentScore: 0,
        stockNews: [],
        sectorNews: [],
        sectorOutlook: '',
        keyRisks: [],
        keyCatalysts: []
      };
    }
  }

  private async getQuantPrediction(ticker: string, isInUniverse: boolean = true): Promise<QuantPrediction | null> {
    if (!isInUniverse) {
      return {
        available: false,
        horizons: {},
        decision: 'NO_TRADE',
        signalQuality: 'LOW',
        risk: { stopLoss: 0, targetPrice: 0, rewardRiskRatio: 0 }
      };
    }

    try {
      const pred = await Promise.race([
        this.predictionService.getPrediction(ticker),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200))
      ]);
      if (!pred) {
        return {
          available: false,
          horizons: {},
          decision: 'NO_TRADE',
          signalQuality: 'LOW',
          risk: { stopLoss: 0, targetPrice: 0, rewardRiskRatio: 0 }
        };
      }
      
      if (pred.decision === 'NO_TRADE' && (pred as any).dataQuality === 'LOW') {
        return {
          available: false,
          horizons: {},
          decision: pred.decision,
          signalQuality: (pred as any).dataQuality || 'LOW',
          risk: { stopLoss: 0, targetPrice: 0, rewardRiskRatio: 0 }
        };
      }
      
      return {
        available: true,
        horizons: (pred as any).horizons || {},
        decision: pred.decision,
        signalQuality: (pred as any).dataQuality || 'MEDIUM',
        risk: (pred as any).risk || { stopLoss: 0, targetPrice: 0, rewardRiskRatio: 0 }
      };
    } catch (e) {
      this.logger.error(`Failed to get quant prediction for ${ticker}`, e);
      return null;
    }
  }
}

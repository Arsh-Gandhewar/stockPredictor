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
    const cacheKey = ticker.trim().toUpperCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const resolvedInfo = await this.marketProvider.resolveAnyTicker(ticker);
    if (!resolvedInfo) {
      throw new NotFoundException(`Ticker ${ticker} not found`);
    }

    let candles = await this.marketProvider.getExtendedHistoricalCandles(resolvedInfo.ticker, 5);
    if (!candles || candles.length < 20) {
      candles = await this.marketProvider.getHistoricalCandles(resolvedInfo.ticker, '1y');
    }
    if (!candles || candles.length < 20) {
      throw new BadRequestException(`Insufficient historical data for ${ticker} (minimum 20 trading days required)`);
    }

    const [
      historyAuditResult,
      patternAnalysisResult,
      buySellAnalysisResult,
      newsAnalysisResult,
      quantPredictionResult
    ] = await Promise.allSettled([
      Promise.resolve(this.analyzeHistory(candles)),
      Promise.resolve(this.detectPatterns(candles)),
      Promise.resolve(this.analyzeBuySellPatterns(candles)),
      this.analyzeNews(resolvedInfo),
      this.getQuantPrediction(resolvedInfo.ticker)
    ]);

    const historyAudit = historyAuditResult.status === 'fulfilled' ? historyAuditResult.value : this.analyzeHistory(candles);
    const patterns = patternAnalysisResult.status === 'fulfilled' ? patternAnalysisResult.value : {
      trend: 'SIDEWAYS' as const,
      trendStrength: 50,
      supportLevels: [candles[candles.length - 1].close * 0.95],
      resistanceLevels: [candles[candles.length - 1].close * 1.05],
      candlestickPatterns: [],
      movingAverageAlignment: 'MIXED' as const,
      goldenCross: false,
      deathCross: false,
      rsiDivergence: 'NONE' as const
    };
    const buySellAnalysis = buySellAnalysisResult.status === 'fulfilled' ? buySellAnalysisResult.value : {
      obvValue: 0,
      adlValue: 0,
      vptValue: 0,
      volumeTrend: 'NEUTRAL' as const,
      volumeTrendStrength: 50,
      avgVolumeChange30d: 0,
      priceVolumeCorrelation: 0,
      deliveryPercentTrend: null,
      institutionalSignal: 'NEUTRAL' as const,
      smartMoneyIndicator: 0,
      recentLargeVolumeDays: []
    };
    const newsAnalysis = newsAnalysisResult.status === 'fulfilled' && newsAnalysisResult.value ? newsAnalysisResult.value : {
      overallSentiment: 'NEUTRAL' as const,
      sentimentScore: 0,
      stockNews: [],
      sectorNews: [],
      sectorOutlook: `${resolvedInfo.sector} sector operations remain steady.`,
      keyRisks: ['Market volatility', 'Macroeconomic conditions'],
      keyCatalysts: ['Earnings expansion', 'Domestic demand growth']
    };
    const quantPrediction = quantPredictionResult.status === 'fulfilled' ? quantPredictionResult.value : null;

    const lastCandle = candles[candles.length - 1];
    const verdict = (await this.aiService.synthesizeDeepAuditVerdict({
      ticker: resolvedInfo.ticker,
      companyName: resolvedInfo.name,
      sector: resolvedInfo.sector,
      currentPrice: lastCandle.close,
      historyAudit,
      patterns,
      buySellAnalysis,
      newsAnalysis,
      quantPrediction
    })) as AuditVerdict;

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

    // Cache report for 15 minutes
    this.cache.set(cacheKey, { data: report, expiresAt: Date.now() + 900_000 });
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

  private async getQuantPrediction(ticker: string): Promise<QuantPrediction | null> {
    try {
      const pred = await this.predictionService.getPrediction(ticker);
      if (!pred) return null;
      
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

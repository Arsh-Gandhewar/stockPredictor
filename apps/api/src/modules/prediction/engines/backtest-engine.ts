import { Injectable, Logger } from '@nestjs/common';
import { YahooMarketDataProvider } from '../../stock/providers/yahoo-market-data.provider';
import { FeatureEngine } from './feature-engine';
import { ModelInferenceEngine } from './model-inference';
import { CalibrationEngine } from './calibration-engine';
import { RiskEngine } from './risk-engine';
import { DecisionEngine } from './decision-engine';
import { OHLCVCandle, MarketQuote } from '../../stock/providers/market-data.provider.interface';

export interface BacktestTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  horizon: '1d' | '5d' | '20d';
  predictedProb: number;
  predictedDirection: 'UP' | 'DOWN';
  decision: string;
  stopLossPrice: number;
  targetPrice: number;
  actualReturn: number;
  directionCorrect: boolean;
  targetHit: boolean;
  stopLossHit: boolean;
}

export interface HorizonBacktestResult {
  horizon: '1d' | '5d' | '20d';
  totalTrades: number;
  winRate: number;
  avgGainPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  maxDrawdown: number;
  avgReturn: number;
  targetHitRate: number;
}

export interface BacktestResult {
  lastBacktestDate: string;
  datasetPeriod: string;
  stocksEvaluated: number;
  modelVersion: string;
  horizons: Record<'1d' | '5d' | '20d', HorizonBacktestResult>;
  overallWinRate: number;
  overallAvgReturn: number;
  overallRiskRewardRatio: number;
  annualizedReturn: number;
  totalTrades: number;
  nifty50AnnualReturn: number;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  static readonly BACKTEST_TICKERS = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ITC.NS', 'BHARTIARTL.NS',
    'TATAMOTORS.NS', 'SUNPHARMA.NS', 'LT.NS', 'TATASTEEL.NS', 'ADANIENT.NS',
    'TITAN.NS', 'BAJFINANCE.NS', 'COALINDIA.NS', 'DIXON.NS', 'BHEL.NS'
  ];

  constructor(
    private readonly featureEngine: FeatureEngine,
    private readonly inferenceEngine: ModelInferenceEngine,
    private readonly calibrationEngine: CalibrationEngine,
    private readonly riskEngine: RiskEngine,
    private readonly decisionEngine: DecisionEngine,
    private readonly marketProvider: YahooMarketDataProvider
  ) {}

  private roundTo1(num: number): number {
    return Math.round(num * 10) / 10;
  }

  async runFullBacktest(): Promise<BacktestResult> {
    this.logger.log('Starting full walk-forward backtest...');
    
    const results = await Promise.allSettled(
      BacktestEngine.BACKTEST_TICKERS.map(async (ticker, idx) => {
        this.logger.log(`Backtesting ${ticker}... (${idx + 1}/${BacktestEngine.BACKTEST_TICKERS.length})`);
        const candles = await this.marketProvider.getHistoricalCandles(ticker, '1y');
        if (candles.length < 71) {
          this.logger.warn(`Skipping ${ticker} - not enough historical data (${candles.length} < 71)`);
          return [];
        }
        return this.runSingleStockBacktest(ticker, candles);
      })
    );

    let allTrades: BacktestTrade[] = [];
    let stocksEvaluated = 0;

    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value.length > 0) {
        allTrades = allTrades.concat(res.value);
        stocksEvaluated++;
      } else if (res.status === 'rejected') {
        this.logger.warn(`Failed to backtest ${BacktestEngine.BACKTEST_TICKERS[idx]}: ${res.reason}`);
      }
    });

    const trades1d = allTrades.filter(t => t.horizon === '1d');
    const trades5d = allTrades.filter(t => t.horizon === '5d');
    const trades20d = allTrades.filter(t => t.horizon === '20d');

    const h1d = this.computeHorizonMetrics(trades1d, '1d');
    const h5d = this.computeHorizonMetrics(trades5d, '5d');
    const h20d = this.computeHorizonMetrics(trades20d, '20d');

    const overallWinRate = allTrades.length > 0 ? (allTrades.filter(t => t.directionCorrect).length / allTrades.length) * 100 : 0;
    const overallAvgReturn = allTrades.length > 0 ? (allTrades.reduce((sum, t) => sum + t.actualReturn, 0) / allTrades.length) * 100 : 0;
    
    let overallRiskRewardRatio = 0;
    const winningTrades = allTrades.filter(t => t.actualReturn > 0);
    const losingTrades = allTrades.filter(t => t.actualReturn <= 0);
    const avgWin = winningTrades.length > 0 ? (winningTrades.reduce((sum, t) => sum + t.actualReturn, 0) / winningTrades.length) : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.actualReturn, 0) / losingTrades.length) : 0;
    if (avgLoss > 0) {
      overallRiskRewardRatio = avgWin / avgLoss;
    }

    const annualizedReturn = this.computeAnnualizedReturn(trades5d);

    let nifty50AnnualReturn = 0;
    try {
      const niftyCandles = await this.marketProvider.getHistoricalCandles('^NSEI', '1y');
      if (niftyCandles.length > 0) {
        const firstClose = niftyCandles[0].close;
        const lastClose = niftyCandles[niftyCandles.length - 1].close;
        const totalReturn = (lastClose / firstClose) - 1;
        const tradingDays = niftyCandles.length;
        nifty50AnnualReturn = ((Math.pow(1 + totalReturn, 252 / tradingDays)) - 1) * 100;
      }
    } catch (error) {
      this.logger.warn('Failed to fetch NIFTY 50 data for backtest baseline');
    }

    this.logger.log(`Backtest completed. Evaluated ${stocksEvaluated} stocks, generated ${allTrades.length} trades.`);

    return {
      lastBacktestDate: new Date().toISOString(),
      datasetPeriod: '1y',
      stocksEvaluated,
      modelVersion: this.inferenceEngine.getModelVersion() || 'v1.0.0-lgb',
      horizons: {
        '1d': h1d,
        '5d': h5d,
        '20d': h20d
      },
      overallWinRate: this.roundTo1(overallWinRate),
      overallAvgReturn: this.roundTo1(overallAvgReturn),
      overallRiskRewardRatio: this.roundTo1(overallRiskRewardRatio),
      annualizedReturn: this.roundTo1(annualizedReturn),
      totalTrades: allTrades.length,
      nifty50AnnualReturn: this.roundTo1(nifty50AnnualReturn)
    };
  }

  private runSingleStockBacktest(ticker: string, candles: OHLCVCandle[]): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    
    for (let i = 50; i <= candles.length - 21; i++) {
      const historicalCandles = candles.slice(0, i + 1);
      
      const prevClose = i > 0 ? candles[i - 1].close : candles[i].open;
      const change = candles[i].close - prevClose;
      const changePercent = (change / prevClose) * 100;
      
      const quote: MarketQuote = {
        ticker,
        name: ticker,
        price: candles[i].close,
        change,
        changePercent,
        dayHigh: candles[i].high,
        dayLow: candles[i].low,
        prevClose,
        open: candles[i].open,
        volume: candles[i].volume,
        marketState: 'CLOSED',
        exchange: 'NSE',
        timestamp: String(candles[i].time),
        source: 'backtest',
        freshness: 'CLOSED' as const
      };

      const features = this.featureEngine.calculateFeatures(quote, historicalCandles, 0);

      const horizons: ('1d' | '5d' | '20d')[] = ['1d', '5d', '20d'];
      
      for (const horizon of horizons) {
        const rawProb = this.inferenceEngine.evaluate(features, horizon);
        const calibProb = this.calibrationEngine.apply(rawProb);
        
        let downsideProb = 1 - calibProb;
        if (horizon !== '20d') {
          const pred20d_raw = this.inferenceEngine.evaluate(features, '20d');
          const pred20d_calib = this.calibrationEngine.apply(pred20d_raw);
          downsideProb = 1 - pred20d_calib;
        }
        
        const risk = this.riskEngine.calculateRisk(quote, features, Math.min(0.95, Math.max(0.05, downsideProb)));
        
        const signalQuality = (calibProb >= 0.65 || calibProb <= 0.35) ? 'HIGH' : (calibProb >= 0.58 || calibProb <= 0.42) ? 'MEDIUM' : 'LOW';
        
        const decision = this.decisionEngine.makeDecision(calibProb, risk, 'SIDEWAYS', 'HIGH', signalQuality);
        
        if (['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL'].includes(decision)) {
          const offset = horizon === '1d' ? 1 : horizon === '5d' ? 5 : 20;
          
          if (i + offset >= candles.length) continue;
          
          const futurePrice = candles[i + offset].close;
          const actualReturn = (futurePrice - candles[i].close) / candles[i].close;
          
          const predictedDirection = calibProb > 0.5 ? 'UP' : 'DOWN';
          const directionCorrect = (predictedDirection === 'UP' && actualReturn > 0) || (predictedDirection === 'DOWN' && actualReturn < 0);
          
          let targetHit = false;
          let stopLossHit = false;
          
          const expReturn = this.inferenceEngine.calculateExpectedReturn(calibProb, horizon, risk.volatility);
          const targetPrice = quote.price * (1 + expReturn);
          const stopLossPrice = risk.stopLossPrice;
          
          for (let j = i + 1; j <= i + offset; j++) {
            if (predictedDirection === 'UP') {
              if (!targetHit && candles[j].high >= targetPrice) targetHit = true;
              if (!stopLossHit && candles[j].low <= stopLossPrice) stopLossHit = true;
            } else {
              if (!targetHit && candles[j].low <= targetPrice) targetHit = true;
              if (!stopLossHit && candles[j].high >= stopLossPrice) stopLossHit = true;
            }
            if (targetHit || stopLossHit) break;
          }
          
          trades.push({
            ticker,
            entryDate: String(candles[i].time),
            entryPrice: quote.price,
            horizon,
            predictedProb: calibProb,
            predictedDirection,
            decision,
            stopLossPrice,
            targetPrice,
            actualReturn,
            directionCorrect,
            targetHit,
            stopLossHit
          });
        }
      }
    }
    
    return trades;
  }

  private computeHorizonMetrics(trades: BacktestTrade[], horizon: '1d' | '5d' | '20d'): HorizonBacktestResult {
    if (trades.length === 0) {
      return {
        horizon, totalTrades: 0, winRate: 0, avgGainPercent: 0, avgLossPercent: 0,
        profitFactor: 0, maxDrawdown: 0, avgReturn: 0, targetHitRate: 0
      };
    }
    
    const winRate = (trades.filter(t => t.directionCorrect).length / trades.length) * 100;
    const wins = trades.filter(t => t.actualReturn > 0);
    const losses = trades.filter(t => t.actualReturn <= 0);
    
    const avgGainPercent = wins.length > 0 ? (wins.reduce((sum, t) => sum + t.actualReturn, 0) / wins.length) * 100 : 0;
    const avgLossPercent = losses.length > 0 ? (losses.reduce((sum, t) => sum + t.actualReturn, 0) / losses.length) * 100 : 0;
    
    const sumWins = wins.reduce((sum, t) => sum + t.actualReturn, 0);
    const sumLosses = losses.reduce((sum, t) => sum + t.actualReturn, 0);
    const profitFactor = Math.abs(sumLosses) > 0 ? sumWins / Math.abs(sumLosses) : 0;
    
    let equity = 100;
    let peak = 100;
    let maxDrawdown = 0;
    
    for (const trade of trades) {
      equity = equity * (1 + trade.actualReturn);
      if (equity > peak) peak = equity;
      const drawdown = (equity - peak) / peak;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
    maxDrawdown = maxDrawdown * 100;
    
    const avgReturn = (trades.reduce((sum, t) => sum + t.actualReturn, 0) / trades.length) * 100;
    const targetHitRate = (trades.filter(t => t.targetHit).length / trades.length) * 100;
    
    return {
      horizon,
      totalTrades: trades.length,
      winRate: this.roundTo1(winRate),
      avgGainPercent: this.roundTo1(avgGainPercent),
      avgLossPercent: this.roundTo1(avgLossPercent),
      profitFactor: this.roundTo1(profitFactor),
      maxDrawdown: this.roundTo1(maxDrawdown),
      avgReturn: this.roundTo1(avgReturn),
      targetHitRate: this.roundTo1(targetHitRate)
    };
  }

  private computeAnnualizedReturn(trades5d: BacktestTrade[]): number {
    if (trades5d.length === 0) return 0;
    
    let equity = 100;
    for (const trade of trades5d) {
      equity = equity * (1 + trade.actualReturn);
    }
    
    const totalReturn = (equity - 100) / 100;
    const tradingDays = trades5d.length * 5;
    const annualized = ((Math.pow(1 + totalReturn, 252 / tradingDays)) - 1) * 100;
    
    return this.roundTo1(annualized);
  }
}

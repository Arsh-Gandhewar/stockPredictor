import { Injectable, Logger } from '@nestjs/common';
import { YahooMarketDataProvider } from '../../stock/providers/yahoo-market-data.provider';
import { FeatureEngine } from './feature-engine';
import { ModelInferenceEngine } from './model-inference';
import { CalibrationEngine } from './calibration-engine';
import { RiskEngine } from './risk-engine';
import { DecisionEngine } from './decision-engine';
import { RegimeEngine } from './regime-engine';
import { OHLCVCandle, MarketQuote, MarketIndexBenchmark } from '../../stock/providers/market-data.provider.interface';
import { MODEL_CONFIG } from './model-config';
import { ModelRegistry } from './model-registry';

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
  grossReturn: number;
  netReturn: number;
  directionCorrect: boolean;
  targetHit: boolean;
  stopLossHit: boolean;
  regime: string;
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
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  cagr: number;
  brierScore: number;
}

export interface RegimePerformanceBreakdown {
  regime: string;
  winRate: number;
  avgReturn: number;
  tradesCount: number;
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
  overallSharpe: number;
  overallSortino: number;
  overallBrierScore: number;
  ece: number;
  regimePerformance: RegimePerformanceBreakdown[];
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  static readonly BACKTEST_TICKERS = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ITC.NS', 'BHARTIARTL.NS',
    'TATAMOTORS.NS', 'SUNPHARMA.NS', 'LT.NS', 'TATASTEEL.NS', 'ADANIENT.NS',
    'TITAN.NS', 'BAJFINANCE.NS', 'COALINDIA.NS', 'DIXON.NS', 'BHEL.NS',
  ];

  constructor(
    private readonly featureEngine: FeatureEngine,
    private readonly inferenceEngine: ModelInferenceEngine,
    private readonly calibrationEngine: CalibrationEngine,
    private readonly riskEngine: RiskEngine,
    private readonly decisionEngine: DecisionEngine,
    private readonly regimeEngine: RegimeEngine,
    private readonly marketProvider: YahooMarketDataProvider
  ) {}

  private roundTo1(num: number): number {
    return Math.round(num * 10) / 10;
  }

  private roundTo2(num: number): number {
    return Math.round(num * 100) / 100;
  }

  async runFullBacktest(): Promise<BacktestResult> {
    this.logger.log('Starting full walk-forward out-of-sample backtest with friction modeling...');

    // Fetch benchmark candles for market context
    let benchmarkCandles: OHLCVCandle[] = [];
    try {
      benchmarkCandles = await this.marketProvider.getHistoricalCandles('^NSEI', '1y');
    } catch {
      this.logger.warn('Could not fetch NIFTY benchmark candles for backtest');
    }

    const results = await Promise.allSettled(
      BacktestEngine.BACKTEST_TICKERS.map(async (ticker, idx) => {
        this.logger.log(`Backtesting ${ticker}... (${idx + 1}/${BacktestEngine.BACKTEST_TICKERS.length})`);
        const candles = await this.marketProvider.getHistoricalCandles(ticker, '1y');
        if (candles.length < MODEL_CONFIG.BACKTEST.MIN_CANDLES_REQUIRED) {
          this.logger.warn(`Skipping ${ticker} - insufficient data (${candles.length} candles)`);
          return [];
        }
        return this.runSingleStockBacktest(ticker, candles, benchmarkCandles);
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

    const trades1d = allTrades.filter((t) => t.horizon === '1d');
    const trades5d = allTrades.filter((t) => t.horizon === '5d');
    const trades20d = allTrades.filter((t) => t.horizon === '20d');

    const h1d = this.computeHorizonMetrics(trades1d, '1d');
    const h5d = this.computeHorizonMetrics(trades5d, '5d');
    const h20d = this.computeHorizonMetrics(trades20d, '20d');

    const overallWinRate =
      allTrades.length > 0
        ? (allTrades.filter((t) => t.directionCorrect).length / allTrades.length) * 100
        : 0;

    const overallAvgReturn =
      allTrades.length > 0
        ? (allTrades.reduce((sum, t) => sum + t.netReturn, 0) / allTrades.length) * 100
        : 0;

    let overallRiskRewardRatio = 0;
    const winningTrades = allTrades.filter((t) => t.netReturn > 0);
    const losingTrades = allTrades.filter((t) => t.netReturn <= 0);
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.netReturn, 0) / winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netReturn, 0) / losingTrades.length)
        : 0;
    if (avgLoss > 0) {
      overallRiskRewardRatio = avgWin / avgLoss;
    }

    const annualizedReturn = h5d.cagr;

    // NIFTY 50 Benchmark annual return
    let nifty50AnnualReturn = 0;
    if (benchmarkCandles.length >= 2) {
      const firstClose = benchmarkCandles[0].close;
      const lastClose = benchmarkCandles[benchmarkCandles.length - 1].close;
      const totalReturn = (lastClose / firstClose) - 1;
      const tradingDays = benchmarkCandles.length;
      nifty50AnnualReturn = ((Math.pow(1 + totalReturn, 252 / tradingDays)) - 1) * 100;
    }

    // Overall Calibration Metrics
    const calibrationPairs = allTrades.map((t) => ({
      prob: t.predictedProb,
      outcome: t.directionCorrect ? 1 : 0,
    }));
    const overallBrierScore = this.calibrationEngine.calculateBrierScore(calibrationPairs);
    const ece = this.calibrationEngine.calculateECE(calibrationPairs);

    // Regime-Stratified Performance
    const regimeGroups = new Map<string, BacktestTrade[]>();
    for (const trade of allTrades) {
      const list = regimeGroups.get(trade.regime) || [];
      list.push(trade);
      regimeGroups.set(trade.regime, list);
    }

    const regimePerformance: RegimePerformanceBreakdown[] = Array.from(regimeGroups.entries()).map(
      ([regime, trades]) => {
        const winCount = trades.filter((t) => t.directionCorrect).length;
        const avgRet = trades.reduce((s, t) => s + t.netReturn, 0) / trades.length;
        return {
          regime,
          winRate: this.roundTo2(winCount / trades.length),
          avgReturn: this.roundTo2(avgRet * 100),
          tradesCount: trades.length,
        };
      }
    );

    this.logger.log(
      `Backtest completed: ${allTrades.length} trades evaluated across ${stocksEvaluated} stocks. Overall Win Rate: ${overallWinRate.toFixed(
        1
      )}%, Net CAGR: ${annualizedReturn.toFixed(1)}%.`
    );

    return {
      lastBacktestDate: new Date().toISOString(),
      datasetPeriod: '1y',
      stocksEvaluated,
      modelVersion: ModelRegistry.getModelVersion(),
      horizons: {
        '1d': h1d,
        '5d': h5d,
        '20d': h20d,
      },
      overallWinRate: this.roundTo1(overallWinRate),
      overallAvgReturn: this.roundTo1(overallAvgReturn),
      overallRiskRewardRatio: this.roundTo1(overallRiskRewardRatio),
      annualizedReturn: this.roundTo1(annualizedReturn),
      totalTrades: allTrades.length,
      nifty50AnnualReturn: this.roundTo1(nifty50AnnualReturn),
      overallSharpe: h5d.sharpeRatio,
      overallSortino: h5d.sortinoRatio,
      overallBrierScore: this.roundTo2(overallBrierScore),
      ece: this.roundTo2(ece),
      regimePerformance,
    };
  }

  private runSingleStockBacktest(
    ticker: string,
    candles: OHLCVCandle[],
    benchmarkCandles: OHLCVCandle[]
  ): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    const warmup = MODEL_CONFIG.BACKTEST.WARMUP_PERIOD_DAYS;
    const step = MODEL_CONFIG.BACKTEST.EVALUATION_STEP_DAYS;
    const friction = MODEL_CONFIG.COSTS.TOTAL_ROUNDTRIP_FRICTION_PCT; // 0.13% round-trip

    for (let i = warmup; i <= candles.length - 21; i += step) {
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
        freshness: 'CLOSED' as const,
      };

      // Match benchmark candles up to current timestamp
      const benchSlice = benchmarkCandles.slice(0, Math.min(i + 1, benchmarkCandles.length));

      // 1. Calculate Multi-Factor Features (Sentiment=0 during backtest to prevent leakage)
      const features = this.featureEngine.calculateFeatures(quote, historicalCandles, 0, benchSlice);

      // 2. Evaluate Market Regime at this historical point
      const dummyIndices: MarketIndexBenchmark[] = [
        {
          symbol: '^NSEI',
          name: 'NIFTY 50',
          value: benchSlice.length > 0 ? benchSlice[benchSlice.length - 1].close : quote.price,
          change: 0,
          changePercent: 0,
          up: true,
          marketState: 'CLOSED',
          timestamp: String(candles[i].time),
        },
      ];
      const regime = this.regimeEngine.detectRegime(dummyIndices, benchSlice);

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

        const risk = this.riskEngine.calculateRisk(
          quote,
          features,
          Math.min(0.95, Math.max(0.05, downsideProb))
        );

        const signalQuality =
          calibProb >= 0.65 || calibProb <= 0.35
            ? 'HIGH'
            : calibProb >= 0.58 || calibProb <= 0.42
            ? 'MEDIUM'
            : 'LOW';

        const decision = this.decisionEngine.makeDecision(
          calibProb,
          risk,
          regime,
          'HIGH',
          signalQuality
        );

        if (['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL'].includes(decision)) {
          const offset = horizon === '1d' ? 1 : horizon === '5d' ? 5 : 20;

          if (i + offset >= candles.length) continue;

          const futurePrice = candles[i + offset].close;
          const grossReturn = (futurePrice - candles[i].close) / candles[i].close;

          // Apply institutional round-trip friction
          const netReturn = grossReturn >= 0
            ? (1 + grossReturn) * (1 - friction) - 1
            : (1 + grossReturn) * (1 + friction) - 1;

          const predictedDirection = calibProb > 0.5 ? 'UP' : 'DOWN';
          const directionCorrect =
            (predictedDirection === 'UP' && grossReturn > 0) ||
            (predictedDirection === 'DOWN' && grossReturn < 0);

          let targetHit = false;
          let stopLossHit = false;

          const expReturn = this.inferenceEngine.calculateExpectedReturn(
            calibProb,
            horizon,
            risk.volatility
          );
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
            grossReturn,
            netReturn,
            directionCorrect,
            targetHit,
            stopLossHit,
            regime,
          });
        }
      }
    }

    return trades;
  }

  private computeHorizonMetrics(
    trades: BacktestTrade[],
    horizon: '1d' | '5d' | '20d'
  ): HorizonBacktestResult {
    if (trades.length === 0) {
      return {
        horizon,
        totalTrades: 0,
        winRate: 0,
        avgGainPercent: 0,
        avgLossPercent: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        avgReturn: 0,
        targetHitRate: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        cagr: 0,
        brierScore: 0,
      };
    }

    const winRate = (trades.filter((t) => t.directionCorrect).length / trades.length) * 100;
    const wins = trades.filter((t) => t.netReturn > 0);
    const losses = trades.filter((t) => t.netReturn <= 0);

    const avgGainPercent =
      wins.length > 0 ? (wins.reduce((sum, t) => sum + t.netReturn, 0) / wins.length) * 100 : 0;
    const avgLossPercent =
      losses.length > 0 ? (losses.reduce((sum, t) => sum + t.netReturn, 0) / losses.length) * 100 : 0;

    const sumWins = wins.reduce((sum, t) => sum + t.netReturn, 0);
    const sumLosses = losses.reduce((sum, t) => sum + t.netReturn, 0);
    const profitFactor = Math.abs(sumLosses) > 0 ? sumWins / Math.abs(sumLosses) : sumWins > 0 ? 99 : 0;

    // Equity Curve & Maximum Drawdown
    let equity = 100;
    let peak = 100;
    let maxDrawdown = 0;
    const equitySeries: number[] = [100];

    for (const trade of trades) {
      equity = equity * (1 + trade.netReturn);
      equitySeries.push(equity);
      if (equity > peak) peak = equity;
      const drawdown = (equity - peak) / peak;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
    maxDrawdown = maxDrawdown * 100;

    const avgReturn = (trades.reduce((sum, t) => sum + t.netReturn, 0) / trades.length) * 100;
    const targetHitRate = (trades.filter((t) => t.targetHit).length / trades.length) * 100;

    // CAGR calculation: Compound Annual Growth Rate
    const daysMultiplier = horizon === '1d' ? 1 : horizon === '5d' ? 5 : 20;
    const estimatedTradingDays = Math.max(20, trades.length * (daysMultiplier / 3));
    const totalNetReturn = (equity - 100) / 100;
    const cagr = ((Math.pow(Math.max(0.01, 1 + totalNetReturn), 252 / estimatedTradingDays)) - 1) * 100;

    // Sharpe Ratio calculation: (Annualized Return - Risk Free Rate (6.5%)) / Annualized Volatility
    const riskFreeRate = 0.065;
    const returnsList = trades.map((t) => t.netReturn);
    const meanTradeReturn = returnsList.reduce((s, r) => s + r, 0) / returnsList.length;
    const tradeVariance =
      returnsList.reduce((s, r) => s + Math.pow(r - meanTradeReturn, 2), 0) / returnsList.length;
    const tradeStdDev = Math.sqrt(tradeVariance);
    const annualizedVol = tradeStdDev * Math.sqrt(252 / daysMultiplier);

    const sharpeRatio = annualizedVol > 0 ? (cagr / 100 - riskFreeRate) / annualizedVol : 1.0;

    // Sortino Ratio calculation: (Annualized Return - Risk Free Rate) / Downside Deviation
    const negativeReturns = returnsList.filter((r) => r < 0);
    const downsideVar =
      negativeReturns.length > 0
        ? negativeReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / returnsList.length
        : 0.0001;
    const annualizedDownsideDev = Math.sqrt(downsideVar) * Math.sqrt(252 / daysMultiplier);

    const sortinoRatio = annualizedDownsideDev > 0 ? (cagr / 100 - riskFreeRate) / annualizedDownsideDev : 1.5;

    // Calmar Ratio: CAGR / |MaxDrawdown|
    const calmarRatio = Math.abs(maxDrawdown) > 0 ? Math.abs(cagr / maxDrawdown) : 0;

    // Brier Score
    const pairs = trades.map((t) => ({ prob: t.predictedProb, outcome: t.directionCorrect ? 1 : 0 }));
    const brierScore = this.calibrationEngine.calculateBrierScore(pairs);

    return {
      horizon,
      totalTrades: trades.length,
      winRate: this.roundTo1(winRate),
      avgGainPercent: this.roundTo1(avgGainPercent),
      avgLossPercent: this.roundTo1(avgLossPercent),
      profitFactor: this.roundTo2(profitFactor),
      maxDrawdown: this.roundTo1(maxDrawdown),
      avgReturn: this.roundTo1(avgReturn),
      targetHitRate: this.roundTo1(targetHitRate),
      sharpeRatio: this.roundTo2(Math.max(0, sharpeRatio)),
      sortinoRatio: this.roundTo2(Math.max(0, sortinoRatio)),
      calmarRatio: this.roundTo2(calmarRatio),
      cagr: this.roundTo1(cagr),
      brierScore: this.roundTo2(brierScore),
    };
  }
}

import { Money } from '../../../common/utils/money.util';
import { MODEL_CONFIG } from '../../prediction/engines/model-config';

export interface SimulatorPosition {
  ticker: string;
  sector: string;
  quantity: number;
  entryPrice: number;
  averagePrice: number;
  currentPrice: number;
  stopLossPrice: number | null;
  targetPrice: number | null;
  entryDate: string;
  horizonDays: number;
  holdingDays: number;
}

export interface DailyEquityPoint {
  date: string;
  nav: number;
  cash: number;
  investedValue: number;
  grossExposure: number; // 0.0 to 1.0
  positionsCount: number;
  dailyReturn: number;
}

export interface ExecutedSimulatorTrade {
  tradeId: string;
  ticker: string;
  sector: string;
  positionType: 'LONG';
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'STOP_LOSS' | 'TARGET_PROFIT' | 'HORIZON_EXPIRY' | 'SIGNAL_EXIT';
  quantity: number;
  notionalEntry: number;
  notionalExit: number;
  totalCosts: number;
  grossReturn: number;
  netReturn: number;
  realizedPnL: number;
  holdingDays: number;
  directionCorrect: boolean;
}

export interface PortfolioSimulatorConfig {
  initialCash?: number;
  maxStockWeight?: number; // e.g. 0.10 (10%)
  maxSectorWeight?: number; // e.g. 0.25 (25%)
  maxGrossExposure?: number; // 1.00 (100%)
  maxPositions?: number; // 10
  brokerageRate?: number; // 0.0003 (3 bps)
  sttSellRate?: number; // 0.0010 (10 bps)
  slippageRate?: number; // 0.0005 (5 bps)
}

export interface OrderIntent {
  ticker: string;
  sector: string;
  type: 'BUY' | 'SELL';
  price: number;
  date: string;
  quantity?: number;
  targetWeight?: number;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
  horizonDays?: number;
  reason?: string;
}

export interface OrderExecutionResult {
  executed: boolean;
  orderType: 'BUY' | 'SELL';
  ticker: string;
  quantity: number;
  executionPrice: number;
  totalCostOrProceeds: number;
  rejectionReason?: string;
  trade?: ExecutedSimulatorTrade;
}

export interface PortfolioMetrics {
  initialCash: number;
  endingNav: number;
  totalReturn: number;
  cagr: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number | 'NOT_MEANINGFUL';
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeReturn: number;
}

export class EventDrivenPortfolioSimulator {
  public cash: number;
  public positions: Map<string, SimulatorPosition> = new Map();
  public equityCurve: DailyEquityPoint[] = [];
  public trades: ExecutedSimulatorTrade[] = [];
  public realizedPnL: number = 0;

  public readonly config: Required<PortfolioSimulatorConfig>;
  private tradeCounter: number = 0;

  constructor(config: PortfolioSimulatorConfig = {}) {
    this.config = {
      initialCash: config.initialCash ?? 1_000_000,
      maxStockWeight: config.maxStockWeight ?? MODEL_CONFIG.RISK.POSITION_CONCENTRATION_LIMIT, // 0.10
      maxSectorWeight: config.maxSectorWeight ?? MODEL_CONFIG.RISK.SECTOR_CONCENTRATION_LIMIT, // 0.25
      maxGrossExposure: config.maxGrossExposure ?? 1.00,
      maxPositions: config.maxPositions ?? 10,
      brokerageRate: config.brokerageRate ?? MODEL_CONFIG.COSTS.BROKERAGE_PCT, // 0.0003
      sttSellRate: config.sttSellRate ?? MODEL_CONFIG.COSTS.STT_SELL_PCT, // 0.0010
      slippageRate: config.slippageRate ?? MODEL_CONFIG.COSTS.SLIPPAGE_BPS / 10_000, // 0.0005
    };
    this.cash = this.config.initialCash;
  }

  /**
   * Current Total Net Asset Value (NAV) = Cash + Sum(Positions at Current Price)
   */
  public getNAV(): number {
    let invested = 0;
    for (const pos of this.positions.values()) {
      invested += pos.quantity * pos.currentPrice;
    }
    return Money.round(this.cash + invested);
  }

  /**
   * Current Invested Value across all open positions
   */
  public getInvestedValue(): number {
    let invested = 0;
    for (const pos of this.positions.values()) {
      invested += pos.quantity * pos.currentPrice;
    }
    return Money.round(invested);
  }

  /**
   * Current Sector Exposure across open positions
   */
  public getSectorValue(sector: string): number {
    let val = 0;
    for (const pos of this.positions.values()) {
      if (pos.sector === sector) {
        val += pos.quantity * pos.currentPrice;
      }
    }
    return Money.round(val);
  }

  /**
   * Core State Transition: Process Order Intent (BUY / SELL)
   */
  public processOrderIntent(intent: OrderIntent): OrderExecutionResult {
    const nav = this.getNAV();
    const effectiveSlippage = this.config.slippageRate;
    const effectiveBrokerage = this.config.brokerageRate;
    const effectiveStt = this.config.sttSellRate;

    if (intent.type === 'BUY') {
      // 1. Position Count Limit Check
      if (!this.positions.has(intent.ticker) && this.positions.size >= this.config.maxPositions) {
        return {
          executed: false,
          orderType: 'BUY',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice: intent.price,
          totalCostOrProceeds: 0,
          rejectionReason: `MAX_POSITIONS_REACHED: Portfolio holds maximum of ${this.config.maxPositions} active positions.`,
        };
      }

      // 2. Execution Price with Adverse Slippage
      const executionPrice = Money.round(intent.price * (1 + effectiveSlippage));

      // 3. Compute Allocation Constraints
      const existingPos = this.positions.get(intent.ticker);
      const currentStockVal = existingPos ? existingPos.quantity * existingPos.currentPrice : 0;
      const currentSectorVal = this.getSectorValue(intent.sector);

      const maxAllowedStockVal = nav * this.config.maxStockWeight;
      const remainingStockCap = Math.max(0, maxAllowedStockVal - currentStockVal);

      const maxAllowedSectorVal = nav * this.config.maxSectorWeight;
      const remainingSectorCap = Math.max(0, maxAllowedSectorVal - currentSectorVal);

      // Max gross exposure: cash cannot go below 0
      const availableCapital = Math.max(0, this.cash);

      const maxExpenditure = Math.min(remainingStockCap, remainingSectorCap, availableCapital);
      if (maxExpenditure <= 0) {
        return {
          executed: false,
          orderType: 'BUY',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice,
          totalCostOrProceeds: 0,
          rejectionReason: remainingStockCap <= 0
            ? `STOCK_CAP_EXCEEDED: Stock weight already at or above ${this.config.maxStockWeight * 100}% of NAV.`
            : remainingSectorCap <= 0
              ? `SECTOR_CAP_EXCEEDED: Sector '${intent.sector}' already at or above ${this.config.maxSectorWeight * 100}% of NAV.`
              : `INSUFFICIENT_CASH: Available cash is ₹${this.cash.toFixed(2)}.`,
        };
      }

      const costPerShare = executionPrice * (1 + effectiveBrokerage);
      let targetQuantity = intent.quantity ?? Math.floor(maxExpenditure / costPerShare);

      // Enforce sizing does not exceed maxExpenditure
      if (targetQuantity * costPerShare > maxExpenditure) {
        targetQuantity = Math.floor(maxExpenditure / costPerShare);
      }

      if (targetQuantity <= 0) {
        const reason =
          remainingStockCap < costPerShare
            ? `STOCK_CAP_EXCEEDED: Stock allocation exceeds maximum limit (${this.config.maxStockWeight * 100}% of NAV).`
            : remainingSectorCap < costPerShare
              ? `SECTOR_CAP_EXCEEDED: Sector '${intent.sector}' allocation exceeds maximum limit (${this.config.maxSectorWeight * 100}% of NAV).`
              : 'SIZING_ZERO: Constraints reduced order quantity to 0 shares.';
        return {
          executed: false,
          orderType: 'BUY',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice,
          totalCostOrProceeds: 0,
          rejectionReason: reason,
        };
      }

      const totalCost = Money.round(targetQuantity * costPerShare);
      if (totalCost > this.cash) {
        return {
          executed: false,
          orderType: 'BUY',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice,
          totalCostOrProceeds: 0,
          rejectionReason: `INSUFFICIENT_CASH: Total cost ₹${totalCost.toFixed(2)} exceeds available cash ₹${this.cash.toFixed(2)}.`,
        };
      }

      // State Transition: Deduct Cash & Record/Update Position
      this.cash = Money.round(this.cash - totalCost);

      if (existingPos) {
        const newQty = existingPos.quantity + targetQuantity;
        const newAvg = Money.calculateNewAveragePrice(
          existingPos.quantity,
          existingPos.averagePrice,
          targetQuantity,
          executionPrice
        );
        existingPos.quantity = newQty;
        existingPos.averagePrice = newAvg;
        existingPos.currentPrice = executionPrice;
        if (intent.stopLossPrice !== undefined) existingPos.stopLossPrice = intent.stopLossPrice;
        if (intent.targetPrice !== undefined) existingPos.targetPrice = intent.targetPrice;
        if (intent.horizonDays !== undefined) existingPos.horizonDays = intent.horizonDays;
      } else {
        this.positions.set(intent.ticker, {
          ticker: intent.ticker,
          sector: intent.sector,
          quantity: targetQuantity,
          entryPrice: executionPrice,
          averagePrice: executionPrice,
          currentPrice: executionPrice,
          stopLossPrice: intent.stopLossPrice ?? null,
          targetPrice: intent.targetPrice ?? null,
          entryDate: intent.date,
          horizonDays: intent.horizonDays ?? 5,
          holdingDays: 0,
        });
      }

      return {
        executed: true,
        orderType: 'BUY',
        ticker: intent.ticker,
        quantity: targetQuantity,
        executionPrice,
        totalCostOrProceeds: totalCost,
      };
    }

    if (intent.type === 'SELL') {
      // Long-Only Mandate: cannot sell non-owned shares (no shorting)
      const existingPos = this.positions.get(intent.ticker);
      if (!existingPos || existingPos.quantity <= 0) {
        return {
          executed: false,
          orderType: 'SELL',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice: intent.price,
          totalCostOrProceeds: 0,
          rejectionReason: `UNSUPPORTED_SHORT: No active position in ${intent.ticker}. Short sales are prohibited under Long-Only mandate.`,
        };
      }

      const sharesToSell = intent.quantity !== undefined
        ? Math.min(intent.quantity, existingPos.quantity)
        : existingPos.quantity;

      if (sharesToSell <= 0) {
        return {
          executed: false,
          orderType: 'SELL',
          ticker: intent.ticker,
          quantity: 0,
          executionPrice: intent.price,
          totalCostOrProceeds: 0,
          rejectionReason: 'INVALID_QUANTITY: Shares to sell must be greater than 0.',
        };
      }

      // Exit Execution Price with Adverse Slippage
      const executionPrice = Money.round(intent.price * (1 - effectiveSlippage));
      const notionalExit = Money.round(sharesToSell * executionPrice);
      const friction = Money.round(notionalExit * (effectiveBrokerage + effectiveStt));
      const netProceeds = Money.round(notionalExit - friction);

      const notionalEntry = Money.round(sharesToSell * existingPos.averagePrice);
      const pnl = Money.round(netProceeds - notionalEntry);
      const grossReturn = (executionPrice - existingPos.averagePrice) / existingPos.averagePrice;
      const netReturn = notionalEntry > 0 ? (netProceeds - notionalEntry) / notionalEntry : 0;

      // State Transition: Increment Cash
      this.cash = Money.round(this.cash + netProceeds);
      this.realizedPnL = Money.round(this.realizedPnL + pnl);

      this.tradeCounter++;
      const executedTrade: ExecutedSimulatorTrade = {
        tradeId: `trade_${this.tradeCounter}_${intent.ticker}_${intent.date}`,
        ticker: intent.ticker,
        sector: existingPos.sector,
        positionType: 'LONG',
        entryDate: existingPos.entryDate,
        entryPrice: existingPos.entryPrice,
        exitDate: intent.date,
        exitPrice: executionPrice,
        exitReason: (intent.reason as any) || 'SIGNAL_EXIT',
        quantity: sharesToSell,
        notionalEntry,
        notionalExit,
        totalCosts: friction,
        grossReturn: parseFloat(grossReturn.toFixed(4)),
        netReturn: parseFloat(netReturn.toFixed(4)),
        realizedPnL: pnl,
        holdingDays: existingPos.holdingDays,
        directionCorrect: grossReturn > 0,
      };

      this.trades.push(executedTrade);

      // Reduce or delete position
      if (sharesToSell >= existingPos.quantity) {
        this.positions.delete(intent.ticker);
      } else {
        existingPos.quantity -= sharesToSell;
      }

      return {
        executed: true,
        orderType: 'SELL',
        ticker: intent.ticker,
        quantity: sharesToSell,
        executionPrice,
        totalCostOrProceeds: netProceeds,
        trade: executedTrade,
      };
    }

    return {
      executed: false,
      orderType: intent.type,
      ticker: intent.ticker,
      quantity: 0,
      executionPrice: intent.price,
      totalCostOrProceeds: 0,
      rejectionReason: `UNKNOWN_ORDER_TYPE: ${(intent as any).type}`,
    };
  }

  /**
   * Evaluates intraday OHLC path triggers for held positions:
   * 1. Stop-loss trigger
   * 2. Target profit trigger
   * 3. Conservative rule: if both touched on the same candle, stop-loss executes first
   * 4. Horizon expiry: if position reaches horizon days, exits at candle close
   */
  public processCandlePath(
    ticker: string,
    candle: { time: string | number; open: number; high: number; low: number; close: number }
  ): ExecutedSimulatorTrade | null {
    const pos = this.positions.get(ticker);
    if (!pos || pos.quantity <= 0) return null;

    const candleDate = String(candle.time);
    pos.holdingDays += 1;
    pos.currentPrice = candle.close;

    let exitPrice: number | null = null;
    let exitReason: ExecutedSimulatorTrade['exitReason'] | null = null;

    const touchedStop = pos.stopLossPrice !== null && candle.low <= pos.stopLossPrice;
    const touchedTarget = pos.targetPrice !== null && candle.high >= pos.targetPrice;

    if (touchedStop && touchedTarget) {
      // Conservative collision priority: stop loss triggers first
      exitPrice = pos.stopLossPrice!;
      exitReason = 'STOP_LOSS';
    } else if (touchedStop) {
      exitPrice = pos.stopLossPrice!;
      exitReason = 'STOP_LOSS';
    } else if (touchedTarget) {
      exitPrice = pos.targetPrice!;
      exitReason = 'TARGET_PROFIT';
    } else if (pos.holdingDays >= pos.horizonDays) {
      exitPrice = candle.close;
      exitReason = 'HORIZON_EXPIRY';
    }

    if (exitPrice !== null && exitReason !== null) {
      const sellResult = this.processOrderIntent({
        ticker,
        sector: pos.sector,
        type: 'SELL',
        price: exitPrice,
        date: candleDate,
        quantity: pos.quantity,
        reason: exitReason,
      });
      return sellResult.trade || null;
    }

    return null;
  }

  /**
   * Daily Mark-to-Market Snapshot
   */
  public markToMarket(date: string, quotesMap: Map<string, number>): DailyEquityPoint {
    // Update marks for held positions
    for (const [ticker, pos] of this.positions.entries()) {
      const mark = quotesMap.get(ticker);
      if (mark !== undefined && mark > 0) {
        pos.currentPrice = mark;
      }
    }

    const nav = this.getNAV();
    const invested = this.getInvestedValue();
    const grossExposure = nav > 0 ? parseFloat((invested / nav).toFixed(4)) : 0;

    const prevNav = this.equityCurve.length > 0
      ? this.equityCurve[this.equityCurve.length - 1].nav
      : this.config.initialCash;

    const dailyReturn = prevNav > 0 ? parseFloat(((nav - prevNav) / prevNav).toFixed(5)) : 0;

    const point: DailyEquityPoint = {
      date,
      nav,
      cash: this.cash,
      investedValue: invested,
      grossExposure,
      positionsCount: this.positions.size,
      dailyReturn,
    };

    this.equityCurve.push(point);
    return point;
  }

  /**
   * Calculates comprehensive portfolio economic metrics from the equity curve & trade ledger
   */
  public computeMetrics(): PortfolioMetrics {
    const endingNav = this.equityCurve.length > 0
      ? this.equityCurve[this.equityCurve.length - 1].nav
      : this.getNAV();

    const initialCash = this.config.initialCash;
    const totalReturn = initialCash > 0 ? (endingNav - initialCash) / initialCash : 0;

    const days = Math.max(1, this.equityCurve.length);
    const cagr = days > 1 ? Math.pow(Math.max(0.001, endingNav / initialCash), 252 / days) - 1 : totalReturn;

    // Daily returns for Sharpe and Sortino
    const dailyReturns = this.equityCurve.map((p) => p.dailyReturn);
    const meanDaily = dailyReturns.length > 0
      ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
      : 0;

    const variance = dailyReturns.length > 1
      ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanDaily, 2), 0) / (dailyReturns.length - 1)
      : 0;
    const dailyVol = Math.sqrt(variance);
    const annualizedVol = dailyVol * Math.sqrt(252);
    const sharpeRatio = annualizedVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / annualizedVol).toFixed(2)) : 0;

    const downsideDiffs = dailyReturns.filter((r) => r < 0);
    const downsideVar = downsideDiffs.length > 0
      ? downsideDiffs.reduce((s, r) => s + Math.pow(r, 2), 0) / dailyReturns.length
      : 0;
    const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
    const sortinoRatio = downsideVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / downsideVol).toFixed(2)) : 0;

    // Maximum Peak-to-Trough Drawdown
    let peak = initialCash;
    let maxDrawdown = 0;
    for (const point of this.equityCurve) {
      if (point.nav > peak) peak = point.nav;
      const dd = peak > 0 ? (peak - point.nav) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const totalTrades = this.trades.length;
    const winningTrades = this.trades.filter((t) => t.netReturn > 0).length;
    const losingTrades = this.trades.filter((t) => t.netReturn <= 0).length;
    const winRate = totalTrades > 0 ? parseFloat(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

    const grossGains = this.trades.filter((t) => t.realizedPnL > 0).reduce((s, t) => s + t.realizedPnL, 0);
    const grossLosses = Math.abs(this.trades.filter((t) => t.realizedPnL < 0).reduce((s, t) => s + t.realizedPnL, 0));
    const profitFactor = grossLosses > 0
      ? parseFloat((grossGains / grossLosses).toFixed(2))
      : grossGains > 0
        ? 'NOT_MEANINGFUL'
        : 1.0;

    const avgTradeReturn = totalTrades > 0
      ? parseFloat(((this.trades.reduce((s, t) => s + t.netReturn, 0) / totalTrades) * 100).toFixed(2))
      : 0;

    return {
      initialCash,
      endingNav,
      totalReturn: parseFloat((totalReturn * 100).toFixed(2)),
      cagr: parseFloat((cagr * 100).toFixed(2)),
      sharpeRatio,
      sortinoRatio,
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      winRate,
      profitFactor,
      totalTrades,
      winningTrades,
      losingTrades,
      avgTradeReturn,
    };
  }
}

import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { AiService } from '../ai/ai.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { TransactionType, OrderType } from 'db';
import { Money } from '../../common/utils/money.util';

export interface PortfolioPositionWithLiveMetrics {
  id: string;
  portfolioId: string;
  stockId: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  dayChange: number;
  dayChangePercent: number;
  investedValue: number;
  currentValue: number;
  todayPnL: number;
  overallPnL: number;
  overallPnLPercent: number;
  stopLossPrice: number | null;
  targetPrice: number | null;
  stock: {
    id: string;
    ticker: string;
    name: string;
    sector: string | null;
    exchange: string;
  };
}

export interface PortfolioSummary {
  id: string;
  userId: string;
  availableCash: number;
  positions: PortfolioPositionWithLiveMetrics[];
  totalInvested: number;
  totalCurrentValue: number;
  totalPortfolioValue: number;
  totalTodayPnL: number;
  totalTodayPnLPercent: number;
  totalOverallPnL: number;
  totalOverallPnLPercent: number;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stockService: StockService,
    private readonly aiService: AiService,
    private readonly predictionService: QuantPredictionService,
  ) {}

  private async getOrCreateUser(userId: string) {
    try {
      return await this.db.client.user.upsert({
        where: { clerkId: userId },
        update: {},
        create: { clerkId: userId, email: `${userId}@quantx.internal`, firstName: 'QuantX', lastName: 'Trader' },
      });
    } catch {
      return await this.db.client.user.findUniqueOrThrow({ where: { clerkId: userId } });
    }
  }

  /**
   * Retrieves or initializes the user's paper trading portfolio with real-time live P&L
   */
  async getPortfolio(userId: string): Promise<PortfolioSummary> {
    const user = await this.getOrCreateUser(userId);
    let portfolio;
    try {
      portfolio = await this.db.client.portfolio.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, availableCash: 1000000 },
        include: { positions: { include: { stock: true } } },
      });
    } catch {
      portfolio = await this.db.client.portfolio.findUniqueOrThrow({
        where: { userId: user.id },
        include: { positions: { include: { stock: true } } },
      });
    }
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalTodayPnL = 0;

    const tickers = portfolio.positions.map((p) => p.stock.ticker);
    const quotes = tickers.length > 0 ? await this.stockService.getQuotes(tickers).catch(() => []) : [];
    const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

    // ── AUTOMATED STOP-LOSS & TARGET AUTO-EXECUTION ENGINE ──
    const activePositions: typeof portfolio.positions = [];
    let cashAddedFromAutoSells = 0;

    for (const pos of portfolio.positions) {
      const quote = quoteMap.get(pos.stock.ticker);
      const currentPrice = quote?.price || Number(pos.averagePrice);
      const stopLoss = pos.stopLossPrice ? Number(pos.stopLossPrice) : null;
      const target = pos.targetPrice ? Number(pos.targetPrice) : null;

      const isStopLossHit = stopLoss !== null && currentPrice > 0 && currentPrice <= stopLoss;
      const isTargetHit = target !== null && currentPrice > 0 && currentPrice >= target;

      if (isStopLossHit || isTargetHit) {
        const reason = isStopLossHit ? 'AUTO_STOP_LOSS' : 'AUTO_TARGET_PROFIT';
        const totalProceeds = Money.multiply(pos.quantity, currentPrice);
        cashAddedFromAutoSells = Money.add(cashAddedFromAutoSells, totalProceeds);

        try {
          await this.db.client.$transaction([
            this.db.client.position.delete({
              where: { id: pos.id },
            }),
            this.db.client.portfolio.update({
              where: { id: portfolio.id },
              data: {
                availableCash: Money.add(Number(portfolio.availableCash), totalProceeds),
              },
            }),
            this.db.client.transaction.create({
              data: {
                portfolioId: portfolio.id,
                stockId: pos.stock.id,
                type: TransactionType.SELL,
                orderType: OrderType.LIMIT,
                quantity: pos.quantity,
                price: currentPrice,
              },
            }),
          ]);

          this.logger.log(`🛡️ Auto-Executed ${reason} for ${pos.stock.ticker}: Sold ${pos.quantity} shares @ ₹${currentPrice}`);
        } catch (err) {
          this.logger.error(`Failed to auto-execute ${reason} for ${pos.stock.ticker}:`, err);
          activePositions.push(pos);
        }
      } else {
        activePositions.push(pos);
      }
    }

    const currentCash = Money.add(Number(portfolio.availableCash), cashAddedFromAutoSells);

    const hydratedPositions: PortfolioPositionWithLiveMetrics[] = activePositions.map((pos) => {
        let currentPrice = Number(pos.averagePrice);
        let dayChange = 0;
        let dayChangePercent = 0;
        let prevClose = Number(pos.averagePrice);

        const quote = quoteMap.get(pos.stock.ticker);
        if (quote) {
          currentPrice = quote.price;
          dayChange = quote.change;
          dayChangePercent = quote.changePercent;
          prevClose = quote.prevClose || quote.price - quote.change;
        }

        const investedValue = Money.multiply(pos.quantity, Number(pos.averagePrice));
        const currentValue = Money.multiply(pos.quantity, currentPrice);
        const overallPnL = Money.subtract(currentValue, investedValue);
        const overallPnLPercent = Money.calculateReturnPercent(currentValue, investedValue);
        const todayPnL = Money.multiply(pos.quantity, currentPrice - prevClose);

        totalInvested = Money.add(totalInvested, investedValue);
        totalCurrentValue = Money.add(totalCurrentValue, currentValue);
        totalTodayPnL = Money.add(totalTodayPnL, todayPnL);

        return {
          id: pos.id,
          portfolioId: pos.portfolioId,
          stockId: pos.stockId,
          quantity: pos.quantity,
          averagePrice: Number(pos.averagePrice),
          currentPrice,
          dayChange,
          dayChangePercent,
          investedValue,
          currentValue,
          todayPnL,
          overallPnL,
          overallPnLPercent,
          stopLossPrice: pos.stopLossPrice ? Number(pos.stopLossPrice) : null,
          targetPrice: pos.targetPrice ? Number(pos.targetPrice) : null,
          stock: {
            id: pos.stock.id,
            ticker: pos.stock.ticker,
            name: pos.stock.name,
            sector: pos.stock.sector,
            exchange: pos.stock.exchange,
          },
        };
      });

    const totalOverallPnL = Money.subtract(totalCurrentValue, totalInvested);
    const totalOverallPnLPercent = Money.calculateReturnPercent(totalCurrentValue, totalInvested);
    const totalPortfolioValue = Money.add(currentCash, totalCurrentValue);
    const totalTodayPnLPercent = totalPortfolioValue > 0 ? Money.round((totalTodayPnL / totalPortfolioValue) * 100) : 0;

    return {
      id: portfolio.id,
      userId: portfolio.userId,
      availableCash: Money.round(currentCash),
      positions: hydratedPositions,
      totalInvested: Money.round(totalInvested),
      totalCurrentValue: Money.round(totalCurrentValue),
      totalPortfolioValue: Money.round(totalPortfolioValue),
      totalTodayPnL: Money.round(totalTodayPnL),
      totalTodayPnLPercent,
      totalOverallPnL: Money.round(totalOverallPnL),
      totalOverallPnLPercent,
    };
  }

  /**
   * Executes atomic paper trade (BUY or SELL) with database transaction and balance validation
   */
  async executeTrade(
    userId: string,
    ticker: string,
    type: TransactionType,
    quantity: number,
    orderType: OrderType = OrderType.MARKET
  ) {
    if (!quantity || quantity <= 0) {
      throw new BadRequestException('Order quantity must be a positive integer');
    }

    // 1. Fetch live market price
    const quote = await this.stockService.getQuote(ticker);
    const executionPrice = quote.price;
    const totalCost = Money.multiply(quantity, executionPrice);

    // 2. Ensure stock record exists in DB
    let stock = await this.db.client.stock.findUnique({
      where: { ticker },
    });

    if (!stock) {
      stock = await this.db.client.stock.create({
        data: {
          ticker,
          name: quote.name || ticker.replace('.NS', ''),
          exchange: 'NSE',
          sector: 'Equities',
        },
      });
    }

    // 3. Auto Calculate Quantitative Stop-Loss & Target if BUY order
    let autoStopLossPrice = Money.round(executionPrice * 0.95);
    let autoTargetPrice = Money.round(executionPrice * 1.08);

    if (type === TransactionType.BUY) {
      try {
        const prediction = await this.predictionService.getPrediction(ticker);
        if (prediction?.risk?.stopLossPrice && prediction.risk.stopLossPrice < executionPrice) {
          autoStopLossPrice = prediction.risk.stopLossPrice;
        }
        if (prediction?.risk?.targetPrice && prediction.risk.targetPrice > executionPrice) {
          autoTargetPrice = prediction.risk.targetPrice;
        }
      } catch (err) {
        this.logger.warn(`Could not compute live prediction for ${ticker}, using fallback 5% ATR stop.`);
      }
    }

    // 4. Ensure portfolio exists
    const portfolioSummary = await this.getPortfolio(userId);
    const user = await this.db.client.user.findUnique({ where: { clerkId: userId } });

    if (!user) {
      throw new NotFoundException('User could not be found or initialized');
    }

    // 5. Atomic Execution inside Prisma Transaction (reads INSIDE to prevent stale data race conditions)
    return await this.db.client.$transaction(async (tx) => {
      const portfolio = await tx.portfolio.findUnique({
        where: { userId: user.id },
        include: { positions: true },
      });

      if (!portfolio) {
        throw new NotFoundException('Portfolio could not be found or initialized');
      }

      const existingPosition = portfolio.positions.find((p) => p.stockId === stock!.id);

      if (type === TransactionType.BUY) {
        if (Number(portfolio.availableCash) < totalCost) {
          throw new BadRequestException(
            `Insufficient virtual capital. Required: ${Money.formatINR(totalCost)}, Available: ${Money.formatINR(Number(portfolio.availableCash))}`
          );
        }

        // Deduct available cash
        const updatedCash = Money.subtract(Number(portfolio.availableCash), totalCost);
        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: { availableCash: updatedCash },
        });

        // Update or create position with weighted average buy price and auto stop-loss
        if (existingPosition) {
          const newAvgPrice = Money.calculateNewAveragePrice(
            existingPosition.quantity,
            Number(existingPosition.averagePrice),
            quantity,
            executionPrice
          );
          const newQty = existingPosition.quantity + quantity;

          await tx.position.update({
            where: { id: existingPosition.id },
            data: {
              quantity: newQty,
              averagePrice: newAvgPrice,
              stopLossPrice: autoStopLossPrice,
              targetPrice: autoTargetPrice,
            },
          });
        } else {
          await tx.position.create({
            data: {
              portfolioId: portfolio.id,
              stockId: stock!.id,
              quantity,
              averagePrice: executionPrice,
              stopLossPrice: autoStopLossPrice,
              targetPrice: autoTargetPrice,
            },
          });
        }

        // Automatically configure an active safety price alert for the user
        await tx.alert.create({
          data: {
            userId: user.id,
            stockId: stock!.id,
            type: 'STOP_LOSS_HIT',
            condition: 'LESS_THAN',
            targetValue: autoStopLossPrice,
            isActive: true,
          },
        }).catch(() => null);
      } else if (type === TransactionType.SELL) {
        if (!existingPosition || existingPosition.quantity < quantity) {
          const held = existingPosition ? existingPosition.quantity : 0;
          throw new BadRequestException(
            `Insufficient shares to sell. Attempted to sell ${quantity} shares of ${ticker}, but only hold ${held} shares.`
          );
        }

        // Add proceeds to cash
        const updatedCash = Money.add(Number(portfolio.availableCash), totalCost);
        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: { availableCash: updatedCash },
        });

        // Reduce or delete position
        if (existingPosition.quantity === quantity) {
          await tx.position.delete({
            where: { id: existingPosition.id },
          });
        } else {
          await tx.position.update({
            where: { id: existingPosition.id },
            data: {
              quantity: existingPosition.quantity - quantity,
            },
          });
        }
      }

      // Record immutable transaction audit trail
      const transaction = await tx.transaction.create({
        data: {
          portfolioId: portfolio.id,
          stockId: stock!.id,
          type,
          orderType,
          quantity,
          price: executionPrice,
        },
      });

      return {
        success: true,
        message: `Simulated ${type} order for ${quantity} shares of ${ticker} executed successfully at ₹${executionPrice.toFixed(2)}`,
        transactionId: transaction.id,
        ticker,
        type,
        quantity,
        executionPrice,
        totalCost,
      };
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Retrieves complete trade history for the user
   */
  async getAllTrades(userId: string, ticker?: string, type?: TransactionType, page: number = 1, limit: number = 50) {
    const user = await this.db.client.user.findUnique({ where: { clerkId: userId } });
    if (!user) return [];

    const portfolio = await this.db.client.portfolio.findUnique({
      where: { userId: user.id },
    });

    if (!portfolio) return [];

    const where: any = { portfolioId: portfolio.id };
    if (type) where.type = type;
    if (ticker) {
      where.stock = { ticker };
    }

    const trades = await this.db.client.transaction.findMany({
      where,
      include: { stock: true },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const uniqueTickers = [...new Set(trades.map((t) => t.stock.ticker))];
    const quotes = uniqueTickers.length > 0 ? await this.stockService.getQuotes(uniqueTickers).catch(() => []) : [];
    const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

    return trades.map((t) => {
        const currentPrice = quoteMap.get(t.stock.ticker)?.price ?? Number(t.price);

        const deltaSinceTrade = Money.subtract(currentPrice, Number(t.price));
        const deltaPercentSinceTrade = Money.calculateReturnPercent(currentPrice, Number(t.price));

        return {
          id: t.id,
          ticker: t.stock.ticker,
          name: t.stock.name,
          sector: t.stock.sector || 'Equities',
          type: t.type,
          orderType: t.orderType,
          quantity: t.quantity,
          price: Number(t.price),
          executedPrice: Number(t.price),
          currentPrice,
          deltaSinceTrade,
          deltaPercentSinceTrade,
          totalValue: Money.multiply(t.quantity, Number(t.price)),
          timestamp: t.timestamp.toISOString(),
        };
      });
  }

  /**
   * Resets virtual portfolio back to clean starting balance of ₹10,00,000
   */
  async resetPortfolio(userId: string) {
    const user = await this.db.client.user.findUnique({
      where: { clerkId: userId },
      include: { portfolio: true },
    });

    if (user && user.portfolio) {
      await this.db.client.$transaction([
        this.db.client.position.deleteMany({
          where: { portfolioId: user.portfolio.id },
        }),
        this.db.client.transaction.deleteMany({
          where: { portfolioId: user.portfolio.id },
        }),
        this.db.client.portfolio.update({
          where: { id: user.portfolio.id },
          data: { availableCash: 1000000 },
        }),
      ]);
    }

    return this.getPortfolio(userId);
  }

  /**
   * AI Risk Guardian: scans user portfolio positions for quantitative exit signals and evidence-constrained narrative
   */
  async getPortfolioSellSignals(userId: string): Promise<any[]> {
    const portfolio = await this.getPortfolio(userId);
    if (!portfolio.positions || portfolio.positions.length === 0) {
      return [];
    }

    const signalResults = await Promise.allSettled(
      portfolio.positions.map(async (pos) => {
        const prediction = await this.predictionService.getPrediction(pos.stock.ticker);
        const currentPrice = pos.currentPrice;
        const isSellDecision = prediction.decision === 'SELL' || prediction.decision === 'STRONG_SELL';
        const isHighDownside = prediction.risk.downsideProbability > 0.65;
        const isStopLossTriggered = currentPrice <= prediction.risk.stopLossPrice;
        const isReduceDecision = prediction.decision === 'REDUCE';

        if (isSellDecision || isHighDownside || isStopLossTriggered || isReduceDecision) {
          const recommendation: 'STRONG_SELL' | 'SELL' | 'REDUCE' =
            isStopLossTriggered || prediction.decision === 'STRONG_SELL' || prediction.risk.downsideProbability > 0.80
              ? 'STRONG_SELL'
              : isReduceDecision
              ? 'REDUCE'
              : 'SELL';

          const urgency: 'HIGH' | 'MEDIUM' | 'LOW' =
            isStopLossTriggered || prediction.risk.downsideProbability > 0.80
              ? 'HIGH'
              : prediction.risk.downsideProbability > 0.65
              ? 'MEDIUM'
              : 'LOW';

          const targetExitPrice = isStopLossTriggered
            ? currentPrice
            : prediction.risk.targetPrice || Money.round(currentPrice * 0.98);

          // Get qualitative explanation strictly constrained to quantitative facts
          const aiNarrative = await this.aiService.evaluatePortfolioSellOpportunity({
            ticker: pos.stock.ticker,
            name: pos.stock.name,
            avgPrice: pos.averagePrice,
            currentPrice: pos.currentPrice,
            unrealizedPnLPercent: pos.overallPnLPercent,
            decision: recommendation,
            urgency,
            targetExitPrice,
            downsideProbability: prediction.risk.downsideProbability,
            stopLossPrice: prediction.risk.stopLossPrice,
            evidence: prediction.evidence.map((e) => e.description).join('; '),
            invalidationConditions: prediction.invalidationConditions,
          });

          return {
            ticker: pos.stock.ticker,
            name: pos.stock.name,
            recommendation,
            urgency,
            currentPrice,
            averagePrice: pos.averagePrice,
            unrealizedPnLPercent: pos.overallPnLPercent,
            downsideProbability: prediction.risk.downsideProbability,
            stopLossPrice: prediction.risk.stopLossPrice,
            targetExitPrice,
            rewardRiskRatio: prediction.risk.rewardRiskRatio,
            confidenceScore: Math.round(prediction.prediction['20d'].calibratedProbability * 100),
            financialReasoning:
              aiNarrative?.financialReasoning ||
              `Quantitative exit rule triggered: ${
                isStopLossTriggered
                  ? `Stop loss breached (₹${prediction.risk.stopLossPrice.toFixed(2)})`
                  : isHighDownside
                  ? `High downside probability (${Math.round(prediction.risk.downsideProbability * 100)}%)`
                  : `Model ${prediction.decision} signal emitted`
              }.`,
            newsImpact:
              aiNarrative?.newsImpact ||
              (prediction.evidence.find((e) => e.type === 'NEWS')?.description || 'No adverse news detected.'),
            gmpAnalysis:
              aiNarrative?.gmpAnalysis ||
              `Market regime: ${prediction.marketRegime}. Momentum alignment in ${pos.stock.sector || 'Equities'}.`,
            invalidationConditions: prediction.invalidationConditions,
          };
        }
        return null;
      })
    );

    return signalResults
      .filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled' && s.value !== null)
      .map((s) => s.value);
  }
}

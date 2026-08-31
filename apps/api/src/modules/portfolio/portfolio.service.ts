import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { AiService } from '../ai/ai.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { TransactionType, OrderType } from 'db';
import { Money } from '../../common/utils/money.util';
import { MODEL_CONFIG } from '../prediction/engines/model-config';
import { PositionRiskState } from '../prediction/prediction.types';

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
  portfolioWeightPercent?: number;
  compositeRiskScore?: number;
  riskState?: PositionRiskState;
  marginalRiskContribution?: number;
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
  sectorConcentrations?: Record<string, number>;
  concentrationAlerts?: string[];
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private autoSellExecutionTracker = new Set<string>();

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
   * Retrieves or initializes the user's paper trading portfolio with real-time live P&L,
   * concentration analytics, and database-persisted auto-sell execution.
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

    // ── DATABASE-HARDENED AUTOMATED STOP-LOSS & TARGET AUTO-EXECUTION ENGINE ──
    const activePositions: typeof portfolio.positions = [];
    let cumulativeCash = Number(portfolio.availableCash);
    const cooldownCutoff = new Date(Date.now() - 60_000); // 1 minute database cooldown

    for (const pos of portfolio.positions) {
      const quote = quoteMap.get(pos.stock.ticker);
      // If quote is missing, fail-closed: do not evaluate auto-sell using averagePrice
      if (!quote || typeof quote.price !== 'number' || quote.price <= 0) {
        activePositions.push(pos);
        continue;
      }

      const currentPrice = quote.price;
      const stopLoss = pos.stopLossPrice ? Number(pos.stopLossPrice) : null;
      const target = pos.targetPrice ? Number(pos.targetPrice) : null;

      const isStopLossHit = stopLoss !== null && currentPrice > 0 && currentPrice <= stopLoss;
      const isTargetHit = target !== null && currentPrice > 0 && currentPrice >= target;

      const memoryKey = `${pos.id}_${isStopLossHit ? 'STOP' : 'TARGET'}_${Math.floor(Date.now() / 30000)}`;

      if ((isStopLossHit || isTargetHit) && !this.autoSellExecutionTracker.has(memoryKey)) {
        // Database-level idempotency verification
        const recentSell = await this.db.client.transaction.findFirst({
          where: {
            portfolioId: portfolio.id,
            stockId: pos.stock.id,
            type: TransactionType.SELL,
            timestamp: { gte: cooldownCutoff },
          },
        }).catch(() => null);

        if (!recentSell) {
          this.autoSellExecutionTracker.add(memoryKey);
          const reason = isStopLossHit ? 'AUTO_STOP_LOSS' : 'AUTO_TARGET_PROFIT';
          const totalProceeds = Money.multiply(pos.quantity, currentPrice);
          const nextCash = Money.add(cumulativeCash, totalProceeds);

          try {
            await this.db.client.$transaction([
              this.db.client.position.delete({
                where: { id: pos.id },
              }),
              this.db.client.portfolio.update({
                where: { id: portfolio.id },
                data: {
                  availableCash: nextCash,
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

            cumulativeCash = nextCash;
            this.logger.log(`🛡️ Auto-Executed ${reason} for ${pos.stock.ticker}: Sold ${pos.quantity} shares @ ₹${currentPrice}`);
          } catch (err) {
            this.logger.error(`Failed to auto-execute ${reason} for ${pos.stock.ticker}:`, err);
            activePositions.push(pos);
          }
        } else {
          activePositions.push(pos);
        }
      } else {
        activePositions.push(pos);
      }
    }

    const currentCash = cumulativeCash;

    const hydratedPositions: PortfolioPositionWithLiveMetrics[] = activePositions.map((pos) => {
      const quote = quoteMap.get(pos.stock.ticker);
      const isQuoteAvailable = Boolean(quote && typeof quote.price === 'number' && quote.price > 0);
      const currentPrice = isQuoteAvailable ? quote!.price : Number(pos.averagePrice);
      const dayChange = isQuoteAvailable ? quote!.change : 0;
      const dayChangePercent = isQuoteAvailable ? quote!.changePercent : 0;
      const prevClose = isQuoteAvailable ? (quote!.prevClose || quote!.price - quote!.change) : Number(pos.averagePrice);

      const investedValue = Money.multiply(pos.quantity, Number(pos.averagePrice));
      const currentValue = isQuoteAvailable ? Money.multiply(pos.quantity, currentPrice) : investedValue;
      const overallPnL = isQuoteAvailable ? Money.subtract(currentValue, investedValue) : 0;
      const overallPnLPercent = isQuoteAvailable ? Money.calculateReturnPercent(currentValue, investedValue) : 0;
      const todayPnL = isQuoteAvailable ? Money.multiply(pos.quantity, currentPrice - prevClose) : 0;

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

    // ── Position-Aware Concentration & Weight Analytics ──
    const sectorTotals: Record<string, number> = {};
    const concentrationAlerts: string[] = [];

    hydratedPositions.forEach((p) => {
      const weight = totalPortfolioValue > 0 ? (p.currentValue / totalPortfolioValue) * 100 : 0;
      p.portfolioWeightPercent = parseFloat(weight.toFixed(1));

      const sec = p.stock.sector || 'General';
      sectorTotals[sec] = (sectorTotals[sec] || 0) + p.currentValue;

      // Marginal Risk Contribution requires covariance matrix / realized asset volatility.
      // Do NOT substitute an arbitrary 20% constant as volatility.
      p.marginalRiskContribution = undefined;

      if (weight >= MODEL_CONFIG.RISK.POSITION_CONCENTRATION_LIMIT * 100) {
        concentrationAlerts.push(`High position concentration in ${p.stock.ticker} (${weight.toFixed(1)}% of total portfolio)`);
      }
    });

    const sectorConcentrations: Record<string, number> = {};
    for (const [sec, val] of Object.entries(sectorTotals)) {
      const secPct = totalPortfolioValue > 0 ? (val / totalPortfolioValue) * 100 : 0;
      sectorConcentrations[sec] = parseFloat(secPct.toFixed(1));
      if (secPct >= MODEL_CONFIG.RISK.SECTOR_CONCENTRATION_LIMIT * 100) {
        concentrationAlerts.push(`High sector concentration in ${sec} (${secPct.toFixed(1)}% of total portfolio)`);
      }
    }

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
      sectorConcentrations,
      concentrationAlerts,
    };
  }

  /**
   * Executes atomic paper trade (BUY or SELL) with database transaction and balance validation
   */
  async executeTrade(
    userId: string,
    rawTicker: string,
    type: TransactionType,
    quantity: number,
    orderType: OrderType = OrderType.MARKET,
    idempotencyKey?: string,
  ) {
    if (!quantity || quantity <= 0) {
      throw new BadRequestException('Order quantity must be a positive integer');
    }

    const ticker = (!rawTicker.startsWith('^') && !rawTicker.endsWith('.NS') && !rawTicker.endsWith('.BO'))
      ? `${rawTicker.trim().toUpperCase()}.NS`
      : rawTicker.trim().toUpperCase();

    // 0. Idempotency Pre-flight Verification
    let canonicalPayloadHash = '';
    if (idempotencyKey) {
      const payloadStr = JSON.stringify({
        ticker,
        type,
        quantity,
        orderType,
      });
      canonicalPayloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');

      const existingRecord = await this.db.client.idempotencyRecord.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey,
          },
        },
      });

      if (existingRecord) {
        if (existingRecord.canonicalPayloadHash !== canonicalPayloadHash) {
          throw new ConflictException(
            `Idempotency Conflict: Key '${idempotencyKey}' was already executed with a different trade payload.`
          );
        }
        if (existingRecord.status === 'COMPLETED' && existingRecord.result) {
          return { ...(existingRecord.result as any), isDuplicate: true };
        }
      }
    }

    // 1. Fetch live market price
    const quote = await this.stockService.getQuote(ticker);
    const executionPrice = quote.price;
    const totalCost = Money.multiply(quantity, executionPrice);

    // 2. Ensure stock record exists in DB
    let stock = await this.db.client.stock.findFirst({
      where: {
        OR: [
          { ticker },
          { ticker: ticker.replace('.NS', '') },
          { ticker: rawTicker.trim().toUpperCase() },
        ],
      },
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

    // 3. Quantitative Stop-Loss & Target if BUY order
    let autoStopLossPrice: number | null = null;
    let autoTargetPrice: number | null = null;

    if (type === TransactionType.BUY) {
      try {
        const prediction = await this.predictionService.getPrediction(ticker);
        if (prediction?.risk?.stopLossPrice && prediction.risk.stopLossPrice < executionPrice) {
          autoStopLossPrice = prediction.risk.stopLossPrice;
        }
        if (prediction?.risk?.targetPrice && prediction.risk.targetPrice > executionPrice) {
          autoTargetPrice = prediction.risk.targetPrice;
        }
      } catch {
        this.logger.warn(`Could not compute live prediction risk bounds for ${ticker}.`);
      }
    }

    // 4. Ensure user exists
    const user = await this.db.client.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      throw new NotFoundException('User could not be found or initialized');
    }

    // 5. Atomic Execution inside Prisma Transaction
    return await this.db.client.$transaction(async (tx) => {
      // Cross-process atomic reservation of idempotency key
      if (idempotencyKey) {
        const existingRecord = await tx.idempotencyRecord.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey,
            },
          },
        });

        if (existingRecord) {
          if (existingRecord.canonicalPayloadHash !== canonicalPayloadHash) {
            throw new ConflictException(
              `Idempotency Conflict: Key '${idempotencyKey}' was already executed with a different trade payload.`
            );
          }
          if (existingRecord.status === 'COMPLETED' && existingRecord.result) {
            return { ...(existingRecord.result as any), isDuplicate: true };
          }
          if (existingRecord.status === 'PENDING') {
            throw new ConflictException(
              `Idempotency In-Flight: Request with key '${idempotencyKey}' is currently processing.`
            );
          }
        } else {
          // Atomically insert PENDING state
          await tx.idempotencyRecord.create({
            data: {
              userId,
              idempotencyKey,
              operation: `PAPER_${type}`,
              canonicalPayloadHash,
              status: 'PENDING',
            },
          });
        }
      }

      const portfolio = await tx.portfolio.findUnique({
        where: { userId: user.id },
        include: { positions: { include: { stock: true } } },
      });

      if (!portfolio) {
        throw new NotFoundException('Portfolio could not be found or initialized');
      }

      const existingPosition = portfolio.positions.find(
        (p) =>
          p.stockId === stock!.id ||
          p.stock.ticker === ticker ||
          p.stock.ticker === rawTicker ||
          p.stock.ticker.replace('.NS', '') === ticker.replace('.NS', '')
      );

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

        // Update or create position
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
          stockId: existingPosition ? existingPosition.stockId : stock!.id,
          type,
          orderType,
          quantity,
          price: executionPrice,
        },
      });

      const responseData = {
        success: true,
        message: `Simulated ${type} order for ${quantity} shares of ${ticker} executed successfully at ₹${executionPrice.toFixed(2)}`,
        transactionId: transaction.id,
        ticker,
        type,
        quantity,
        executionPrice,
        totalCost,
      };

      if (idempotencyKey) {
        await tx.idempotencyRecord.upsert({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey,
            },
          },
          update: {
            status: 'COMPLETED',
            transactionId: transaction.id,
            completedAt: new Date(),
            result: responseData,
          },
          create: {
            userId,
            idempotencyKey,
            operation: `PAPER_${type}`,
            canonicalPayloadHash,
            transactionId: transaction.id,
            status: 'COMPLETED',
            completedAt: new Date(),
            result: responseData,
          },
        });
      }

      return responseData;
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
   * AI Risk Guardian: scans user portfolio positions for multi-dimensional exit signals,
   * continuous RiskScore (0-100), dynamic states, and portfolio-aware concentration risks.
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
        const isHighDownside = prediction.risk.downsideProbability > 0.60;
        const isStopLossTriggered = currentPrice <= prediction.risk.stopLossPrice;
        const isTargetReached = pos.targetPrice ? currentPrice >= pos.targetPrice : false;
        const isReduceDecision = prediction.decision === 'REDUCE';

        const riskScore = prediction.risk.compositeRiskScore || Math.round(prediction.risk.downsideProbability * 100);
        const isRiskScoreElevated = riskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.HIGH_RISK;
        const isEmergency = prediction.risk.riskState === 'EMERGENCY';

        if (
          isSellDecision ||
          isHighDownside ||
          isStopLossTriggered ||
          isTargetReached ||
          isReduceDecision ||
          isRiskScoreElevated ||
          isEmergency
        ) {
          const recommendation: 'STRONG_SELL' | 'SELL' | 'TAKE_PROFIT' | 'REDUCE' =
            isTargetReached
              ? 'TAKE_PROFIT'
              : isStopLossTriggered || isEmergency || prediction.decision === 'STRONG_SELL' || riskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.EXIT
              ? 'STRONG_SELL'
              : isReduceDecision
              ? 'REDUCE'
              : 'SELL';

          const urgency: 'HIGH' | 'MEDIUM' | 'LOW' =
            isStopLossTriggered || isEmergency || riskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.EXIT
              ? 'HIGH'
              : riskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.HIGH_RISK || isHighDownside
              ? 'MEDIUM'
              : 'LOW';

          const targetExitPrice = isStopLossTriggered
            ? currentPrice
            : isTargetReached
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
            quantity: pos.quantity,
            quantityHeld: pos.quantity,
            investedValue: pos.investedValue,
            currentValue: pos.currentValue,
            pnl: pos.overallPnL,
            pnlPercent: pos.overallPnLPercent,
            decision: recommendation,
            recommendation,
            recommendedAction: recommendation,
            urgency,
            currentPrice,
            averagePrice: pos.averagePrice,
            unrealizedPnLPercent: pos.overallPnLPercent,
            downsideProbability: Math.round(prediction.risk.downsideProbability * 100),
            exitProbability: Math.round(prediction.risk.downsideProbability * 100),
            compositeRiskScore: riskScore,
            riskState: prediction.risk.riskState || (riskScore >= 85 ? 'EXIT' : riskScore >= 65 ? 'HIGH_RISK' : 'CAUTION'),
            portfolioWeightPercent: pos.portfolioWeightPercent || 0,
            marginalRiskContribution: pos.marginalRiskContribution || 0,
            stopLossPrice: prediction.risk.stopLossPrice,
            targetExitPrice,
            targetPrice: targetExitPrice,
            rewardRiskRatio: prediction.risk.rewardRiskRatio,
            confidenceScore: Math.round(prediction.prediction['20d'].calibratedProbability * 100),
            financialReasoning:
              aiNarrative?.financialReasoning ||
              `Risk Guardian exit threshold reached (Risk Score: ${riskScore}/100): ${
                isStopLossTriggered
                  ? `Trailing stop loss breached at ₹${prediction.risk.stopLossPrice.toFixed(2)}`
                  : isTargetReached
                  ? `Profit target achieved at ₹${pos.targetPrice?.toFixed(2)}`
                  : isHighDownside
                  ? `Elevated downside probability (${Math.round(prediction.risk.downsideProbability * 100)}%)`
                  : `Model ${prediction.decision} signal emitted`
              }.`,
            newsImpact:
              aiNarrative?.newsImpact ||
              (prediction.evidence.find((e) => e.type === 'NEWS')?.description || 'No adverse news detected.'),
            gmpAnalysis:
              aiNarrative?.gmpAnalysis ||
              `Market regime: ${prediction.marketRegime}. Sector allocation in ${pos.stock.sector || 'Equities'}.`,
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

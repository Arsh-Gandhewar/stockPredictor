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

import { TransactionCostEngine } from '../prediction/engines/transaction-costs';

export type TransactionReason =
  | 'MANUAL_TRADE'
  | 'AUTO_STOP_LOSS'
  | 'AUTO_TARGET_PROFIT'
  | 'PORTFOLIO_REBALANCE'
  | 'RISK_LIQUIDATION'
  | 'SYSTEM_INITIALIZATION';

export const VALID_TRANSACTION_REASONS = new Set<string>([
  'MANUAL_TRADE',
  'AUTO_STOP_LOSS',
  'AUTO_TARGET_PROFIT',
  'PORTFOLIO_REBALANCE',
  'RISK_LIQUIDATION',
  'SYSTEM_INITIALIZATION',
]);

export interface PortfolioPositionWithLiveMetrics {
  id: string;
  portfolioId: string;
  stockId: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number | null;
  priceStatus?: 'LIVE' | 'UNAVAILABLE';
  dayChange: number | null;
  dayChangePercent: number | null;
  investedValue: number;
  currentValue: number | null;
  todayPnL: number | null;
  overallPnL: number | null;
  overallPnLPercent: number | null;
  stopLossPrice: number | null;
  targetPrice: number | null;
  portfolioWeightPercent?: number | null;
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
  cashStatus: 'AVAILABLE';
  valuationStatus: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  portfolioValueStatus: 'VALUED' | 'UNAVAILABLE';
  unvaluedPositionsCount: number;
  positions: PortfolioPositionWithLiveMetrics[];
  totalInvested: number;
  totalCurrentValue: number | null;
  totalPortfolioValue: number | null;
  totalTodayPnL: number | null;
  totalTodayPnLPercent: number | null;
  totalOverallPnL: number | null;
  totalOverallPnLPercent: number | null;
  sectorConcentrations?: Record<string, number>;
  concentrationAlerts?: string[];
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly costEngine = new TransactionCostEngine('BASE_COST');

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

    // Pure Read-Only Portfolio Evaluation (Zero Side-Effects on GET)
    const currentCash = Number(portfolio.availableCash);

    let unvaluedPositionsCount = 0;

    const hydratedPositions: PortfolioPositionWithLiveMetrics[] = portfolio.positions.map((pos) => {
      const quote = quoteMap.get(pos.stock.ticker);
      const isQuoteAvailable = Boolean(quote && typeof quote.price === 'number' && quote.price > 0);

      const investedValue = Money.multiply(pos.quantity, Number(pos.averagePrice));
      totalInvested = Money.add(totalInvested, investedValue);

      if (!isQuoteAvailable) {
        unvaluedPositionsCount++;
        return {
          id: pos.id,
          portfolioId: pos.portfolioId,
          stockId: pos.stockId,
          quantity: pos.quantity,
          averagePrice: Number(pos.averagePrice),
          currentPrice: null,
          priceStatus: 'UNAVAILABLE',
          dayChange: null,
          dayChangePercent: null,
          investedValue,
          currentValue: null,
          todayPnL: null,
          overallPnL: null,
          overallPnLPercent: null,
          stopLossPrice: pos.stopLossPrice ? Number(pos.stopLossPrice) : null,
          targetPrice: pos.targetPrice ? Number(pos.targetPrice) : null,
          portfolioWeightPercent: null,
          stock: {
            id: pos.stock.id,
            ticker: pos.stock.ticker,
            name: pos.stock.name,
            sector: pos.stock.sector,
            exchange: pos.stock.exchange,
          },
        };
      }

      const currentPrice = quote!.price;
      const dayChange = quote!.change || 0;
      const dayChangePercent = quote!.changePercent || 0;
      const prevClose = quote!.prevClose || quote!.price - dayChange;

      const currentValue = Money.multiply(pos.quantity, currentPrice);
      const overallPnL = Money.subtract(currentValue, investedValue);
      const overallPnLPercent = Money.calculateReturnPercent(currentValue, investedValue);
      const todayPnL = Money.multiply(pos.quantity, currentPrice - prevClose);

      totalCurrentValue = Money.add(totalCurrentValue, currentValue);
      totalTodayPnL = Money.add(totalTodayPnL, todayPnL);

      return {
        id: pos.id,
        portfolioId: pos.portfolioId,
        stockId: pos.stockId,
        quantity: pos.quantity,
        averagePrice: Number(pos.averagePrice),
        currentPrice,
        priceStatus: 'LIVE',
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

    const isCompleteValuation = unvaluedPositionsCount === 0;

    const totalOverallPnL = isCompleteValuation ? Money.subtract(totalCurrentValue, totalInvested) : null;
    const totalOverallPnLPercent = isCompleteValuation ? Money.calculateReturnPercent(totalCurrentValue, totalInvested) : null;
    const totalPortfolioValue = isCompleteValuation ? Money.add(currentCash, totalCurrentValue) : null;
    const totalTodayPnLPercent = (isCompleteValuation && totalPortfolioValue !== null && totalPortfolioValue > 0)
      ? Money.round((totalTodayPnL / totalPortfolioValue) * 100)
      : null;

    // ── Position-Aware Concentration & Weight Analytics ──
    const sectorTotals: Record<string, number> = {};
    const concentrationAlerts: string[] = [];

    hydratedPositions.forEach((p) => {
      if (totalPortfolioValue !== null && totalPortfolioValue > 0 && p.currentValue !== null) {
        const weight = (p.currentValue / totalPortfolioValue) * 100;
        p.portfolioWeightPercent = parseFloat(weight.toFixed(1));
        if (weight >= MODEL_CONFIG.RISK.POSITION_CONCENTRATION_LIMIT * 100) {
          concentrationAlerts.push(`High position concentration in ${p.stock.ticker} (${weight.toFixed(1)}% of total portfolio)`);
        }
      } else {
        p.portfolioWeightPercent = null;
      }

      if (p.currentValue !== null) {
        const sec = p.stock.sector || 'General';
        sectorTotals[sec] = (sectorTotals[sec] || 0) + p.currentValue;
      }

      p.marginalRiskContribution = undefined;
    });

    const sectorConcentrations: Record<string, number> = {};
    if (totalPortfolioValue !== null && totalPortfolioValue > 0) {
      for (const [sec, val] of Object.entries(sectorTotals)) {
        const secPct = (val / totalPortfolioValue) * 100;
        sectorConcentrations[sec] = parseFloat(secPct.toFixed(1));
        if (secPct >= MODEL_CONFIG.RISK.SECTOR_CONCENTRATION_LIMIT * 100) {
          concentrationAlerts.push(`High sector concentration in ${sec} (${secPct.toFixed(1)}% of total portfolio)`);
        }
      }
    }

    const valuationStatus: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' =
      unvaluedPositionsCount === 0
        ? 'COMPLETE'
        : unvaluedPositionsCount === hydratedPositions.length
        ? 'UNAVAILABLE'
        : 'PARTIAL';

    const portfolioValueStatus: 'VALUED' | 'UNAVAILABLE' = isCompleteValuation ? 'VALUED' : 'UNAVAILABLE';

    return {
      id: portfolio.id,
      userId: portfolio.userId,
      availableCash: Money.round(currentCash),
      cashStatus: 'AVAILABLE',
      valuationStatus,
      portfolioValueStatus,
      unvaluedPositionsCount,
      positions: hydratedPositions,
      totalInvested: Money.round(totalInvested),
      totalCurrentValue: isCompleteValuation ? Money.round(totalCurrentValue) : null,
      totalPortfolioValue: totalPortfolioValue !== null ? Money.round(totalPortfolioValue) : null,
      totalTodayPnL: isCompleteValuation ? Money.round(totalTodayPnL) : null,
      totalTodayPnLPercent,
      totalOverallPnL: totalOverallPnL !== null ? Money.round(totalOverallPnL) : null,
      totalOverallPnLPercent,
      sectorConcentrations,
      concentrationAlerts,
    };
  }

  /**
   * Explicit Auto-Sell Evaluation and Execution Worker.
   * Decoupled from read-only getPortfolio queries to honor HTTP idempotency and safety.
   * Executes stop-loss and take-profit sales atomically with explicit exit reasons and OrderType.MARKET.
   */
  async evaluateAndExecuteAutoSell(userId: string) {
    const portfolio = await this.db.client.portfolio.findFirst({
      where: {
        OR: [
          { userId },
          { user: { clerkId: userId } },
        ],
      },
      include: {
        positions: {
          include: {
            stock: true,
          },
        },
      },
    });

    if (!portfolio || portfolio.positions.length === 0) {
      return { executedTrades: [] };
    }

    const tickers = portfolio.positions.map((p) => p.stock.ticker);
    const quotes = await this.stockService.getQuotes(tickers).catch(() => []);
    const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

    const executedTrades: any[] = [];
    let cumulativeCash = Number(portfolio.availableCash);

    for (const pos of portfolio.positions) {
      const quote = quoteMap.get(pos.stock.ticker);
      if (!quote || typeof quote.price !== 'number' || quote.price <= 0) {
        continue;
      }

      const currentPrice = quote.price;
      const quoteTimestamp = (quote as any).timestamp ? new Date((quote as any).timestamp) : null;

      // Item 8: Quote freshness is not equivalent to quote availability.
      // Do not trigger auto-sell on stale or unverified quotes.
      const MAX_AUTO_SELL_QUOTE_AGE_MS = 15 * 60 * 1000; // 15 minutes
      if (!quoteTimestamp || (Date.now() - quoteTimestamp.getTime() > MAX_AUTO_SELL_QUOTE_AGE_MS)) {
        this.logger.warn(
          `AUTO_SELL_QUOTE_STALE: Ticker ${pos.stock.ticker} quote is stale or missing timestamp (${quoteTimestamp?.toISOString() || 'none'}). Auto-sell skipped.`
        );
        continue;
      }

      const stopLoss = pos.stopLossPrice ? Number(pos.stopLossPrice) : null;
      const target = pos.targetPrice ? Number(pos.targetPrice) : null;

      const isStopLossHit = stopLoss !== null && currentPrice > 0 && currentPrice <= stopLoss;
      const isTargetHit = target !== null && currentPrice > 0 && currentPrice >= target;

      if (!isStopLossHit && !isTargetHit) {
        continue;
      }

      const reason: TransactionReason = isStopLossHit ? 'AUTO_STOP_LOSS' : 'AUTO_TARGET_PROFIT';
      const triggerCondition = isStopLossHit
        ? `PRICE_${currentPrice} <= STOP_LOSS_${stopLoss}`
        : `PRICE_${currentPrice} >= TARGET_${target}`;

      // Calculate side-specific execution costs (brokerage, STT, exchange, GST, sebi, slippage)
      const costExecution = this.costEngine.calculateSellExecution(pos.quantity, currentPrice);
      const executionTimestamp = new Date();

      // Canonical Risk Trigger Event Identifier represents the discrete state transition on the position's risk lifecycle
      // (position ID + position risk epoch + trigger type) rather than mutable market quote prices or worker polling timestamps.
      const positionRiskEpoch = pos.createdAt ? new Date(pos.createdAt).toISOString() : (pos.updatedAt ? new Date(pos.updatedAt).toISOString() : '0');
      const triggerEventId = `RISK_EVENT_${pos.id}_${positionRiskEpoch}_${reason}`;
      const idempotencyKey = triggerEventId;
      const canonicalPayloadHash = crypto
        .createHash('sha256')
        .update(`POSITION:${pos.id}:TICKER:${pos.stock.ticker}:QTY:${pos.quantity}:AVG_BUY:${pos.avgBuyPrice}:REASON:${reason}:EPOCH:${positionRiskEpoch}`)
        .digest('hex');

      try {
        const tradeResult = await this.db.client.$transaction(async (tx) => {
          // 1. Verify position exists and has not already been liquidated by another concurrent worker
          const currentPos = await tx.position.findUnique({
            where: { id: pos.id },
          });

          if (!currentPos || currentPos.quantity <= 0) {
            this.logger.warn(`AUTO_SELL_SKIPPED: Position ${pos.id} (${pos.stock.ticker}) was already closed.`);
            return null;
          }

          // 2. Register durable idempotency reservation
          try {
            await tx.idempotencyRecord.create({
              data: {
                userId: portfolio.userId,
                idempotencyKey,
                operation: `AUTO_SELL_${reason}`,
                canonicalPayloadHash,
                status: 'PENDING',
              },
            });
          } catch (err: any) {
            // Item 7: On unique constraint violation (P2002), verify payload hash against existing record
            if (err?.code === 'P2002') {
              const existingRecord = await tx.idempotencyRecord.findUnique({
                where: {
                  userId_idempotencyKey: {
                    userId: portfolio.userId,
                    idempotencyKey,
                  },
                },
              });

              if (existingRecord) {
                if (existingRecord.canonicalPayloadHash !== canonicalPayloadHash) {
                  throw new ConflictException(
                    `Idempotency Conflict: Auto-sell key '${idempotencyKey}' was registered with a different payload.`
                  );
                }
                this.logger.warn(`AUTO_SELL_IDEMPOTENT_BLOCK: Auto-sell ${idempotencyKey} already registered with matching payload.`);
                return null;
              }
            }
            // Fail closed on any other unexpected DB or connectivity error
            throw err;
          }

          // 3. Remove position
          await tx.position.delete({
            where: { id: pos.id },
          });

          // 4. Atomic cash increment (prevents lost updates across concurrent workers)
          const netProceeds = Money.round(costExecution.netProceeds);
          await tx.portfolio.update({
            where: { id: portfolio.id },
            data: {
              availableCash: { increment: netProceeds },
            },
          });

          // 5. Create transaction record with lineage - storing realized adverse executionPrice
          const txRecord = await tx.transaction.create({
            data: {
              portfolioId: portfolio.id,
              stockId: pos.stock.id,
              type: TransactionType.SELL,
              orderType: OrderType.MARKET,
              quantity: pos.quantity,
              price: costExecution.executionPrice,
              reason,
            },
          });

          // 6. Complete idempotency record
          await tx.idempotencyRecord.update({
            where: {
              userId_idempotencyKey: {
                userId: portfolio.userId,
                idempotencyKey,
              },
            },
            data: {
              status: 'COMPLETED',
              transactionId: txRecord.id,
              completedAt: executionTimestamp,
              result: {
                stock: pos.stock.ticker,
                quantity: pos.quantity,
                quotePrice: currentPrice,
                executionPrice: costExecution.executionPrice,
                slippageRate: costExecution.slippageRate,
                slippage: costExecution.slippage,
                grossProceeds: costExecution.notional,
                totalCosts: costExecution.totalCosts,
                netProceeds,
                reason,
                triggerCondition,
                quoteTimestamp: (quote as any).timestamp ? quoteTimestamp.toISOString() : null,
                executionTimestamp: executionTimestamp.toISOString(),
              },
            },
          });

          return {
            stock: pos.stock.ticker,
            quantity: pos.quantity,
            executionPrice: currentPrice,
            grossProceeds: costExecution.notional,
            totalCosts: costExecution.totalCosts,
            netProceeds,
            reason,
            triggerCondition,
            quoteTimestamp: quoteTimestamp.toISOString(),
            executionTimestamp: executionTimestamp.toISOString(),
          };
        });

        if (tradeResult) {
          executedTrades.push(tradeResult);
          this.logger.log(
            `🛡️ Auto-Executed ${reason} for ${pos.stock.ticker}: Sold ${pos.quantity} shares @ ₹${currentPrice} (Net Proceeds: ₹${tradeResult.netProceeds}, Friction: ₹${tradeResult.totalCosts.toFixed(2)})`
          );
        }
      } catch (err) {
        this.logger.error(`Failed to auto-execute ${reason} for ${pos.stock.ticker}:`, err);
      }
    }

    return { executedTrades };
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
        try {
          // Attempt atomic reservation via direct insert
          await tx.idempotencyRecord.create({
            data: {
              userId,
              idempotencyKey,
              operation: `PAPER_${type}`,
              canonicalPayloadHash,
              status: 'PENDING',
            },
          });
        } catch (err: any) {
          // Unique constraint violation (P2002) means another process or request already registered this key
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
          }
          throw err;
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
          reason: 'MANUAL_TRADE',
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

        if (currentPrice === null || pos.overallPnLPercent === null) {
          // Live metrics unavailable for this position; cannot evaluate price-based signals safely
          return null;
        }

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

          const targetExitPrice: number | undefined = isStopLossTriggered
            ? currentPrice
            : isTargetReached
            ? currentPrice
            : prediction.risk.targetPrice || Money.round(currentPrice * 0.98);

          // Get qualitative explanation strictly constrained to quantitative facts
          const aiNarrative = await this.aiService.evaluatePortfolioSellOpportunity({
            ticker: pos.stock.ticker,
            name: pos.stock.name,
            avgPrice: pos.averagePrice,
            currentPrice,
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

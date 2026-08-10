import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { AiService } from '../ai/ai.service';
import { TransactionType, OrderType } from 'db';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stockService: StockService,
    private readonly aiService: AiService
  ) {}

  /**
   * Initialize a portfolio for a new user with 1,000,000 INR
   */
  async createPortfolio(userId: string) {
    await this.db.client.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        clerkId: `clerk_${userId}`,
        email: `${userId}@example.com`,
      }
    });

    const created = await this.db.client.portfolio.create({
      data: {
        userId,
        availableCash: 1000000, // ₹10,00,000
      }
    });

    return { ...created, positions: [] };
  }

  async getPortfolio(userId: string) {
    let portfolio = await this.db.client.portfolio.findUnique({
      where: { userId },
      include: {
        positions: {
          include: { stock: true }
        }
      }
    });

    if (!portfolio) {
      portfolio = await this.createPortfolio(userId) as any;
    }

    if (!portfolio) {
      throw new NotFoundException('Could not load or initialize portfolio');
    }

    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalTodayPnL = 0;

    const enrichedPositions = await Promise.all(
      portfolio.positions.map(async (pos) => {
        let currentPrice = pos.averagePrice;
        let dayChange = 0;
        let dayChangePercent = 0;
        let name = pos.stock?.name || pos.stock?.ticker || 'Equity';

        try {
          const quote = await this.stockService.getQuote(pos.stock.ticker);
          if (quote && quote.price) {
            currentPrice = quote.price;
            dayChange = quote.change || 0;
            dayChangePercent = quote.changePercent || 0;
            name = quote.name || name;
          }
        } catch (e) {
          // Fallback to average price if quote unavailable
        }

        const investedValue = pos.quantity * pos.averagePrice;
        const currentValue = pos.quantity * currentPrice;
        const todayPnL = pos.quantity * dayChange;
        const overallPnL = currentValue - investedValue;
        const overallPnLPercent = investedValue > 0 ? (overallPnL / investedValue) * 100 : 0;

        totalInvested += investedValue;
        totalCurrentValue += currentValue;
        totalTodayPnL += todayPnL;

        return {
          ...pos,
          stock: {
            ...pos.stock,
            name,
          },
          currentPrice,
          dayChange,
          dayChangePercent,
          investedValue: parseFloat(investedValue.toFixed(2)),
          currentValue: parseFloat(currentValue.toFixed(2)),
          todayPnL: parseFloat(todayPnL.toFixed(2)),
          overallPnL: parseFloat(overallPnL.toFixed(2)),
          overallPnLPercent: parseFloat(overallPnLPercent.toFixed(2)),
        };
      })
    );

    const totalPortfolioValue = portfolio.availableCash + totalCurrentValue;
    const totalOverallPnL = totalCurrentValue - totalInvested;
    const totalOverallPnLPercent = totalInvested > 0 ? (totalOverallPnL / totalInvested) * 100 : 0;
    const totalTodayPnLPercent = totalInvested > 0 ? (totalTodayPnL / totalInvested) * 100 : 0;

    return {
      ...portfolio,
      positions: enrichedPositions,
      totalInvested: parseFloat(totalInvested.toFixed(2)),
      totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
      totalPortfolioValue: parseFloat(totalPortfolioValue.toFixed(2)),
      totalTodayPnL: parseFloat(totalTodayPnL.toFixed(2)),
      totalTodayPnLPercent: parseFloat(totalTodayPnLPercent.toFixed(2)),
      totalOverallPnL: parseFloat(totalOverallPnL.toFixed(2)),
      totalOverallPnLPercent: parseFloat(totalOverallPnLPercent.toFixed(2)),
    };
  }

  /**
   * Retrieves all-time historical trade transactions for a user with rich analytics
   */
  async getAllTrades(userId: string, ticker?: string, type?: TransactionType) {
    const portfolio = await this.getPortfolio(userId);
    if (!portfolio) {
      return { trades: [], summary: { totalTrades: 0, totalTurnover: 0, totalBuyVolume: 0, totalSellVolume: 0 } };
    }

    const whereClause: any = { portfolioId: portfolio.id };
    if (type) {
      whereClause.type = type;
    }
    if (ticker) {
      whereClause.stock = { ticker: ticker.toUpperCase() };
    }

    const transactions = await this.db.client.transaction.findMany({
      where: whereClause,
      include: {
        stock: true,
      },
      orderBy: { timestamp: 'desc' },
    });

    // Compute all-time trade analytics
    let totalTurnover = 0;
    let totalBuyVolume = 0;
    let totalSellVolume = 0;
    let totalBuyCount = 0;
    let totalSellCount = 0;
    const tickerActivity: Record<string, { ticker: string; name: string; count: number; volume: number; turnover: number }> = {};

    const enrichedTrades = await Promise.all(
      transactions.map(async (tx: any) => {
        const tradeValue = tx.quantity * tx.price;
        totalTurnover += tradeValue;

        if (tx.type === TransactionType.BUY) {
          totalBuyVolume += tx.quantity;
          totalBuyCount += 1;
        } else {
          totalSellVolume += tx.quantity;
          totalSellCount += 1;
        }

        const tTicker = tx.stock?.ticker || 'UNKNOWN';
        if (!tickerActivity[tTicker]) {
          tickerActivity[tTicker] = {
            ticker: tTicker,
            name: tx.stock?.name || tTicker,
            count: 0,
            volume: 0,
            turnover: 0,
          };
        }
        tickerActivity[tTicker].count += 1;
        tickerActivity[tTicker].volume += tx.quantity;
        tickerActivity[tTicker].turnover += tradeValue;

        // Fetch current quote for performance analysis since execution
        let currentPrice = tx.price;
        try {
          const q = await this.stockService.getQuote(tTicker).catch(() => null);
          if (q && q.price) currentPrice = q.price;
        } catch {
          // fallback to tx price
        }

        const deltaSinceTrade = currentPrice - tx.price;
        const deltaPercentSinceTrade = tx.price > 0 ? (deltaSinceTrade / tx.price) * 100 : 0;

        return {
          id: tx.id,
          ticker: tTicker,
          name: tx.stock?.name || tTicker,
          sector: tx.stock?.sector || 'General',
          type: tx.type,
          orderType: tx.orderType,
          quantity: tx.quantity,
          executedPrice: tx.price,
          totalValue: tradeValue,
          timestamp: tx.timestamp.toISOString(),
          currentPrice,
          deltaSinceTrade: Number(deltaSinceTrade.toFixed(2)),
          deltaPercentSinceTrade: Number(deltaPercentSinceTrade.toFixed(2)),
        };
      })
    );

    const topTraded = Object.values(tickerActivity)
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 5);

    return {
      trades: enrichedTrades,
      summary: {
        totalTrades: transactions.length,
        totalTurnover: Number(totalTurnover.toFixed(2)),
        totalBuyCount,
        totalSellCount,
        totalBuyVolume,
        totalSellVolume,
        topTraded,
      },
    };
  }

  async executeTrade(userId: string, ticker: string, type: TransactionType, quantity: number, orderType: OrderType = OrderType.MARKET) {
    if (quantity <= 0) throw new BadRequestException('Quantity must be greater than 0');
    
    const stock = await this.db.client.stock.findUnique({ where: { ticker } });
    if (!stock) throw new NotFoundException('Stock not found');

    const portfolio = await this.getPortfolio(userId);
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    // Fetch real-time price
    const quote = await this.stockService.getLatestQuote(ticker);
    const currentPrice = (quote as any)?.price || (quote as any)?.regularMarketPrice;
    if (!currentPrice) throw new BadRequestException('Could not fetch real-time price for ' + ticker);

    const totalValue = currentPrice * quantity;

    if (type === TransactionType.BUY) {
      if (portfolio.availableCash < totalValue) {
        throw new BadRequestException('Insufficient funds');
      }

      // Execute BUY
      await this.db.client.$transaction(async (tx: any) => {
        // Deduct cash
        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: { availableCash: { decrement: totalValue } }
        });

        // Record transaction
        await tx.transaction.create({
          data: {
            portfolioId: portfolio.id,
            stockId: stock.id,
            type: TransactionType.BUY,
            orderType,
            quantity,
            price: currentPrice
          }
        });

        // Update Position
        const existingPosition = await tx.position.findUnique({
          where: { portfolioId_stockId: { portfolioId: portfolio.id, stockId: stock.id } }
        });

        if (existingPosition) {
          const newQuantity = existingPosition.quantity + quantity;
          const newAvgPrice = ((existingPosition.averagePrice * existingPosition.quantity) + totalValue) / newQuantity;
          await tx.position.update({
            where: { id: existingPosition.id },
            data: { quantity: newQuantity, averagePrice: newAvgPrice }
          });
        } else {
          await tx.position.create({
            data: {
              portfolioId: portfolio.id,
              stockId: stock.id,
              quantity,
              averagePrice: currentPrice
            }
          });
        }
      });
      
      this.logger.log(`User ${userId} BOUGHT ${quantity} shares of ${ticker} at ${currentPrice}`);
      return {
        success: true,
        message: 'Buy order executed successfully',
        price: currentPrice,
        availableCash: portfolio.availableCash - totalValue,
      };

    } else if (type === TransactionType.SELL) {
      
      const existingPosition = await this.db.client.position.findUnique({
        where: { portfolioId_stockId: { portfolioId: portfolio.id, stockId: stock.id } }
      });

      if (!existingPosition || existingPosition.quantity < quantity) {
        throw new BadRequestException('Insufficient shares to sell');
      }

      // Execute SELL
      await this.db.client.$transaction(async (tx: any) => {
        // Add cash
        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: { availableCash: { increment: totalValue } }
        });

        // Record transaction
        await tx.transaction.create({
          data: {
            portfolioId: portfolio.id,
            stockId: stock.id,
            type: TransactionType.SELL,
            orderType,
            quantity,
            price: currentPrice
          }
        });

        // Update Position
        const newQuantity = existingPosition.quantity - quantity;
        if (newQuantity === 0) {
          await tx.position.delete({ where: { id: existingPosition.id } });
        } else {
          await tx.position.update({
            where: { id: existingPosition.id },
            data: { quantity: newQuantity }
          });
        }
      });

      this.logger.log(`User ${userId} SOLD ${quantity} shares of ${ticker} at ${currentPrice}`);
      return {
        success: true,
        message: 'Sell order executed successfully',
        price: currentPrice,
        availableCash: portfolio.availableCash + totalValue,
      };
    }
  }

  /**
   * Scans all positions in user's portfolio and evaluates high-confidence (>80%) sell signals
   */
  async getPortfolioSellSignals(userId: string) {
    const portfolio = await this.getPortfolio(userId);
    if (!portfolio || !portfolio.positions || portfolio.positions.length === 0) {
      return [];
    }

    const sellSignals = [];

    for (const position of portfolio.positions) {
      try {
        const stock = position.stock;
        if (!stock) continue;

        let quote: any = null;
        try {
          quote = await this.stockService.getLatestQuote(stock.ticker);
        } catch {
          quote = null;
        }

        const currentPrice = (quote as any)?.price || (quote as any)?.regularMarketPrice || position.averagePrice;
        const unrealizedPnLPercent = ((currentPrice - position.averagePrice) / position.averagePrice) * 100;

        // Evaluate AI sell signal for this holding
        const evaluation = await this.aiService.evaluatePortfolioSellOpportunity({
          ticker: stock.ticker,
          name: stock.name,
          avgPrice: position.averagePrice,
          currentPrice: currentPrice,
          unrealizedPnLPercent: unrealizedPnLPercent,
        });

        // Filter: Show ONLY if confidence is >= 80% and recommendation is SELL or STRONG_SELL
        if (evaluation && evaluation.confidenceScore >= 80 && ['SELL', 'STRONG_SELL'].includes(evaluation.recommendation)) {
          sellSignals.push({
            ...evaluation,
            quantityHeld: position.quantity,
            avgPurchasePrice: position.averagePrice,
            currentPrice: currentPrice,
            unrealizedPnLPercent: Number(unrealizedPnLPercent.toFixed(2)),
          });
        }
      } catch (e) {
        this.logger.error(`Error evaluating position for sell signals:`, e);
      }
    }

    return sellSignals;
  }
}

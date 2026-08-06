import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { TransactionType, OrderType } from '@prisma/client';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stockService: StockService
  ) {}

  /**
   * Initialize a portfolio for a new user with 1,000,000 INR
   */
  async createPortfolio(userId: string) {
    return this.db.client.portfolio.create({
      data: {
        userId,
        availableCash: 1000000, // ₹10,00,000
      }
    });
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

    return portfolio;
  }

  async executeTrade(userId: string, ticker: string, type: TransactionType, quantity: number, orderType: OrderType = OrderType.MARKET) {
    if (quantity <= 0) throw new BadRequestException('Quantity must be greater than 0');
    
    const stock = await this.db.client.stock.findUnique({ where: { ticker } });
    if (!stock) throw new NotFoundException('Stock not found');

    const portfolio = await this.db.client.portfolio.findUnique({ where: { userId } });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    // Fetch real-time price
    const quote = await this.stockService.getLatestQuote(ticker);
    const currentPrice = quote.regularMarketPrice;
    if (!currentPrice) throw new BadRequestException('Could not fetch real-time price for ' + ticker);

    const totalValue = currentPrice * quantity;

    if (type === TransactionType.BUY) {
      if (portfolio.availableCash < totalValue) {
        throw new BadRequestException('Insufficient funds');
      }

      // Execute BUY
      await this.db.client.$transaction(async (tx) => {
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
      return { success: true, message: 'Buy order executed successfully', price: currentPrice };

    } else if (type === TransactionType.SELL) {
      
      const existingPosition = await this.db.client.position.findUnique({
        where: { portfolioId_stockId: { portfolioId: portfolio.id, stockId: stock.id } }
      });

      if (!existingPosition || existingPosition.quantity < quantity) {
        throw new BadRequestException('Insufficient shares to sell');
      }

      // Execute SELL
      await this.db.client.$transaction(async (tx) => {
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
      return { success: true, message: 'Sell order executed successfully', price: currentPrice };
    }
  }
}

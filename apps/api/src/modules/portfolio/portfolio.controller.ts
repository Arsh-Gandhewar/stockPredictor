import { Controller, Get, Post, Body, Headers, Query } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { TransactionType } from 'db';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  async getPortfolio(@Headers('x-user-id') userId: string) {
    // In a real app we'd extract the user ID from the Clerk JWT Token using a Guard
    // For now, we will simulate it with a header or hardcoded 'test_user'
    const id = userId || 'user_123';
    return this.portfolioService.getPortfolio(id);
  }

  @Get('trades')
  async getAllTrades(
    @Headers('x-user-id') userId: string,
    @Query('ticker') ticker?: string,
    @Query('type') type?: TransactionType,
  ) {
    const id = userId || 'user_123';
    return this.portfolioService.getAllTrades(id, ticker, type);
  }

  @Post('trade')
  async executeTrade(
    @Headers('x-user-id') userId: string,
    @Body() tradeData: { ticker: string; type: TransactionType; quantity: number }
  ) {
    const id = userId || 'user_123';
    return this.portfolioService.executeTrade(
      id,
      tradeData.ticker,
      tradeData.type,
      tradeData.quantity
    );
  }

  @Get('sell-signals')
  async getPortfolioSellSignals(@Headers('x-user-id') userId: string) {
    const id = userId || 'user_123';
    return this.portfolioService.getPortfolioSellSignals(id);
  }
}

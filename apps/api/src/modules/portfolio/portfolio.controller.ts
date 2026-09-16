import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { TransactionType } from 'db';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ExecuteTradeDto, GetTradesDto } from '../../common/dto/trade.dto';

@Controller('portfolio')
@UseGuards(AuthGuard)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  async getPortfolio(@Req() req: any) {
    const userId = req.userId;
    return this.portfolioService.getPortfolio(userId);
  }

  @Get('trades')
  async getAllTrades(
    @Req() req: any,
    @Query() query: GetTradesDto
  ): Promise<any[]> {
    const userId = req.userId;
    return this.portfolioService.getAllTrades(
      userId,
      query.ticker,
      query.type,
      query.page ?? 1,
      query.limit ?? 50
    );
  }

  @Post('trade')
  async executeTrade(
    @Req() req: any,
    @Body() tradeData: ExecuteTradeDto
  ) {
    const userId = req.userId;
    return this.portfolioService.executeTrade(
      userId,
      tradeData.ticker,
      tradeData.type,
      tradeData.quantity,
      tradeData.orderType,
      tradeData.idempotencyKey,
      tradeData.limitPrice
    );
  }

  @Get('sell-signals')
  async getPortfolioSellSignals(@Req() req: any) {
    const userId = req.userId;
    return this.portfolioService.getPortfolioSellSignals(userId);
  }

  @Post('reset')
  async resetPortfolio(@Req() req: any) {
    const userId = req.userId;
    return this.portfolioService.resetPortfolio(userId);
  }

  @Post('auto-sell')
  async executeAutoSell(@Req() req: any) {
    const userId = req.userId;
    return this.portfolioService.evaluateAndExecuteAutoSell(userId);
  }
}

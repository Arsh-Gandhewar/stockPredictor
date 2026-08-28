import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { TransactionType } from 'db';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ExecuteTradeDto } from '../../common/dto/trade.dto';

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
    @Query('ticker') ticker?: string,
    @Query('type') type?: TransactionType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    const userId = req.userId;
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.portfolioService.getAllTrades(userId, ticker, type, pageNum, limitNum);
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
      tradeData.idempotencyKey
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
}

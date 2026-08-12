import { Controller, Get, Param, Query } from '@nestjs/common';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('market-summary')
  async getMarketSummary() {
    return this.stockService.getMarketSummary();
  }

  @Get('market-status')
  async getMarketStatus() {
    return this.stockService.getMarketStatusInfo();
  }

  @Get('movers')
  async getMarketMovers() {
    return this.stockService.getMarketMovers();
  }

  @Get('top-picks')
  async getTopPicks() {
    return this.stockService.getTopPicks();
  }

  @Get('high-risk-high-reward')
  async getHighRiskHighReward() {
    return this.stockService.getHighRiskHighRewardOpportunities();
  }

  @Get('search')
  async searchStocks(@Query('q') query: string) {
    return this.stockService.searchStocks(query);
  }

  @Get('all')
  async getAllStocks() {
    return this.stockService.getAllStocks();
  }

  @Get(':ticker/quote')
  async getQuote(@Param('ticker') ticker: string) {
    return this.stockService.getQuote(ticker);
  }

  @Get(':ticker/chart')
  async getChartData(
    @Param('ticker') ticker: string,
    @Query('range') range: string = '6mo',
  ) {
    return this.stockService.getChartData(ticker, range);
  }

  @Get(':ticker/profile')
  async getStockProfile(@Param('ticker') ticker: string) {
    return this.stockService.getStockProfile(ticker);
  }

  @Get(':ticker/catalyst')
  async getMovementCatalyst(@Param('ticker') ticker: string) {
    return this.stockService.getMovementCatalyst(ticker);
  }
}

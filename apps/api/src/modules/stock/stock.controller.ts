import { Controller, Get, Param } from '@nestjs/common';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('market-summary')
  async getMarketSummary() {
    return this.stockService.getMarketSummary();
  }

  @Get('top-picks')
  async getTopPicks() {
    return this.stockService.getTopPicks();
  }

  @Get(':ticker/chart')
  async getChartData(@Param('ticker') ticker: string) {
    return this.stockService.getHistoricalData(ticker);
  }

  @Get(':ticker/profile')
  async getStockProfile(@Param('ticker') ticker: string) {
    return this.stockService.getStockProfile(ticker);
  }
}

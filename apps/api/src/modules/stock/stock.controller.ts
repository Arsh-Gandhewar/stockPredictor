import { Controller, Get, Param, Query, Inject, forwardRef } from '@nestjs/common';
import { StockService } from './stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';

@Controller('stock')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    @Inject(forwardRef(() => QuantPredictionService))
    private readonly predictionService: QuantPredictionService
  ) {}

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

  @Get('prediction/top-ranked')
  async getPredictionTopRanked() {
    return this.predictionService.getTopRankedStocks();
  }

  @Get('prediction/high-risk')
  async getPredictionHighRisk() {
    return this.predictionService.getHighRiskOpportunities();
  }

  @Get('prediction/regime')
  async getPredictionRegime() {
    return { regime: await this.predictionService.getMarketRegime() };
  }

  @Get('prediction/model-status')
  getModelStatus() {
    return this.predictionService.getModelStatus();
  }

  @Get('prediction/model-performance')
  getModelPerformance() {
    return this.predictionService.getModelPerformance();
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

  @Get(':ticker/prediction')
  async getPrediction(@Param('ticker') ticker: string) {
    return this.predictionService.getPrediction(ticker);
  }
}


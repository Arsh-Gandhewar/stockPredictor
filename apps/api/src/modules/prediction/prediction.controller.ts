import { Controller, Get, Param } from '@nestjs/common';
import { QuantPredictionService } from './prediction.service';

@Controller('prediction')
export class PredictionController {
  constructor(private readonly predictionService: QuantPredictionService) {}

  @Get('top-ranked')
  async getTopRanked() {
    return this.predictionService.getTopRankedStocks();
  }

  @Get('high-risk')
  async getHighRisk() {
    return this.predictionService.getHighRiskOpportunities();
  }

  @Get('regime')
  async getRegime() {
    return { regime: await this.predictionService.getMarketRegime() };
  }

  @Get('model-status')
  getModelStatus() {
    return this.predictionService.getModelStatus();
  }

  @Get('model-performance')
  async getModelPerformance() {
    return this.predictionService.getModelPerformance();
  }

  @Get(':ticker')
  async getPrediction(@Param('ticker') ticker: string) {
    return this.predictionService.getPrediction(ticker);
  }
}

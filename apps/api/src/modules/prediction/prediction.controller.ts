import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QuantPredictionService } from './prediction.service';

@Controller('prediction')
export class PredictionController {
  constructor(private readonly predictionService: QuantPredictionService) {}

  @Post('train')
  async trainModel() {
    return this.predictionService.trainPipeline();
  }

  @Get('governance')
  getGovernance() {
    return this.predictionService.getProductionGovernanceStatus();
  }

  @Get('scorecard')
  getScorecard() {
    return this.predictionService.getProductionScorecard();
  }

  @Get('model-status')
  getModelStatus() {
    return this.predictionService.getModelStatus();
  }

  @Get('model-performance')
  async getModelPerformance() {
    return this.predictionService.getModelPerformance();
  }

  @Get('model-audit')
  getModelAudit() {
    return this.predictionService.getModelAuditReport();
  }

  @Get('model-artifact')
  getModelArtifact() {
    return this.predictionService.getArtifactDetails();
  }

  @Get('walk-forward')
  getWalkForward() {
    return this.predictionService.getWalkForwardFolds();
  }

  @Get('calibration')
  getCalibration() {
    return this.predictionService.getCalibrationReport();
  }

  @Get('holdout')
  getHoldout() {
    return this.predictionService.getHoldoutReport();
  }

  @Get('top-ranked')
  async getTopRanked(@Query('horizon') horizon?: string) {
    const validHorizon = horizon === '20d' ? '20d' : '5d';
    return this.predictionService.getTopRankedStocks(validHorizon);
  }

  @Get('high-risk')
  async getHighRisk() {
    return this.predictionService.getHighRiskOpportunities();
  }

  @Get('regime')
  async getRegime() {
    return { regime: await this.predictionService.getMarketRegime() };
  }

  @Get(':ticker')
  async getPrediction(@Param('ticker') ticker: string) {
    return this.predictionService.getPrediction(ticker);
  }
}

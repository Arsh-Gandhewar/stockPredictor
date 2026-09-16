import { Controller, Get, Post, Param, Query, UseGuards, ConflictException } from '@nestjs/common';
import { QuantPredictionService } from './prediction.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('prediction')
export class PredictionController {
  private isTraining = false;

  constructor(private readonly predictionService: QuantPredictionService) {}

  @Post('train')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  async trainModel() {
    if (this.isTraining) {
      throw new ConflictException(
        'TRAINING_IN_PROGRESS: A model training pipeline is currently executing. Concurrent training is rejected.'
      );
    }
    this.isTraining = true;
    try {
      return await this.predictionService.trainPipeline();
    } finally {
      this.isTraining = false;
    }
  }

  @Get('governance')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  getGovernance() {
    return this.predictionService.getProductionGovernanceStatus();
  }

  @Get('scorecard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
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
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  getModelAudit() {
    return this.predictionService.getModelAuditReport();
  }

  @Get('model-artifact')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  getModelArtifact() {
    return this.predictionService.getArtifactDetails();
  }

  @Get('walk-forward')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  getWalkForward() {
    return this.predictionService.getWalkForwardFolds();
  }

  @Get('calibration')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  getCalibration() {
    return this.predictionService.getCalibrationReport();
  }

  @Get('holdout')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
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

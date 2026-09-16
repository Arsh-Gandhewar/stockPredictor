import { Controller, Get, Post, Param, Query, UseGuards, ConflictException, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { QuantPredictionService } from './prediction.service';
import { DistributedLockService, LockAcquisitionResult } from './engines/distributed-lock.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { THROTTLE_POLICIES } from '../../common/constants/throttle-policies';

@Controller('prediction')
export class PredictionController {
  private isTraining = false;
  public static readonly TRAINING_LOCK_KEY = 'training_pipeline';

  constructor(
    private readonly predictionService: QuantPredictionService,
    @Optional() private readonly distributedLockService?: DistributedLockService,
  ) {}

  @Post('train')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.TRAINING)
  async trainModel() {
    // Multi-Tier Distributed Concurrency Lock
    // Tier 1: In-process atomic lock (synchronously acquired to eliminate event-loop race)
    if (this.isTraining) {
      throw new ConflictException(
        'TRAINING_IN_PROGRESS: A model training pipeline is currently executing in this process. Concurrent training is rejected.'
      );
    }
    this.isTraining = true;

    // Tier 2: Connection-pool-safe database distributed lease lock
    let lockResult: LockAcquisitionResult;
    if (this.distributedLockService) {
      try {
        lockResult = await this.distributedLockService.acquireLock(
          PredictionController.TRAINING_LOCK_KEY,
          600_000
        );
      } catch (err) {
        this.isTraining = false;
        // Mandatory Fail-Closed Guarantee: Any DB outage or timeout strictly aborts training
        throw err;
      }

      if (!lockResult.acquired) {
        this.isTraining = false;
        throw new ConflictException(
          'DISTRIBUTED_TRAINING_IN_PROGRESS: A model training pipeline is currently executing across another cluster instance (active lease held).'
        );
      }
    } else {
      lockResult = { acquired: true, ownerId: 'in-process-unit-test' };
    }

    try {
      return await this.predictionService.trainPipeline();
    } finally {
      this.isTraining = false;
      if (this.distributedLockService && lockResult && lockResult.ownerId) {
        try {
          await this.distributedLockService.releaseLock(
            PredictionController.TRAINING_LOCK_KEY,
            lockResult.ownerId
          );
        } catch {}
      }
    }
  }

  @Get('governance')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
  getGovernance() {
    return this.predictionService.getProductionGovernanceStatus();
  }

  @Get('scorecard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
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
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
  getModelAudit() {
    return this.predictionService.getModelAuditReport();
  }

  @Get('model-artifact')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
  getModelArtifact() {
    return this.predictionService.getArtifactDetails();
  }

  @Get('walk-forward')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
  getWalkForward() {
    return this.predictionService.getWalkForwardFolds();
  }

  @Get('calibration')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
  getCalibration() {
    return this.predictionService.getCalibrationReport();
  }

  @Get('holdout')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle(THROTTLE_POLICIES.EXPENSIVE)
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

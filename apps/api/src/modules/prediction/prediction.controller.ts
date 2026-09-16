import { Controller, Get, Post, Param, Query, UseGuards, ConflictException, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { QuantPredictionService } from './prediction.service';
import { DatabaseService } from '../../database/database.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('prediction')
export class PredictionController {
  private isTraining = false;
  private static readonly TRAINING_ADVISORY_LOCK_ID = 88812345;

  constructor(
    private readonly predictionService: QuantPredictionService,
    @Optional() private readonly db?: DatabaseService,
  ) {}

  @Post('train')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ training: { limit: 3, ttl: 600000 }, default: { limit: 3, ttl: 600000 } })
  async trainModel() {
    // Multi-Tier Distributed Concurrency Lock
    // Tier 1: In-process atomic lock (synchronously acquired to prevent event loop race)
    if (this.isTraining) {
      throw new ConflictException(
        'TRAINING_IN_PROGRESS: A model training pipeline is currently executing in this process. Concurrent training is rejected.'
      );
    }
    this.isTraining = true;

    // Tier 2: PostgreSQL distributed advisory lock across cluster instances
    let acquiredDbLock = false;
    if (this.db?.client?.$queryRawUnsafe) {
      try {
        const lockResult = await this.db.client.$queryRawUnsafe<Array<{ pg_try_advisory_lock: boolean }>>(
          `SELECT pg_try_advisory_lock(${PredictionController.TRAINING_ADVISORY_LOCK_ID})`
        );
        if (lockResult && lockResult[0] && lockResult[0].pg_try_advisory_lock === false) {
          this.isTraining = false;
          throw new ConflictException(
            'DISTRIBUTED_TRAINING_IN_PROGRESS: A model training pipeline is currently executing across another cluster instance.'
          );
        }
        acquiredDbLock = true;
      } catch (err: any) {
        if (err instanceof ConflictException) throw err;
        // Fall back gracefully to in-process lock if DB advisory lock is unsupported in test mock
      }
    }

    try {
      return await this.predictionService.trainPipeline();
    } finally {
      this.isTraining = false;
      if (acquiredDbLock && this.db?.client?.$queryRawUnsafe) {
        try {
          await this.db.client.$queryRawUnsafe(
            `SELECT pg_advisory_unlock(${PredictionController.TRAINING_ADVISORY_LOCK_ID})`
          );
        } catch {}
      }
    }
  }

  @Get('governance')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
  getGovernance() {
    return this.predictionService.getProductionGovernanceStatus();
  }

  @Get('scorecard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
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
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
  getModelAudit() {
    return this.predictionService.getModelAuditReport();
  }

  @Get('model-artifact')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
  getModelArtifact() {
    return this.predictionService.getArtifactDetails();
  }

  @Get('walk-forward')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
  getWalkForward() {
    return this.predictionService.getWalkForwardFolds();
  }

  @Get('calibration')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
  getCalibration() {
    return this.predictionService.getCalibrationReport();
  }

  @Get('holdout')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SERVICE')
  @Throttle({ expensive: { limit: 30, ttl: 60000 }, default: { limit: 30, ttl: 60000 } })
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

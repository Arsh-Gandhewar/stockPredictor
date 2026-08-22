import { Module, forwardRef } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { NewsModule } from '../news/news.module';
import { DatabaseModule } from '../../database/database.module';
import { QuantPredictionService } from './prediction.service';
import { PredictionController } from './prediction.controller';
import { FeatureEngine } from './engines/feature-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { CalibrationEngine } from './engines/calibration-engine';
import { RegimeEngine } from './engines/regime-engine';
import { RiskEngine } from './engines/risk-engine';
import { DecisionEngine } from './engines/decision-engine';
import { NewsFeatureEngine } from './engines/news-feature-engine';
import { BacktestEngine } from './engines/backtest-engine';
import { ModelArtifactService } from './engines/model-artifact.service';
import { ProductionScorecardService } from './engines/production-scorecard';

@Module({
  imports: [forwardRef(() => StockModule), NewsModule, DatabaseModule],
  controllers: [PredictionController],
  providers: [
    QuantPredictionService,
    FeatureEngine,
    ModelInferenceEngine,
    CalibrationEngine,
    RegimeEngine,
    RiskEngine,
    DecisionEngine,
    NewsFeatureEngine,
    BacktestEngine,
    ModelArtifactService,
    ProductionScorecardService,
  ],
  exports: [QuantPredictionService],
})
export class PredictionModule {}

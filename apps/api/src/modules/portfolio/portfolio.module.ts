import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { StockModule } from '../stock/stock.module';
import { AiModule } from '../ai/ai.module';
import { PredictionModule } from '../prediction/prediction.module';

@Module({
  imports: [StockModule, AiModule, PredictionModule],
  providers: [PortfolioService],
  controllers: [PortfolioController],
  exports: [PortfolioService],
})
export class PortfolioModule {}


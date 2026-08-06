import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { StockModule } from '../stock/stock.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [StockModule, AiModule],
  providers: [PortfolioService],
  controllers: [PortfolioController]
})
export class PortfolioModule {}

import { Module, forwardRef } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { DatabaseModule } from '../../database/database.module';
import { NewsModule } from '../news/news.module';
import { YahooMarketDataProvider } from './providers/yahoo-market-data.provider';
import { PredictionModule } from '../prediction/prediction.module';

@Module({
  imports: [DatabaseModule, NewsModule, forwardRef(() => PredictionModule)],
  controllers: [StockController],
  providers: [StockService, YahooMarketDataProvider],
  exports: [StockService, YahooMarketDataProvider],
})
export class StockModule {}


import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { DatabaseModule } from '../../database/database.module';
import { NewsModule } from '../news/news.module';
import { YahooMarketDataProvider } from './providers/yahoo-market-data.provider';

@Module({
  imports: [DatabaseModule, NewsModule],
  controllers: [StockController],
  providers: [StockService, YahooMarketDataProvider],
  exports: [StockService, YahooMarketDataProvider],
})
export class StockModule {}

import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { DatabaseModule } from '../../database/database.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [DatabaseModule, StockModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}

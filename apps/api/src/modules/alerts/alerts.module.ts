import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { DatabaseModule } from '../../database/database.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [DatabaseModule, StockModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}

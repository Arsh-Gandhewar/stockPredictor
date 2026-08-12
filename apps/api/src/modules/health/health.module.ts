import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseModule } from '../../database/database.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [DatabaseModule, StockModule],
  controllers: [HealthController],
})
export class HealthModule {}

import { Module, forwardRef } from '@nestjs/common';
import { DeepAuditController } from './deep-audit.controller';
import { DeepAuditService } from './deep-audit.service';
import { StockModule } from '../stock/stock.module';
import { PredictionModule } from '../prediction/prediction.module';
import { AiModule } from '../ai/ai.module';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [
    forwardRef(() => StockModule),
    forwardRef(() => PredictionModule),
    AiModule,
    NewsModule,
  ],
  controllers: [DeepAuditController],
  providers: [DeepAuditService],
  exports: [DeepAuditService],
})
export class DeepAuditModule {}

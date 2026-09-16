import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { StockModule } from './modules/stock/stock.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { AiModule } from './modules/ai/ai.module';
import { NewsModule } from './modules/news/news.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { HealthModule } from './modules/health/health.module';
import { PredictionModule } from './modules/prediction/prediction.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: Number(process.env.THROTTLE_LIMIT) || 300, // 300 requests per minute baseline for UI polling & light reads
      },
      {
        name: 'expensive',
        ttl: 60000,
        limit: 30, // 30 requests per minute for compute-intensive endpoints
      },
      {
        name: 'training',
        ttl: 600000,
        limit: 3, // 3 requests per 10 minutes for model training
      },
    ]),
    DatabaseModule,
    StockModule,
    PortfolioModule,
    AiModule,
    NewsModule,
    WatchlistModule,
    AlertsModule,
    HealthModule,
    PredictionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

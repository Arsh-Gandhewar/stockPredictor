import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly marketProvider: YahooMarketDataProvider
  ) {}

  @Get()
  async getHealth(@Res() res: Response) {
    const startTime = Date.now();
    let dbStatus = 'UP';
    let dbLatencyMs = 0;

    try {
      const t0 = Date.now();
      await this.db.client.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
    } catch (err: any) {
      dbStatus = 'DOWN';
    }

    const marketStatus = this.marketProvider.getMarketStatus();
    const isHealthy = dbStatus === 'UP';

    return res.status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      durationMs: Date.now() - startTime,
      services: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
        marketData: {
          status: 'UP',
          exchange: marketStatus.exchange,
          marketState: marketStatus.status,
        },
      },
      system: {
        nodeVersion: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  }

  @Get('liveness')
  getLiveness() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  @Get('readiness')
  async getReadiness(@Res() res: Response) {
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      return res.status(HttpStatus.OK).json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'not_ready' });
    }
  }
}

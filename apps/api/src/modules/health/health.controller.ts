import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';
import { verifyCalendarArtifact } from '../stock/data/nse-holidays.data';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly marketProvider: YahooMarketDataProvider,
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
    const marketHealth = await this.marketProvider.probeHealth();

    const isHealthy = dbStatus === 'UP' && marketHealth.status === 'UP';
    const isDegraded = dbStatus === 'UP' && marketHealth.status !== 'UP';
    const isDown = dbStatus === 'DOWN';

    const statusCode = isDown ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

    return res.status(statusCode).json({
      status: isDown ? 'unhealthy' : isDegraded ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      durationMs: Date.now() - startTime,
      services: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
        marketData: {
          status: marketHealth.status,
          latencyMs: marketHealth.latencyMs,
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
    const dependencies: Record<string, { ready: boolean; details?: string }> =
      {};

    // 1. Database Connectivity
    try {
      await this.db.client.$queryRaw`SELECT 1`;
      dependencies.database = { ready: true };
    } catch (err: any) {
      dependencies.database = {
        ready: false,
        details: 'Database query failed',
      };
    }

    // 2. Distributed Lock Table Availability
    try {
      await this.db.client.$queryRawUnsafe(
        'SELECT lock_key FROM distributed_locks LIMIT 0',
      );
      dependencies.distributedLocks = { ready: true };
    } catch (err: any) {
      dependencies.distributedLocks = {
        ready: false,
        details: 'Distributed lock table unavailable',
      };
    }

    // 3. Calendar Integrity
    const calendarIntegrity = verifyCalendarArtifact();
    dependencies.calendar = {
      ready: calendarIntegrity.isValid,
      details: calendarIntegrity.isValid
        ? undefined
        : calendarIntegrity.error || 'Calendar integrity verification failed',
    };

    // 4. Market Data Provider Connectivity
    try {
      const providerProbe = await this.marketProvider.probeHealth();
      dependencies.marketProvider = {
        ready: providerProbe.status !== 'DOWN',
        details:
          providerProbe.status === 'DOWN'
            ? 'Market data provider probe failed'
            : undefined,
      };
    } catch (err: any) {
      dependencies.marketProvider = { ready: false, details: err.message };
    }

    const allReady = Object.values(dependencies).every((d) => d.ready);
    const statusCode = allReady
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: allReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      dependencies,
    });
  }
}

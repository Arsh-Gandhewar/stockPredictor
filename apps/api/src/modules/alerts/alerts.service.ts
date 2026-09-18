import {
  Injectable,
  Logger,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';

export interface AlertItem {
  id: string;
  ticker: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  createdAt: string;
  isActive: boolean;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly marketProvider?: YahooMarketDataProvider,
  ) {}

  private validateTicker(ticker: string): string {
    if (!ticker || typeof ticker !== 'string') {
      throw new BadRequestException('Stock ticker is required');
    }
    const clean = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9_.-]{1,20}$/.test(clean)) {
      throw new BadRequestException(`Invalid stock ticker format: '${ticker}'`);
    }
    // Semantic universe check: verify symbol exists in supported universe
    if (this.marketProvider && !this.marketProvider.isSupportedTicker(clean)) {
      throw new BadRequestException(
        `Unsupported stock ticker: '${ticker}'. Symbol not found in market universe.`,
      );
    }
    return clean;
  }

  private async getOrCreateUser(userId: string) {
    try {
      return await this.db.client.user.upsert({
        where: { clerkId: userId },
        update: {},
        create: {
          clerkId: userId,
          email: `${userId}@quantx.internal`,
          firstName: 'QuantX',
          lastName: 'Trader',
        },
      });
    } catch {
      return await this.db.client.user.findUniqueOrThrow({
        where: { clerkId: userId },
      });
    }
  }

  async getUserAlerts(userId: string): Promise<AlertItem[]> {
    try {
      const user = await this.getOrCreateUser(userId);

      const alerts = await this.db.client.alert.findMany({
        where: { userId: user.id, isActive: true },
        include: { stock: true },
        orderBy: { createdAt: 'desc' },
      });

      return alerts.map((a) => ({
        id: a.id,
        ticker: a.stock.ticker,
        targetPrice: a.targetValue || 0,
        condition: a.condition === 'GREATER_THAN' ? 'ABOVE' : 'BELOW',
        createdAt: a.createdAt.toISOString(),
        isActive: a.isActive,
      }));
    } catch (err: any) {
      this.logger.error(
        `Failed to fetch alerts from DB for ${userId}: ${err.message}`,
      );
      throw err;
    }
  }

  async createAlert(
    userId: string,
    rawTicker: string,
    targetPrice: number,
    condition: 'ABOVE' | 'BELOW',
  ): Promise<AlertItem> {
    const ticker = this.validateTicker(rawTicker);
    if (typeof targetPrice !== 'number' || targetPrice <= 0) {
      throw new BadRequestException(
        'Alert target price must be a positive number',
      );
    }

    const user = await this.getOrCreateUser(userId);

    const stock = await this.db.client.stock.upsert({
      where: { ticker },
      update: {},
      create: {
        ticker,
        name: ticker.replace('.NS', ''),
        exchange: 'NSE',
        sector: 'Equities',
      },
    });

    const alert = await this.db.client.alert.create({
      data: {
        userId: user.id,
        stockId: stock.id,
        type: 'PRICE',
        condition: condition === 'ABOVE' ? 'GREATER_THAN' : 'LESS_THAN',
        targetValue: Number(targetPrice),
        isActive: true,
      },
      include: { stock: true },
    });

    return {
      id: alert.id,
      ticker: alert.stock.ticker,
      targetPrice: alert.targetValue || 0,
      condition: alert.condition === 'GREATER_THAN' ? 'ABOVE' : 'BELOW',
      createdAt: alert.createdAt.toISOString(),
      isActive: alert.isActive,
    };
  }

  async deleteAlert(
    userId: string,
    alertId: string,
  ): Promise<{ success: boolean }> {
    const user = await this.db.client.user.findUnique({
      where: { clerkId: userId },
    });
    if (user) {
      await this.db.client.alert.deleteMany({
        where: { id: alertId, userId: user.id },
      });
    }

    return { success: true };
  }
}

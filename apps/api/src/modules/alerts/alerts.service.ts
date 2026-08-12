import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

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
  private fallbackStore = new Map<string, AlertItem[]>();

  constructor(private readonly db: DatabaseService) {}

  private async getOrCreateUser(userId: string) {
    try {
      return await this.db.client.user.upsert({
        where: { clerkId: userId },
        update: {},
        create: { clerkId: userId, email: `${userId}@quantx.internal`, firstName: 'QuantX', lastName: 'Trader' },
      });
    } catch {
      return await this.db.client.user.findUniqueOrThrow({ where: { clerkId: userId } });
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

      if (alerts.length > 0) {
        return alerts.map((a) => ({
          id: a.id,
          ticker: a.stock.ticker,
          targetPrice: a.targetValue || 0,
          condition: a.condition === 'GREATER_THAN' ? 'ABOVE' : 'BELOW',
          createdAt: a.createdAt.toISOString(),
          isActive: a.isActive,
        }));
      }

      // If DB is empty, return default alerts or fallback
      const fallbacks = this.fallbackStore.get(userId) || [];
      if (fallbacks.length > 0) return fallbacks;

      const defaults: AlertItem[] = [
        {
          id: 'default-1',
          ticker: 'RELIANCE.NS',
          targetPrice: 3000,
          condition: 'ABOVE',
          createdAt: new Date().toISOString(),
          isActive: true,
        },
      ];
      this.fallbackStore.set(userId, defaults);
      return defaults;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch alerts from DB for ${userId}: ${err.message}`);
      return this.fallbackStore.get(userId) || [];
    }
  }

  async createAlert(
    userId: string,
    ticker: string,
    targetPrice: number,
    condition: 'ABOVE' | 'BELOW'
  ): Promise<AlertItem> {
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

    const createdAlert: AlertItem = {
      id: alert.id,
      ticker: alert.stock.ticker,
      targetPrice: alert.targetValue || 0,
      condition: alert.condition === 'GREATER_THAN' ? 'ABOVE' : 'BELOW',
      createdAt: alert.createdAt.toISOString(),
      isActive: alert.isActive,
    };

    const currentFallbacks = this.fallbackStore.get(userId) || [];
    this.fallbackStore.set(userId, [createdAlert, ...currentFallbacks]);

    return createdAlert;
  }

  async deleteAlert(userId: string, alertId: string): Promise<{ success: boolean }> {
    try {
      const user = await this.db.client.user.findUnique({ where: { clerkId: userId } });
      if (user) {
        await this.db.client.alert.deleteMany({
          where: { id: alertId, userId: user.id },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delete alert from DB for ${userId}: ${err.message}`);
    }

    const currentFallbacks = this.fallbackStore.get(userId) || [];
    this.fallbackStore.set(userId, currentFallbacks.filter((a) => a.id !== alertId));

    return { success: true };
  }
}

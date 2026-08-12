import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);
  private fallbackStore = new Map<string, string[]>();

  constructor(
    private readonly db: DatabaseService,
    private readonly marketProvider: YahooMarketDataProvider
  ) {}

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

  async getUserWatchlist(userId: string): Promise<any[]> {
    try {
      const user = await this.getOrCreateUser(userId);

      let watchlist = await this.db.client.watchlist.findFirst({
        where: { userId: user.id },
        include: {
          stocks: {
            include: { stock: true },
            orderBy: { addedAt: 'desc' },
          },
        },
      });

      if (!watchlist) {
        watchlist = await this.db.client.watchlist.create({
          data: {
            userId: user.id,
            name: 'Default Watchlist',
          },
          include: { stocks: { include: { stock: true } } },
        });

        const defaultTickers = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS'];
        
        for (const ticker of defaultTickers) {
          const universeStock = this.marketProvider.getUniverse().find((s) => s.ticker === ticker);
          const stock = await this.db.client.stock.upsert({
            where: { ticker },
            update: {},
            create: {
              ticker,
              name: universeStock?.name || ticker.replace('.NS', ''),
              exchange: 'NSE',
              sector: universeStock?.sector || 'Equities',
            },
          });
          await this.db.client.watchlistStock.upsert({
            where: {
              watchlistId_stockId: {
                watchlistId: watchlist.id,
                stockId: stock.id,
              },
            },
            update: {},
            create: {
              watchlistId: watchlist.id,
              stockId: stock.id,
            },
          });
        }
        this.fallbackStore.set(userId, defaultTickers);
        return this.marketProvider.getQuotes(defaultTickers);
      }

      const tickers = watchlist.stocks.map((ws) => ws.stock.ticker);
      this.fallbackStore.set(userId, tickers);
      return this.marketProvider.getQuotes(tickers);
    } catch (err: any) {
      this.logger.warn(`Watchlist query fallback for ${userId}: ${err.message}`);
      const tickers = this.fallbackStore.get(userId) || [
        'RELIANCE.NS',
        'TCS.NS',
        'HDFCBANK.NS',
        'INFY.NS',
      ];
      return this.marketProvider.getQuotes(tickers);
    }
  }

  async addTicker(userId: string, ticker: string): Promise<any> {
    try {
      const user = await this.getOrCreateUser(userId);

      // Find or create watchlist
      let watchlist;
      try {
        watchlist = await this.db.client.watchlist.upsert({
          where: {
            userId_name: {
              userId: user.id,
              name: 'Default Watchlist',
            },
          },
          update: {},
          create: { userId: user.id, name: 'Default Watchlist' },
        });
      } catch {
        watchlist = await this.db.client.watchlist.findFirstOrThrow({
          where: { userId: user.id, name: 'Default Watchlist' },
        });
      }

      const universeStock = this.marketProvider.getUniverse().find((s) => s.ticker === ticker);
      
      const stock = await this.db.client.stock.upsert({
        where: { ticker },
        update: {},
        create: {
          ticker,
          name: universeStock?.name || ticker.replace('.NS', ''),
          exchange: 'NSE',
          sector: universeStock?.sector || 'Equities',
        },
      });

      await this.db.client.watchlistStock.upsert({
        where: {
          watchlistId_stockId: {
            watchlistId: watchlist.id,
            stockId: stock.id,
          },
        },
        update: {},
        create: {
          watchlistId: watchlist.id,
          stockId: stock.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to add ticker to watchlist: ${err.message}`);
    }
    return this.getUserWatchlist(userId);
  }

  async removeTicker(userId: string, ticker: string): Promise<any> {
    try {
      const user = await this.db.client.user.findUnique({ where: { clerkId: userId } });
      if (!user) return this.getUserWatchlist(userId);

      const stock = await this.db.client.stock.findUnique({ where: { ticker } });
      if (!stock) return this.getUserWatchlist(userId);

      const watchlist = await this.db.client.watchlist.findFirst({ where: { userId: user.id } });
      if (!watchlist) return this.getUserWatchlist(userId);

      await this.db.client.watchlistStock.deleteMany({
        where: {
          watchlistId: watchlist.id,
          stockId: stock.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to remove ticker from watchlist: ${err.message}`);
    }
    return this.getUserWatchlist(userId);
  }
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stockService: StockService,
    private readonly marketProvider: YahooMarketDataProvider
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
      throw new BadRequestException(`Unsupported stock ticker: '${ticker}'. Symbol not found in market universe.`);
    }
    return clean;
  }

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
        return this.stockService.getQuotes(defaultTickers);
      }

      const tickers = watchlist.stocks.map((ws) => ws.stock.ticker);
      return this.stockService.getQuotes(tickers);
    } catch (err: any) {
      this.logger.error(`Watchlist query failed for ${userId}: ${err.message}`);
      throw err;
    }
  }

  async addTicker(userId: string, rawTicker: string): Promise<any> {
    const ticker = this.validateTicker(rawTicker);
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

    return this.getUserWatchlist(userId);
  }

  async removeTicker(userId: string, rawTicker: string): Promise<any> {
    const ticker = this.validateTicker(rawTicker);
    await this.db.client.watchlistStock.deleteMany({
      where: {
        watchlist: { user: { clerkId: userId } },
        stock: { ticker },
      },
    });

    return this.getUserWatchlist(userId);
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { DatabaseService } from '../../database/database.service';
import { RSI, MACD, EMA, SMA, BollingerBands, ATR, ADX } from 'technicalindicators';

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Fetches historical data from Yahoo Finance and saves it to DB.
   * Ticker should be formatted for Yahoo Finance (e.g., RELIANCE.NS)
   */
  async syncHistoricalData(ticker: string, period1: string, period2: string = new Date().toISOString().split('T')[0]) {
    try {
      this.logger.log(`Fetching historical data for ${ticker}...`);
      const stock = await this.db.client.stock.findUnique({ where: { ticker } });
      if (!stock) throw new NotFoundException(`Stock ${ticker} not found in DB`);

      const queryOptions = { period1, period2, interval: '1d' as const };
      const result = await yahooFinance.historical(ticker, queryOptions) as any[];

      // Save to DB (batch upsert or createMany)
      const records = result.map((quote: any) => ({
        stockId: stock.id,
        date: quote.date,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: BigInt(quote.volume || 0),
      }));

      // In a real production system, use createManySkipDuplicates if supported, 
      // or handle UPSERT for each to avoid unique constraint errors on [stockId, date]
      for (const record of records) {
        await this.db.client.priceHistory.upsert({
          where: {
            stockId_date: {
              stockId: record.stockId,
              date: record.date
            }
          },
          update: record,
          create: record
        });
      }

      this.logger.log(`Synced ${records.length} historical records for ${ticker}`);
      
      // After sync, compute technical indicators
      await this.computeTechnicalIndicators(stock.id, result);
      
    } catch (error) {
      this.logger.error(`Error syncing data for ${ticker}`, error);
      throw error;
    }
  }

  /**
   * Computes technical indicators based on historical prices
   */
  private async computeTechnicalIndicators(stockId: string, historicalData: any[]) {
    if (historicalData.length < 50) return; // Need sufficient data for indicators

    const closePrices = historicalData.map(d => d.close);
    const highPrices = historicalData.map(d => d.high);
    const lowPrices = historicalData.map(d => d.low);

    // Compute indicators
    const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
    const macdValues = MACD.calculate({ 
      values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false 
    });
    const ema20Values = EMA.calculate({ values: closePrices, period: 20 });
    const sma50Values = SMA.calculate({ values: closePrices, period: 50 });
    const sma200Values = SMA.calculate({ values: closePrices, period: 200 });
    const bbValues = BollingerBands.calculate({ values: closePrices, period: 20, stdDev: 2 });
    const atrValues = ATR.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
    const adxValues = ADX.calculate({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });

    // In a real application, you map these arrays back to the respective dates.
    // For simplicity, we just save the latest computed values.
    const latestDate = historicalData[historicalData.length - 1].date;
    
    await this.db.client.technicalIndicator.upsert({
      where: {
        stockId_timestamp: {
          stockId,
          timestamp: latestDate
        }
      },
      update: {
        rsi: rsiValues[rsiValues.length - 1] || null,
        macd: macdValues[macdValues.length - 1]?.MACD || null,
        macdSignal: macdValues[macdValues.length - 1]?.signal || null,
        macdHist: macdValues[macdValues.length - 1]?.histogram || null,
        ema20: ema20Values[ema20Values.length - 1] || null,
        sma50: sma50Values[sma50Values.length - 1] || null,
        sma200: sma200Values[sma200Values.length - 1] || null,
        bollingerUpper: bbValues[bbValues.length - 1]?.upper || null,
        bollingerLower: bbValues[bbValues.length - 1]?.lower || null,
        atr: atrValues[atrValues.length - 1] || null,
        adx: adxValues[adxValues.length - 1]?.adx || null,
      },
      create: {
        stockId,
        timestamp: latestDate,
        rsi: rsiValues[rsiValues.length - 1] || null,
        macd: macdValues[macdValues.length - 1]?.MACD || null,
        macdSignal: macdValues[macdValues.length - 1]?.signal || null,
        macdHist: macdValues[macdValues.length - 1]?.histogram || null,
        ema20: ema20Values[ema20Values.length - 1] || null,
        sma50: sma50Values[sma50Values.length - 1] || null,
        sma200: sma200Values[sma200Values.length - 1] || null,
        bollingerUpper: bbValues[bbValues.length - 1]?.upper || null,
        bollingerLower: bbValues[bbValues.length - 1]?.lower || null,
        atr: atrValues[atrValues.length - 1] || null,
        adx: adxValues[adxValues.length - 1]?.adx || null,
      }
    });

    this.logger.log(`Computed and saved technical indicators for stock ${stockId}`);
  }

  async getLatestQuote(ticker: string) {
    return yahooFinance.quote(ticker);
  }

  async getMarketSummary() {
    this.logger.log('getMarketSummary called');
    try {
      this.logger.log('Fetching Nifty quote...');
      const nifty = await yahooFinance.quote('^NSEI') as any;
      this.logger.log('Fetching Sensex quote...');
      const sensex = await yahooFinance.quote('^BSESN') as any;
      
      this.logger.log('Quotes fetched successfully.');
      return [
        {
          name: 'NIFTY 50',
          value: nifty.regularMarketPrice?.toFixed(2) || '0.00',
          change: nifty.regularMarketChangePercent?.toFixed(2) + '%',
          up: (nifty.regularMarketChangePercent || 0) >= 0
        },
        {
          name: 'SENSEX',
          value: sensex.regularMarketPrice?.toFixed(2) || '0.00',
          change: sensex.regularMarketChangePercent?.toFixed(2) + '%',
          up: (sensex.regularMarketChangePercent || 0) >= 0
        }
      ];
    } catch (error) {
      this.logger.warn(`Failed to fetch market indices, falling back to db stocks. Error: ${error.message}`);
      // Fallback: just return the top 2 stocks in DB as pseudo-indices
      this.logger.log('Fetching from DB...');
      const stocks = await this.db.client.stock.findMany({ take: 2 });
      this.logger.log('DB fetch complete. Building summary...');
      const summary = [];
      for (const stock of stocks) {
        let quote: any = null;
        try {
          quote = await yahooFinance.quote(stock.ticker);
        } catch (e) {
          quote = null;
        }
        summary.push({
          name: stock.name,
          value: quote?.regularMarketPrice?.toFixed(2) || '0.00',
          change: (quote?.regularMarketChangePercent?.toFixed(2) || '0') + '%',
          up: (quote?.regularMarketChangePercent || 0) >= 0
        });
      }
      return summary;
    }
  }

  async getTopPicks() {
    // Fetch top 5 stocks sorted by AI confidence or purely by some technical indicator for now
    const stocks = await this.db.client.stock.findMany({
      include: {
        aiInsights: {
          orderBy: { timestamp: 'desc' },
          take: 1
        },
        priceHistory: {
          orderBy: { date: 'desc' },
          take: 1
        }
      },
      take: 5
    });

    return stocks.map((stock: any) => {
      const insight = stock.aiInsights[0];
      const latestPrice = stock.priceHistory[0]?.close || 0;
      
      return {
        ticker: stock.ticker,
        name: stock.name,
        price: latestPrice.toFixed(2),
        recommendation: insight?.recommendation || 'HOLD',
        confidence: insight?.confidenceScore || 50,
      };
    }).sort((a: any, b: any) => b.confidence - a.confidence);
  }

  async getHistoricalData(ticker: string) {
    const stock = await this.db.client.stock.findUnique({ where: { ticker } });
    if (!stock) throw new NotFoundException('Stock not found');

    const history = await this.db.client.priceHistory.findMany({
      where: { stockId: stock.id },
      orderBy: { date: 'asc' }
    });

    return history.map((h: any) => ({
      time: h.date.toISOString().split('T')[0],
      open: h.open,
      high: h.high,
      low: h.low,
      close: h.close
    }));
  }

  async getStockProfile(ticker: string) {
    const stock = await this.db.client.stock.findUnique({
      where: { ticker },
      include: {
        aiInsights: { orderBy: { timestamp: 'desc' }, take: 1 },
        priceHistory: { orderBy: { date: 'desc' }, take: 1 }
      }
    });

    if (!stock) throw new NotFoundException('Stock not found');
    
    return {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      exchange: stock.exchange,
      price: stock.priceHistory[0]?.close || 0,
      insight: stock.aiInsights[0] || null
    };
  }
}

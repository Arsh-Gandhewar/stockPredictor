export interface MarketQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;
  open: number;
  volume: number;
  marketCap?: number;
  pe?: number;
  weekHigh52?: number;
  weekLow52?: number;
  marketState: string;
  exchange: string;
  timestamp: string;
  source: string;
  freshness: 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED' | 'DATA_UNAVAILABLE';
}

export interface OHLCVCandle {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketStatus {
  status: 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'HOLIDAY';
  timestamp: string;
  timezone: string;
  exchange: string;
}

export interface MarketIndexBenchmark {
  name: string;
  symbol: string;
  value: number;
  change: number;
  changePercent: number;
  up: boolean;
  marketState: string;
  timestamp: string;
}

export interface UniverseStock {
  ticker: string;
  name: string;
  sector: string | null;
  industry?: string | null;
  exchange: string;
  marketCapTier?: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
  rank?: number;
}

export interface MarketDataProvider {
  getQuote(ticker: string): Promise<MarketQuote>;
  getQuotes(tickers: string[]): Promise<MarketQuote[]>;
  getHistoricalCandles(ticker: string, range: string): Promise<OHLCVCandle[]>;
  getMarketStatus(): MarketStatus;
  getMarketSummary(): Promise<MarketIndexBenchmark[]>;
  getUniverse(): UniverseStock[];
  search(query: string): Promise<UniverseStock[]>;
}

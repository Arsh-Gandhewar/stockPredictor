import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetcher } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────
export interface StockQuote {
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
  freshness: 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED';
}

export interface MarketIndex {
  name: string;
  symbol: string;
  value: number;
  change: number;
  changePercent: number;
  up: boolean;
  marketState: string;
  timestamp: string;
}

export interface MarketStatusInfo {
  status: 'PRE_OPEN' | 'OPEN' | 'CLOSED' | 'HOLIDAY';
  timestamp: string;
  timezone: string;
  exchange: string;
}

export interface MoverItem {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

export interface MarketMovers {
  gainers: MoverItem[];
  losers: MoverItem[];
  mostActive: MoverItem[];
  timestamp: string;
}

export interface Candle {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MovementCatalyst {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  volumeSurgeRatio: number;
  primaryDriver: string;
  catalystType: 'TECHNICAL_BREAKOUT' | 'EARNINGS_ANNOUNCEMENT' | 'SECTOR_RALLY' | 'VOLUME_SPIKE' | 'BROAD_MARKET' | 'PROFIT_BOOKING' | 'MOMENTUM_BREAKOUT' | 'ORDERBOOK_PIPELINE' | 'RANGE_ACCUMULATION';
  confidenceScore: number;
  keyFactors: string[];
  invalidationLevel: number;
}

export interface StockProfile {
  stock: {
    ticker: string;
    name: string;
    sector: string | null;
    exchange: string;
  };
  quote: StockQuote;
  chart: Candle[];
  technicals: {
    rsi: number;
    rsiStance: string;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
      trend: string;
    };
    sma50: number;
    sma200: number;
    goldenCross: boolean;
    bollinger: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
  catalyst: MovementCatalyst;
}

export interface TopPickItem {
  ticker: string;
  name: string;
  sector: string | null;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  recommendation: string;
  confidenceScore: number;
  confidence?: number;
  reasoning: string;
  target: number;
  stopLoss: number;
  rewardRiskRatio: number;
}

export interface HighRiskStockItem {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  beta: number;
  rewardRiskRatio: number;
  targetPrice: number;
  stopLossPrice: number;
  targetUpsidePercent?: number;
  catalyst: string;
  volatilityRank: string;
}

export interface MarketNewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  timeAgo: string;
  category: 'Markets' | 'Corporate' | 'Results' | 'Macro';
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  affectedStock?: string;
  affectedStockName?: string;
  summary: string;
  whyItMatters: string;
  fullBody?: string;
}

export interface AlertItem {
  id: string;
  ticker: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  createdAt: string;
  isActive: boolean;
}

// ── Hooks ──────────────────────────────────────────────────────────────

export function useHighRiskStocks() {
  return useQuery({
    queryKey: ['high-risk-high-reward'],
    queryFn: () => fetcher<HighRiskStockItem[]>('/stock/high-risk-high-reward'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary'],
    queryFn: () => fetcher<MarketIndex[]>('/stock/market-summary'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useMarketStatus() {
  return useQuery({
    queryKey: ['market-status'],
    queryFn: () => fetcher<MarketStatusInfo>('/stock/market-status'),
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

export function useMarketMovers() {
  return useQuery({
    queryKey: ['market-movers'],
    queryFn: () => fetcher<MarketMovers>('/stock/movers'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useTopPicks() {
  return useQuery({
    queryKey: ['top-picks'],
    queryFn: () => fetcher<TopPickItem[]>('/stock/top-picks'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useStockQuote(ticker: string) {
  return useQuery({
    queryKey: ['stock-quote', ticker],
    queryFn: () => fetcher<StockQuote>(`/stock/${encodeURIComponent(ticker)}/quote`),
    enabled: !!ticker,
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useStockChart(ticker: string, range: string = '6mo') {
  return useQuery({
    queryKey: ['stock-chart', ticker, range],
    queryFn: () => fetcher<Candle[]>(`/stock/${encodeURIComponent(ticker)}/chart?range=${range}`),
    enabled: !!ticker,
    refetchInterval: range === '1d' || range === '1w' ? 3000 : 10000,
    staleTime: range === '1d' || range === '1w' ? 1000 : 5000,
  });
}

export function useStockProfile(ticker: string) {
  return useQuery({
    queryKey: ['stock-profile', ticker],
    queryFn: () => fetcher<StockProfile>(`/stock/${encodeURIComponent(ticker)}/profile`),
    enabled: !!ticker,
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useMovementCatalyst(ticker: string) {
  return useQuery({
    queryKey: ['movement-catalyst', ticker],
    queryFn: () => fetcher<MovementCatalyst>(`/stock/${encodeURIComponent(ticker)}/catalyst`),
    enabled: !!ticker,
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useStockSearch(query: string) {
  return useQuery({
    queryKey: ['stock-search', query],
    queryFn: () => fetcher<{ ticker: string; name: string; sector: string | null; exchange: string }[]>(`/stock/search?q=${encodeURIComponent(query)}`),
    enabled: !!query && query.length >= 1,
    staleTime: 60000,
  });
}

export function useAllStocks() {
  return useQuery({
    queryKey: ['all-stocks'],
    queryFn: () => fetcher<{ ticker: string; name: string; sector: string | null; exchange: string }[]>('/stock/all'),
    staleTime: 300000,
  });
}

// ── News Hooks ─────────────────────────────────────────────────────────

export function useMarketNews(category?: string, query?: string) {
  return useQuery({
    queryKey: ['market-news', category, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category && category !== 'ALL') params.set('category', category);
      if (query) params.set('q', query);
      const qs = params.toString();
      return fetcher<MarketNewsItem[]>(`/news${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 300000, // Exactly 5 minutes live news polling
    staleTime: 60000,
  });
}

export function useStockNews(ticker: string) {
  return useQuery({
    queryKey: ['stock-news', ticker],
    queryFn: () => fetcher<MarketNewsItem[]>(`/news/${ticker}`),
    enabled: !!ticker,
    refetchInterval: 300000, // Exactly 5 minutes live news polling
    staleTime: 60000,
  });
}

// ── Watchlist Hooks ───────────────────────────────────────────────────

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: () => fetcher<StockQuote[]>('/watchlist'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticker: string) =>
      fetcher('/watchlist/add', {
        method: 'POST',
        body: JSON.stringify({ ticker }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticker: string) =>
      fetcher(`/watchlist/${ticker}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

// ── Alerts Hooks ──────────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => fetcher<AlertItem[]>('/alerts'),
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ticker: string; targetPrice: number; condition: 'ABOVE' | 'BELOW' }) =>
      fetcher('/alerts', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetcher(`/alerts/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

// ── Portfolio Types & Hooks ───────────────────────────────────────────

export interface PortfolioPosition {
  id: string;
  portfolioId: string;
  stockId: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  dayChange: number;
  dayChangePercent: number;
  investedValue: number;
  currentValue: number;
  todayPnL: number;
  overallPnL: number;
  overallPnLPercent: number;
  stock: {
    id: string;
    ticker: string;
    name: string;
    sector: string | null;
    exchange: string;
  };
}

export interface PortfolioData {
  id: string;
  userId: string;
  availableCash: number;
  positions: PortfolioPosition[];
  totalInvested: number;
  totalCurrentValue: number;
  totalPortfolioValue: number;
  totalTodayPnL: number;
  totalTodayPnLPercent: number;
  totalOverallPnL: number;
  totalOverallPnLPercent: number;
}

export function usePortfolio(userId?: string) {
  return useQuery({
    queryKey: ['portfolio', userId],
    queryFn: () => fetcher<PortfolioData>('/portfolio', {
      headers: userId ? { 'x-user-id': userId } : undefined,
    }),
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export function usePortfolioSellSignals(userId?: string) {
  return useQuery({
    queryKey: ['portfolio-sell-signals', userId],
    queryFn: () => fetcher<any[]>('/portfolio/sell-signals', {
      headers: userId ? { 'x-user-id': userId } : undefined,
    }),
    refetchInterval: 15000,
    staleTime: 5000,
  });
}

export interface TradeItem {
  id: string;
  ticker: string;
  name: string;
  type: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  price: number;
  totalValue: number;
  timestamp: string;
  executedPrice?: number;
  currentPrice?: number;
  deltaPercentSinceTrade?: number;
  deltaSinceTrade?: number;
  sector?: string;
}

export function useAllTrades(userId?: string, ticker?: string, type?: 'BUY' | 'SELL') {
  return useQuery({
    queryKey: ['portfolio-trades', userId, ticker, type],
    queryFn: () => {
      const params = new URLSearchParams();
      if (ticker) params.set('ticker', ticker);
      if (type) params.set('type', type);
      const qs = params.toString();
      return fetcher<TradeItem[]>(`/portfolio/trades${qs ? `?${qs}` : ''}`, {
        headers: userId ? { 'x-user-id': userId } : undefined,
      });
    },
    refetchInterval: 3000,
    staleTime: 1000,
  });
}

export const useTradeHistory = useAllTrades;

export function useExecuteTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tradeData: { ticker: string; type: 'BUY' | 'SELL'; quantity: number; userId?: string }) =>
      fetcher('/portfolio/trade', {
        method: 'POST',
        headers: tradeData.userId ? { 'x-user-id': tradeData.userId } : undefined,
        body: JSON.stringify({
          ticker: tradeData.ticker,
          type: tradeData.type,
          quantity: tradeData.quantity,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-trades'] });
    },
  });
}

export function useResetPortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId?: string) =>
      fetcher('/portfolio/reset', {
        method: 'POST',
        headers: userId ? { 'x-user-id': userId } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-trades'] });
    },
  });
}

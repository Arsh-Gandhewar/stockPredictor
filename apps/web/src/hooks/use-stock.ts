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

export interface StockProfile {
  ticker: string;
  name: string;
  sector: string | null;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;
  open: number;
  volume: number;
  marketCap: number | null;
  pe: number | null;
  weekHigh52: number | null;
  weekLow52: number | null;
  marketState: string;
  freshness: 'LIVE' | 'DELAYED' | 'STALE' | 'CLOSED';
  timestamp: string;
  source: string;
  insight: any | null;
  technicals: any | null;
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
  confidence: number;
  freshness: string;
  timestamp: string;
}

export interface HighRiskStockItem {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  beta: number;
  intradayVolatility: number;
  catalyst: string;
  targetUpsidePercent: number;
  stopLossPercent: number;
  targetPrice: number;
  stopLossPrice: number;
  riskRewardRatio: string;
  riskLevel: 'HIGH' | 'VERY HIGH';
  convictionScore: number;
}

// ── Hooks ──────────────────────────────────────────────────────────────

export function useHighRiskStocks() {
  return useQuery({
    queryKey: ['high-risk-high-reward'],
    queryFn: () => fetcher<HighRiskStockItem[]>('/stock/high-risk-high-reward'),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary'],
    queryFn: () => fetcher<MarketIndex[]>('/stock/market-summary'),
    refetchInterval: 30000, // 30s auto-refresh
    staleTime: 15000,
  });
}

export function useMarketStatus() {
  return useQuery({
    queryKey: ['market-status'],
    queryFn: () => fetcher<MarketStatusInfo>('/stock/market-status'),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useMarketMovers() {
  return useQuery({
    queryKey: ['market-movers'],
    queryFn: () => fetcher<MarketMovers>('/stock/movers'),
    refetchInterval: 45000,
    staleTime: 30000,
  });
}

export function useTopPicks() {
  return useQuery({
    queryKey: ['top-picks'],
    queryFn: () => fetcher<TopPickItem[]>('/stock/top-picks'),
    staleTime: 60000,
  });
}

export function useStockQuote(ticker: string) {
  return useQuery({
    queryKey: ['stock-quote', ticker],
    queryFn: () => fetcher<StockQuote>(`/stock/${ticker}/quote`),
    enabled: !!ticker,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useStockChart(ticker: string, range: string = '6mo') {
  return useQuery({
    queryKey: ['stock-chart', ticker, range],
    queryFn: () => fetcher<Candle[]>(`/stock/${ticker}/chart?range=${range}`),
    enabled: !!ticker,
    staleTime: 120000, // 2 mins
  });
}

export function useStockProfile(ticker: string) {
  return useQuery({
    queryKey: ['stock-profile', ticker],
    queryFn: () => fetcher<StockProfile>(`/stock/${ticker}/profile`),
    enabled: !!ticker,
    staleTime: 30000,
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
    staleTime: 300000, // 5 min
  });
}

export function usePortfolio(userId?: string) {
  return useQuery({
    queryKey: ['portfolio', userId],
    queryFn: () => fetcher<any>('/portfolio', {
      headers: userId ? { 'x-user-id': userId } : undefined,
    }),
    staleTime: 10000,
  });
}

export function usePortfolioSellSignals(userId?: string) {
  return useQuery({
    queryKey: ['portfolio-sell-signals', userId],
    queryFn: () => fetcher<any[]>('/portfolio/sell-signals', {
      headers: userId ? { 'x-user-id': userId } : undefined,
    }),
    refetchInterval: 120000, // 2 minutes
    staleTime: 60000,
  });
}

export interface TradeItem {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  type: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  executedPrice: number;
  totalValue: number;
  timestamp: string;
  currentPrice: number;
  deltaSinceTrade: number;
  deltaPercentSinceTrade: number;
}

export interface TradeHistoryResponse {
  trades: TradeItem[];
  summary: {
    totalTrades: number;
    totalTurnover: number;
    totalBuyCount: number;
    totalSellCount: number;
    totalBuyVolume: number;
    totalSellVolume: number;
    topTraded: { ticker: string; name: string; count: number; volume: number; turnover: number }[];
  };
}

export function useTradeHistory(params?: { ticker?: string; type?: string; userId?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.ticker) queryParams.set('ticker', params.ticker);
  if (params?.type && params.type !== 'ALL') queryParams.set('type', params.type);
  const qStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

  return useQuery({
    queryKey: ['trade-history', params?.ticker, params?.type, params?.userId],
    queryFn: () => fetcher<TradeHistoryResponse>(`/portfolio/trades${qStr}`, {
      headers: params?.userId ? { 'x-user-id': params.userId } : undefined,
    }),
    staleTime: 10000,
  });
}

export function useExecuteTrade() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { ticker: string; type: 'BUY' | 'SELL'; quantity: number; userId?: string }) => 
      fetcher('/portfolio/trade', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: data.userId ? { 'x-user-id': data.userId } : undefined,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-sell-signals', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['trade-history'] });
    },
  });
}

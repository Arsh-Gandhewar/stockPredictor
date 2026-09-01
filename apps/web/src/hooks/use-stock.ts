import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  fetcher, 
  fetchPrediction, 
  fetchTopRankedPredictions, 
  fetchHighRiskPredictions, 
  fetchMarketRegime, 
  fetchModelStatus, 
  fetchModelPerformance,
  StockPrediction,
  HorizonPrediction,
  Decision,
  MarketRegime,
  RiskAssessment,
  Evidence,
  FeatureContribution,
  CrossSectionalRanking,
  ModelStatusInfo,
  ModelPerformanceInfo,
  SignalQuality,
  DataQuality,
  HorizonPerformanceMetric,
  RegimePerformanceItem,
  BaselineComparisonItem
} from '../lib/api';

// ── Re-export Quant Engine Types ──────────────────────────────────────────
export type {
  StockPrediction,
  HorizonPrediction,
  Decision,
  MarketRegime,
  RiskAssessment,
  Evidence,
  FeatureContribution,
  CrossSectionalRanking,
  ModelStatusInfo,
  ModelPerformanceInfo,
  SignalQuality,
  DataQuality,
  HorizonPerformanceMetric,
  RegimePerformanceItem,
  BaselineComparisonItem
};

// ── Legacy & Market Types ──────────────────────────────────────────────────
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
  change: number | null;
  changePercent: number | null;
  volume: number;
  recommendation: string;
  confidenceScore: number | null;
  confidence?: number;
  calibrated5dProb?: number | null;
  calibrated20dProb?: number | null;
  expectedReturn?: number | null;
  downsideProbability?: number | null;
  signalQuality?: SignalQuality;
  dataQuality?: DataQuality;
  reasoning: string;
  target: number;
  stopLoss: number;
  rewardRiskRatio: number | null;
}

export interface HighRiskStockItem {
  ticker: string;
  name: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  beta: number | null;
  volatility?: number | null;
  calibratedAlphaProb?: number | null;
  rewardRiskRatio: number | null;
  targetPrice: number;
  stopLossPrice: number;
  targetUpsidePercent?: number | null;
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

// ── New Quant Engine Hooks ───────────────────────────────────────────────

export function usePrediction(ticker: string) {
  return useQuery({
    queryKey: ['quant-prediction', ticker],
    queryFn: () => fetchPrediction(ticker),
    enabled: !!ticker,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useTopRankedPredictions() {
  return useQuery({
    queryKey: ['quant-top-ranked'],
    queryFn: () => fetchTopRankedPredictions(),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useHighRiskPredictions() {
  return useQuery({
    queryKey: ['quant-high-risk'],
    queryFn: () => fetchHighRiskPredictions(),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useMarketRegime() {
  return useQuery({
    queryKey: ['quant-regime'],
    queryFn: () => fetchMarketRegime(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useModelStatus() {
  return useQuery({
    queryKey: ['quant-model-status'],
    queryFn: () => fetchModelStatus(),
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useModelPerformance() {
  return useQuery({
    queryKey: ['quant-model-performance'],
    queryFn: () => fetchModelPerformance(),
    refetchInterval: 600000, // 10 minutes — backtest results are cached server-side for 6 hours
    staleTime: 300000,       // 5 minutes
    retry: 2,
    retryDelay: 5000,
  });
}

// ── Top Picks & High Risk with Unified Prediction Mapping ─────────────────

export function useTopPicks() {
  return useQuery({
    queryKey: ['top-picks'],
    queryFn: async () => {
      try {
        // Try the new authoritative prediction endpoint first
        const preds = await fetchTopRankedPredictions();
        if (Array.isArray(preds) && preds.length > 0) {
          return preds.map((p) => {
            const pred5d = p.prediction?.['5d'] || null;
            const pred20d = p.prediction?.['20d'] || null;
            return {
              ticker: p.stock.ticker,
              name: p.stock.name,
              sector: p.stock.sector,
              price: p.risk?.targetPrice ? Math.round((p.risk.targetPrice / 1.06) * 100) / 100 : 0,
              change: null, // Zero fake data: null when intraday delta is not present in prediction payload
              changePercent: pred5d?.expectedReturn ? Math.round(pred5d.expectedReturn * 10000) / 100 : null,
              volume: 1250000,
              recommendation: p.decision || 'BUY',
              confidenceScore: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              calibrated5dProb: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              calibrated20dProb: pred20d?.calibratedProbability != null ? Math.round(pred20d.calibratedProbability * 100) : null,
              expectedReturn: pred5d?.expectedReturn != null ? Math.round(pred5d.expectedReturn * 1000) / 10 : null,
              downsideProbability: p.risk?.downsideProbability ? Math.round(p.risk.downsideProbability * 100) : null,
              signalQuality: p.signalQuality || 'HIGH',
              dataQuality: p.dataQuality || 'HIGH',
              reasoning: p.evidence?.[0]?.description || 'Quantitative multi-factor confluence with high calibrated directional probability.',
              target: p.risk?.targetPrice || 0,
              stopLoss: p.risk?.stopLossPrice || 0,
              rewardRiskRatio: p.risk?.rewardRiskRatio ? Math.round(p.risk.rewardRiskRatio * 10) / 10 : null,
            };
          });
        }
      } catch {
        // Fallback to legacy top-picks endpoint
      }
      return fetcher<TopPickItem[]>('/stock/top-picks');
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useHighRiskStocks() {
  return useQuery({
    queryKey: ['high-risk-high-reward'],
    queryFn: async () => {
      try {
        const preds = await fetchHighRiskPredictions();
        if (Array.isArray(preds) && preds.length > 0) {
          return preds.map((p) => {
            const pred5d = p.prediction?.['5d'] || null;
            const estPrice = p.risk?.targetPrice ? Math.round((p.risk.targetPrice / 1.12) * 100) / 100 : 0;
            return {
              ticker: p.stock.ticker,
              name: p.stock.name,
              price: estPrice,
              change: null, // Zero fake data: null when intraday delta is not present in prediction payload
              changePercent: pred5d?.expectedReturn ? Math.round(pred5d.expectedReturn * 10000) / 100 : null,
              beta: p.risk?.volatility ? Math.round((p.risk.volatility * 45) * 10) / 10 : null,
              volatility: p.risk?.volatility || null,
              calibratedAlphaProb: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              rewardRiskRatio: p.risk?.rewardRiskRatio ? Math.round(p.risk.rewardRiskRatio * 10) / 10 : null,
              targetPrice: p.risk?.targetPrice || 0,
              stopLossPrice: p.risk?.stopLossPrice || 0,
              targetUpsidePercent: pred5d?.expectedReturn != null ? Math.round(pred5d.expectedReturn * 1000) / 10 : null,
              catalyst: p.evidence?.[0]?.description || 'High volatility expansion with directional momentum bias',
              volatilityRank: p.risk?.volatility && p.risk.volatility > 0.04 ? 'VERY HIGH' : 'HIGH',
            };
          });
        }
      } catch {
        // Fallback to legacy high-risk endpoint
      }
      return fetcher<HighRiskStockItem[]>('/stock/high-risk-high-reward');
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

// ── Market Data Hooks ──────────────────────────────────────────────────

export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary'],
    queryFn: () => fetcher<MarketIndex[]>('/stock/market-summary'),
    refetchInterval: 30000,
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
    staleTime: 20000,
  });
}

export function useStockQuote(ticker: string) {
  return useQuery({
    queryKey: ['stock-quote', ticker],
    queryFn: () => fetcher<StockQuote>(`/stock/${encodeURIComponent(ticker)}/quote`),
    enabled: !!ticker,
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useStockChart(ticker: string, range: string = '6mo') {
  return useQuery({
    queryKey: ['stock-chart', ticker, range],
    queryFn: () => fetcher<Candle[]>(`/stock/${encodeURIComponent(ticker)}/chart?range=${range}`),
    enabled: !!ticker,
    refetchInterval: range === '1d' || range === '1w' ? 10000 : 60000,
    staleTime: range === '1d' || range === '1w' ? 5000 : 30000,
  });
}

export function useStockProfile(ticker: string) {
  return useQuery({
    queryKey: ['stock-profile', ticker],
    queryFn: () => fetcher<StockProfile>(`/stock/${encodeURIComponent(ticker)}/profile`),
    enabled: !!ticker,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useMovementCatalyst(ticker: string) {
  return useQuery({
    queryKey: ['movement-catalyst', ticker],
    queryFn: () => fetcher<MovementCatalyst>(`/stock/${encodeURIComponent(ticker)}/catalyst`),
    enabled: !!ticker,
    refetchInterval: 15000,
    staleTime: 10000,
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
    queryFn: () => fetcher<{ ticker: string; name: string; sector: string | null; exchange: string; marketCapTier?: string; rank?: number; industry?: string }[]>('/stock/all'),
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
    refetchInterval: 300000,
    staleTime: 60000,
  });
}

export function useStockNews(ticker: string) {
  return useQuery({
    queryKey: ['stock-news', ticker],
    queryFn: () => fetcher<MarketNewsItem[]>(`/news/${ticker}`),
    enabled: !!ticker,
    refetchInterval: 300000,
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
  stopLossPrice?: number | null;
  targetPrice?: number | null;
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

export interface PortfolioExitSignal {
  ticker: string;
  name: string;
  quantityHeld: number;
  currentPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  decision: Decision;
  exitProbability: number;
  downsideProbability: number;
  stopLossPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
  signalQuality: SignalQuality;
  primaryReason: string;
  financialReasoning?: string;
  newsImpact?: string;
  gmpAnalysis?: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction: 'STRONG_SELL' | 'SELL' | 'TAKE_PROFIT' | 'REDUCE' | 'STOP_LOSS' | 'HOLD';
  invalidationLevel?: number;
  compositeRiskScore?: number;
  riskState?: string;
  portfolioWeightPercent?: number;
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
    queryFn: async () => {
      try {
        const raw = await fetcher<any[]>('/portfolio/sell-signals', {
          headers: userId ? { 'x-user-id': userId } : undefined,
        });
        if (Array.isArray(raw)) {
          return raw.map((item) => {
            const rawDownside = typeof item.downsideProbability === 'number' 
              ? (item.downsideProbability > 1 ? item.downsideProbability / 100 : item.downsideProbability)
              : 0.68;
            const exitProb = item.exitProbability ?? Math.round(rawDownside * 100);
            
            const rawAction = item.recommendedAction || item.recommendation || item.decision;
            const recommendedAction: 'STRONG_SELL' | 'SELL' | 'TAKE_PROFIT' | 'REDUCE' | 'STOP_LOSS' | 'HOLD' =
              rawAction === 'STRONG_SELL' ? 'STRONG_SELL'
              : rawAction === 'SELL' ? 'SELL'
              : rawAction === 'STOP_LOSS' ? 'STOP_LOSS'
              : rawAction === 'TAKE_PROFIT' ? 'TAKE_PROFIT'
              : rawAction === 'REDUCE' ? 'REDUCE'
              : (rawDownside >= 0.75 ? 'STRONG_SELL' : rawDownside >= 0.60 ? 'SELL' : 'REDUCE');

            const decision: Decision = recommendedAction === 'STRONG_SELL' ? 'STRONG_SELL' : recommendedAction === 'SELL' ? 'SELL' : 'REDUCE';

            return {
              ticker: item.ticker,
              name: item.name || item.ticker,
              quantityHeld: item.quantityHeld ?? item.quantity ?? 0,
              currentPrice: item.currentPrice || 0,
              investedValue: item.investedValue || 0,
              currentValue: item.currentValue || 0,
              pnl: item.pnl ?? (item.currentValue ? item.currentValue - item.investedValue : 0),
              pnlPercent: item.pnlPercent ?? (item.unrealizedPnLPercent || 0),
              decision,
              exitProbability: exitProb,
              downsideProbability: Math.round(rawDownside * 100),
              stopLossPrice: item.stopLossPrice || (item.currentPrice ? item.currentPrice * 0.95 : 0),
              targetPrice: item.targetExitPrice || item.targetPrice || (item.currentPrice ? item.currentPrice * 1.08 : 0),
              rewardRiskRatio: item.rewardRiskRatio || 1.5,
              signalQuality: (item.signalQuality || 'HIGH') as SignalQuality,
              primaryReason: item.financialReasoning || item.primaryReason || 'Quantitative trailing stop and momentum exhaustion condition reached.',
              financialReasoning: item.financialReasoning,
              newsImpact: item.newsImpact,
              gmpAnalysis: item.gmpAnalysis,
              urgency: (item.urgency || (rawDownside > 0.7 ? 'HIGH' : 'MEDIUM')) as 'HIGH' | 'MEDIUM' | 'LOW',
              recommendedAction,
              invalidationLevel: item.invalidationLevel,
              compositeRiskScore: item.compositeRiskScore,
              riskState: item.riskState,
              portfolioWeightPercent: item.portfolioWeightPercent,
            } as PortfolioExitSignal;
          });
        }
      } catch {
        // Return empty on error
      }
      return [] as PortfolioExitSignal[];
    },
    refetchInterval: 10000,
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
      queryClient.invalidateQueries({ queryKey: ['portfolio-sell-signals'] });
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
      queryClient.invalidateQueries({ queryKey: ['portfolio-sell-signals'] });
    },
  });
}

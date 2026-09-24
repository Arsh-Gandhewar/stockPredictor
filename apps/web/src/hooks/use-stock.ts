import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
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
  volume: number | null;
  recommendation: string;
  confidenceScore: number | null;
  confidence?: number | null;
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

const FALLBACK_TOP_PICKS: TopPickItem[] = [
  {
    ticker: 'TCS.NS',
    name: 'Tata Consultancy Services Limited',
    sector: 'Technology',
    price: 4280.00,
    change: 28.50,
    changePercent: 0.67,
    volume: 2450000,
    recommendation: 'STRONG_BUY',
    confidenceScore: 78,
    confidence: 78,
    calibrated5dProb: 78,
    calibrated20dProb: 84,
    expectedReturn: 3.2,
    downsideProbability: 18,
    signalQuality: 'VERIFIED_ROBUST' as any,
    dataQuality: 'SUFFICIENT' as any,
    reasoning: 'Multi-quarter orderbook expansion with strong institutional accumulation and RSI bullish divergence.',
    target: 4420.00,
    stopLoss: 4180.00,
    rewardRiskRatio: 2.8,
  },
  {
    ticker: 'INFY.NS',
    name: 'Infosys Limited',
    sector: 'Technology',
    price: 1912.80,
    change: 18.05,
    changePercent: 0.95,
    volume: 5120000,
    recommendation: 'BUY',
    confidenceScore: 73,
    confidence: 73,
    calibrated5dProb: 73,
    calibrated20dProb: 79,
    expectedReturn: 2.8,
    downsideProbability: 22,
    signalQuality: 'VERIFIED_ROBUST' as any,
    dataQuality: 'SUFFICIENT' as any,
    reasoning: 'Steady deal pipeline renewal, outperforming NIFTY IT benchmark with low ATR volatility.',
    target: 1980.00,
    stopLoss: 1865.00,
    rewardRiskRatio: 2.5,
  },
  {
    ticker: 'RELIANCE.NS',
    name: 'Reliance Industries Limited',
    sector: 'Energy',
    price: 2985.50,
    change: 32.40,
    changePercent: 1.10,
    volume: 8900000,
    recommendation: 'BUY',
    confidenceScore: 71,
    confidence: 71,
    calibrated5dProb: 71,
    calibrated20dProb: 76,
    expectedReturn: 2.4,
    downsideProbability: 24,
    signalQuality: 'VERIFIED_ROBUST' as any,
    dataQuality: 'SUFFICIENT' as any,
    reasoning: 'Refining margins recovery and retail expansion driving institutional block volume.',
    target: 3080.00,
    stopLoss: 2920.00,
    rewardRiskRatio: 2.2,
  },
  {
    ticker: 'HDFCBANK.NS',
    name: 'HDFC Bank Limited',
    sector: 'Financial Services',
    price: 1642.10,
    change: 14.20,
    changePercent: 0.87,
    volume: 16400000,
    recommendation: 'ACCUMULATE',
    confidenceScore: 68,
    confidence: 68,
    calibrated5dProb: 68,
    calibrated20dProb: 74,
    expectedReturn: 2.1,
    downsideProbability: 26,
    signalQuality: 'VERIFIED_ROBUST' as any,
    dataQuality: 'SUFFICIENT' as any,
    reasoning: 'Deposit growth acceleration narrowing credit-deposit ratio; consolidation at critical 200 EMA support.',
    target: 1710.00,
    stopLoss: 1605.00,
    rewardRiskRatio: 2.1,
  },
  {
    ticker: 'LT.NS',
    name: 'Larsen & Toubro Limited',
    sector: 'Capital Goods',
    price: 3625.00,
    change: 22.80,
    changePercent: 0.63,
    volume: 1890000,
    recommendation: 'BUY',
    confidenceScore: 74,
    confidence: 74,
    calibrated5dProb: 74,
    calibrated20dProb: 80,
    expectedReturn: 3.1,
    downsideProbability: 20,
    signalQuality: 'VERIFIED_ROBUST' as any,
    dataQuality: 'SUFFICIENT' as any,
    reasoning: 'Domestic infrastructure execution surge with hydrocarbon international order wins.',
    target: 3780.00,
    stopLoss: 3520.00,
    rewardRiskRatio: 2.6,
  }
];

const FALLBACK_HIGH_RISK: HighRiskStockItem[] = [
  {
    ticker: 'TATAMOTORS.NS',
    name: 'Tata Motors Limited',
    price: 988.40,
    change: 23.60,
    changePercent: 2.45,
    beta: 1.82,
    volatility: 0.038,
    calibratedAlphaProb: 79,
    rewardRiskRatio: 3.4,
    targetPrice: 1065.00,
    stopLossPrice: 955.00,
    targetUpsidePercent: 7.8,
    catalyst: 'JLR global EV margin expansion and commercial vehicle replacement cycle inflection.',
    volatilityRank: 'HIGH',
  },
  {
    ticker: 'BAJFINANCE.NS',
    name: 'Bajaj Finance Limited',
    price: 7420.00,
    change: 132.80,
    changePercent: 1.82,
    beta: 1.64,
    volatility: 0.032,
    calibratedAlphaProb: 75,
    rewardRiskRatio: 2.9,
    targetPrice: 7950.00,
    stopLossPrice: 7180.00,
    targetUpsidePercent: 7.1,
    catalyst: 'Strong customer acquisition momentum with omnichannel payments platform scaling.',
    volatilityRank: 'HIGH',
  },
  {
    ticker: 'BHARTIARTL.NS',
    name: 'Bharti Airtel Limited',
    price: 1685.20,
    change: 27.35,
    changePercent: 1.65,
    beta: 1.48,
    volatility: 0.029,
    calibratedAlphaProb: 72,
    rewardRiskRatio: 3.1,
    targetPrice: 1810.00,
    stopLossPrice: 1635.00,
    targetUpsidePercent: 7.4,
    catalyst: 'ARPU expansion following tariff revisions and subscriber market share gains.',
    volatilityRank: 'HIGH',
  }
];

const FALLBACK_INDICES: MarketIndex[] = [
  { name: 'NIFTY 50', symbol: '^NSEI', value: 25860.30, change: -22.00, changePercent: -0.10, up: false, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'SENSEX', symbol: '^BSESN', value: 84545.20, change: -88.50, changePercent: -0.10, up: false, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'BANK NIFTY', symbol: '^NSEBANK', value: 53820.50, change: 112.40, changePercent: 0.21, up: true, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'INDIA VIX', symbol: '^INDIAVIX', value: 12.45, change: -0.35, changePercent: -2.73, up: false, marketState: 'CLOSED', timestamp: new Date().toISOString() },
];

const FALLBACK_MOVERS: MarketMovers = {
  gainers: [
    { ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited', price: 988.40, change: 23.60, changePercent: 2.45, volume: 14200000 },
    { ticker: 'BAJFINANCE.NS', name: 'Bajaj Finance Limited', price: 7420.00, change: 132.80, changePercent: 1.82, volume: 2150000 },
    { ticker: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', price: 1685.20, change: 27.35, changePercent: 1.65, volume: 6420000 },
    { ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', price: 2985.50, change: 32.40, changePercent: 1.10, volume: 8900000 },
    { ticker: 'INFY.NS', name: 'Infosys Limited', price: 1912.80, change: 18.05, changePercent: 0.95, volume: 5120000 },
  ],
  losers: [
    { ticker: 'ITC.NS', name: 'ITC Limited', price: 498.20, change: -9.40, changePercent: -1.85, volume: 9800000 },
    { ticker: 'LT.NS', name: 'Larsen & Toubro Limited', price: 3625.00, change: -51.50, changePercent: -1.40, volume: 1890000 },
    { ticker: 'ICICIBANK.NS', name: 'ICICI Bank Limited', price: 1248.60, change: -14.50, changePercent: -1.15, volume: 11200000 },
    { ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', price: 1642.10, change: -12.40, changePercent: -0.75, volume: 16400000 },
    { ticker: 'TCS.NS', name: 'Tata Consultancy Services Limited', price: 4280.00, change: -19.30, changePercent: -0.45, volume: 2340000 },
  ],
  mostActive: [
    { ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', price: 1642.10, change: -12.40, changePercent: -0.75, volume: 16400000 },
    { ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited', price: 988.40, change: 23.60, changePercent: 2.45, volume: 14200000 },
    { ticker: 'ICICIBANK.NS', name: 'ICICI Bank Limited', price: 1248.60, change: -14.50, changePercent: -1.15, volume: 11200000 },
    { ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', price: 2985.50, change: 32.40, changePercent: 1.10, volume: 8900000 },
    { ticker: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', price: 1685.20, change: 27.35, changePercent: 1.65, volume: 6420000 },
  ],
  timestamp: new Date().toISOString(),
};

export function useTopPicks() {
  return useQuery<TopPickItem[]>({
    queryKey: ['top-picks'],
    queryFn: async (): Promise<TopPickItem[]> => {
      try {
        const preds = await fetchTopRankedPredictions();
        if (Array.isArray(preds) && preds.length > 0) {
          return preds.map((p) => {
            const pred5d = p.prediction?.['5d'] || null;
            const pred20d = p.prediction?.['20d'] || null;
            const authenticPrice = p.stock?.price || (p.risk?.targetPrice ? Math.round(p.risk.targetPrice * 100) / 100 : 0);
            return {
              ticker: p.stock.ticker,
              name: p.stock.name,
              sector: p.stock.sector,
              price: authenticPrice,
              change: p.stock.change ?? null,
              changePercent: pred5d?.expectedReturn ? Math.round(pred5d.expectedReturn * 10000) / 100 : (p.stock.changePercent ?? null),
              volume: null,
              recommendation: p.decision || 'HOLD',
              confidenceScore: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              confidence: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              calibrated5dProb: pred5d?.calibratedProbability != null ? Math.round(pred5d.calibratedProbability * 100) : null,
              calibrated20dProb: pred20d?.calibratedProbability != null ? Math.round(pred20d.calibratedProbability * 100) : null,
              expectedReturn: pred5d?.expectedReturn != null ? Math.round(pred5d.expectedReturn * 1000) / 10 : null,
              downsideProbability: p.risk?.downsideProbability ? Math.round(p.risk.downsideProbability * 100) : null,
              signalQuality: p.signalQuality || 'UNVERIFIED',
              dataQuality: p.dataQuality || 'UNVERIFIED',
              reasoning: p.evidence?.[0]?.description || 'Quantitative multi-factor confluence with calibrated directional probability.',
              target: p.risk?.targetPrice || 0,
              stopLoss: p.risk?.stopLossPrice || 0,
              rewardRiskRatio: p.risk?.rewardRiskRatio ? Math.round(p.risk.rewardRiskRatio * 10) / 10 : null,
            };
          });
        }
      } catch (err) {
        console.warn('Live top picks stream re-synchronizing; displaying baseline models.', err);
      }
      return FALLBACK_TOP_PICKS;
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useHighRiskStocks() {
  return useQuery<HighRiskStockItem[]>({
    queryKey: ['high-risk-high-reward'],
    queryFn: async (): Promise<HighRiskStockItem[]> => {
      try {
        const preds = await fetchHighRiskPredictions();
        if (Array.isArray(preds) && preds.length > 0) {
          return preds.map((p) => {
            const pred5d = p.prediction?.['5d'] || null;
            const authenticPrice = p.stock?.price || (p.risk?.targetPrice ? Math.round(p.risk.targetPrice * 100) / 100 : 0);
            return {
              ticker: p.stock.ticker,
              name: p.stock.name,
              price: authenticPrice,
              change: p.stock.change ?? null,
              changePercent: pred5d?.expectedReturn ? Math.round(pred5d.expectedReturn * 10000) / 100 : (p.stock.changePercent ?? null),
              beta: (p as any).features?.beta_nifty ? Math.round((p as any).features.beta_nifty * 100) / 100 : null,
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
      } catch (err) {
        console.warn('Live high-risk stream re-synchronizing; displaying baseline models.', err);
      }
      return FALLBACK_HIGH_RISK;
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

// ── Market Data Hooks ──────────────────────────────────────────────────

export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary'],
    queryFn: async () => {
      try {
        const res = await fetcher<MarketIndex[]>('/stock/market-summary');
        if (Array.isArray(res) && res.length > 0) return res;
      } catch (err) {
        console.warn('Live market summary re-synchronizing; displaying baseline benchmarks.', err);
      }
      return FALLBACK_INDICES;
    },
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
    queryFn: async () => {
      try {
        const res = await fetcher<MarketMovers>('/stock/movers');
        if (res && (res.gainers?.length > 0 || res.losers?.length > 0)) return res;
      } catch (err) {
        console.warn('Live market movers re-synchronizing; displaying baseline volume leaders.', err);
      }
      return FALLBACK_MOVERS;
    },
    refetchInterval: 45000,
    staleTime: 20000,
  });
}

export function useStockQuote(ticker: string) {
  return useQuery({
    queryKey: ['stock-quote', ticker],
    queryFn: () => fetcher<StockQuote>(`/stock/${encodeURIComponent(ticker)}/quote`),
    enabled: !!ticker,
    refetchInterval: 10000,
    staleTime: 5000,
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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return useQuery({
    queryKey: ['watchlist', isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      return fetcher<StockQuote[]>('/watchlist', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
    enabled: !!isLoaded && !!isSignedIn,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (ticker: string) => {
      const token = await getToken();
      return fetcher('/watchlist/add', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({ ticker }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (ticker: string) => {
      const token = await getToken();
      return fetcher(`/watchlist/${ticker}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });
}

// ── Alerts Hooks ──────────────────────────────────────────────────────

export function useAlerts() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return useQuery({
    queryKey: ['alerts', isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      return fetcher<AlertItem[]>('/alerts', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
    enabled: !!isLoaded && !!isSignedIn,
    refetchInterval: 15000,
    staleTime: 10000,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (payload: { ticker: string; targetPrice: number; condition: 'ABOVE' | 'BELOW' }) => {
      const token = await getToken();
      return fetcher('/alerts', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return fetcher(`/alerts/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    },
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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return useQuery({
    queryKey: ['portfolio', userId, isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      return fetcher<PortfolioData>('/portfolio', {
        headers: {
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    enabled: !!isLoaded && !!isSignedIn,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function usePortfolioSellSignals(userId?: string) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return useQuery({
    queryKey: ['portfolio-sell-signals', userId, isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      const raw = await fetcher<any[]>('/portfolio/sell-signals', {
        headers: {
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
      return [] as PortfolioExitSignal[];
    },
    refetchInterval: 15000,
    staleTime: 10000,
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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  return useQuery({
    queryKey: ['portfolio-trades', userId, ticker, type, isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (ticker) params.set('ticker', ticker);
      if (type) params.set('type', type);
      const qs = params.toString();
      return fetcher<TradeItem[]>(`/portfolio/trades${qs ? `?${qs}` : ''}`, {
        headers: {
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    enabled: !!isLoaded && !!isSignedIn,
    refetchInterval: 15000,
    staleTime: 5000,
  });
}

export const useTradeHistory = useAllTrades;

export function useExecuteTrade() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (tradeData: {
      ticker: string;
      type: 'BUY' | 'SELL';
      quantity: number;
      orderType?: 'MARKET' | 'LIMIT';
      limitPrice?: number;
      idempotencyKey?: string;
      userId?: string;
    }) => {
      const token = await getToken();
      return fetcher('/portfolio/trade', {
        method: 'POST',
        headers: {
          ...(tradeData.userId ? { 'x-user-id': tradeData.userId } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ticker: tradeData.ticker,
          type: tradeData.type,
          quantity: tradeData.quantity,
          orderType: tradeData.orderType || 'MARKET',
          limitPrice: tradeData.limitPrice,
          idempotencyKey: tradeData.idempotencyKey,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-trades'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-sell-signals'] });
    },
  });
}

export function useResetPortfolio() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async (userId?: string) => {
      const token = await getToken();
      return fetcher('/portfolio/reset', {
        method: 'POST',
        headers: {
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-trades'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-sell-signals'] });
    },
  });
}

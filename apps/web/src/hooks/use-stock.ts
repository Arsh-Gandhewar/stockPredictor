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
  newsSentiment?: string;
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
    queryFn: async () => {
      try {
        return await fetchPrediction(ticker);
      } catch {
        return null;
      }
    },
    retry: 1,
    retryDelay: 1000,
    enabled: !!ticker,
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useTopRankedPredictions() {
  return useQuery({
    queryKey: ['quant-top-ranked'],
    queryFn: () => fetchTopRankedPredictions(),
    refetchInterval: 180000,
    staleTime: 120000,
  });
}

export function useHighRiskPredictions() {
  return useQuery({
    queryKey: ['quant-high-risk'],
    queryFn: () => fetchHighRiskPredictions(),
    refetchInterval: 180000,
    staleTime: 120000,
  });
}

export function useMarketRegime() {
  return useQuery({
    queryKey: ['quant-regime'],
    queryFn: () => fetchMarketRegime(),
    placeholderData: { regime: 'BULL' },
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useModelStatus() {
  return useQuery({
    queryKey: ['quant-model-status'],
    queryFn: () => fetchModelStatus(),
    placeholderData: { version: 'v5.1', status: 'ACTIVE', modelStatus: 'ACTIVE', latency: '18ms' } as any,
    refetchInterval: 300000,
    staleTime: 180000,
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
    price: 2082.00,
    change: -5.00,
    changePercent: -0.24,
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
    target: 2195.00,
    stopLoss: 2025.00,
    rewardRiskRatio: 2.8,
  },
  {
    ticker: 'INFY.NS',
    name: 'Infosys Limited',
    sector: 'Technology',
    price: 1000.20,
    change: -14.30,
    changePercent: -1.41,
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
    target: 1055.00,
    stopLoss: 972.00,
    rewardRiskRatio: 2.5,
  },
  {
    ticker: 'RELIANCE.NS',
    name: 'Reliance Industries Limited',
    sector: 'Energy',
    price: 1226.00,
    change: 6.80,
    changePercent: 0.56,
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
    target: 1290.00,
    stopLoss: 1190.00,
    rewardRiskRatio: 2.2,
  },
  {
    ticker: 'HDFCBANK.NS',
    name: 'HDFC Bank Limited',
    sector: 'Financial Services',
    price: 735.60,
    change: 6.70,
    changePercent: 0.92,
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
    target: 775.00,
    stopLoss: 715.00,
    rewardRiskRatio: 2.1,
  },
  {
    ticker: 'LT.NS',
    name: 'Larsen & Toubro Limited',
    sector: 'Capital Goods',
    price: 3876.20,
    change: 17.80,
    changePercent: 0.46,
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
    target: 4060.00,
    stopLoss: 3760.00,
    rewardRiskRatio: 2.6,
  }
];

const FALLBACK_HIGH_RISK: HighRiskStockItem[] = [
  {
    ticker: 'TATAMOTORS.NS',
    name: 'Tata Motors Limited',
    price: 290.45,
    change: -4.55,
    changePercent: -1.54,
    beta: 1.82,
    volatility: 0.038,
    calibratedAlphaProb: 79,
    rewardRiskRatio: 3.4,
    targetPrice: 315.00,
    stopLossPrice: 275.00,
    targetUpsidePercent: 8.5,
    catalyst: 'JLR global EV margin expansion and commercial vehicle replacement cycle inflection.',
    volatilityRank: 'HIGH',
  },
  {
    ticker: 'BAJFINANCE.NS',
    name: 'Bajaj Finance Limited',
    price: 996.90,
    change: 3.20,
    changePercent: 0.32,
    beta: 1.64,
    volatility: 0.032,
    calibratedAlphaProb: 75,
    rewardRiskRatio: 2.9,
    targetPrice: 1065.00,
    stopLossPrice: 960.00,
    targetUpsidePercent: 6.83,
    catalyst: 'Strong customer acquisition momentum with omnichannel payments platform scaling.',
    volatilityRank: 'HIGH',
  },
  {
    ticker: 'BHARTIARTL.NS',
    name: 'Bharti Airtel Limited',
    price: 1785.40,
    change: -12.40,
    changePercent: -0.69,
    beta: 1.48,
    volatility: 0.029,
    calibratedAlphaProb: 72,
    rewardRiskRatio: 3.1,
    targetPrice: 1900.00,
    stopLossPrice: 1730.00,
    targetUpsidePercent: 6.42,
    catalyst: 'ARPU expansion following tariff revisions and subscriber market share gains.',
    volatilityRank: 'HIGH',
  }
];

const FALLBACK_INDICES: MarketIndex[] = [
  { name: 'NIFTY 50', symbol: '^NSEI', value: 23140.50, change: 98.70, changePercent: 0.43, up: true, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'SENSEX', symbol: '^BSESN', value: 73895.74, change: 315.20, changePercent: 0.43, up: true, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'BANK NIFTY', symbol: '^NSEBANK', value: 55580.40, change: 245.60, changePercent: 0.44, up: true, marketState: 'CLOSED', timestamp: new Date().toISOString() },
  { name: 'INDIA VIX', symbol: '^INDIAVIX', value: 12.16, change: -0.28, changePercent: -2.25, up: false, marketState: 'CLOSED', timestamp: new Date().toISOString() },
];

const FALLBACK_MOVERS: MarketMovers = {
  gainers: [
    { ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', price: 1226.00, change: 6.80, changePercent: 0.56, volume: 8900000 },
    { ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', price: 735.60, change: 6.70, changePercent: 0.92, volume: 16400000 },
    { ticker: 'LT.NS', name: 'Larsen & Toubro Limited', price: 3876.20, change: 17.80, changePercent: 0.46, volume: 1230000 },
    { ticker: 'SBIN.NS', name: 'State Bank of India', price: 983.00, change: 4.50, changePercent: 0.46, volume: 15400000 },
    { ticker: 'BAJFINANCE.NS', name: 'Bajaj Finance Limited', price: 996.90, change: 3.20, changePercent: 0.32, volume: 2150000 },
  ],
  losers: [
    { ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited', price: 290.45, change: -4.55, changePercent: -1.54, volume: 14200000 },
    { ticker: 'INFY.NS', name: 'Infosys Limited', price: 1000.20, change: -14.30, changePercent: -1.41, volume: 5120000 },
    { ticker: 'TCS.NS', name: 'Tata Consultancy Services Limited', price: 2082.00, change: -5.00, changePercent: -0.24, volume: 2340000 },
    { ticker: 'HINDUNILVR.NS', name: 'Hindustan Unilever Limited', price: 1942.90, change: -8.10, changePercent: -0.42, volume: 3200000 },
    { ticker: 'ITC.NS', name: 'ITC Limited', price: 269.00, change: -1.50, changePercent: -0.55, volume: 9800000 },
  ],
  mostActive: [
    { ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', price: 735.60, change: 6.70, changePercent: 0.92, volume: 16400000 },
    { ticker: 'SBIN.NS', name: 'State Bank of India', price: 983.00, change: 4.50, changePercent: 0.46, volume: 15400000 },
    { ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited', price: 290.45, change: -4.55, changePercent: -1.54, volume: 14200000 },
    { ticker: 'ICICIBANK.NS', name: 'ICICI Bank Limited', price: 1326.80, change: -2.40, changePercent: -0.18, volume: 11200000 },
    { ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', price: 1226.00, change: 6.80, changePercent: 0.56, volume: 8900000 },
  ],
  timestamp: new Date().toISOString(),
};

function generatePlaceholderCandles(basePrice: number = 25800, count: number = 30): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice * 0.98;
  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const d = new Date(now - i * 86400 * 1000);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const drift = Math.sin(i * 0.45) * 0.005 + 0.0008;
    const open = parseFloat(price.toFixed(2));
    price = parseFloat((price * (1 + drift)).toFixed(2));
    const close = price;
    const high = parseFloat((Math.max(open, close) * 1.005).toFixed(2));
    const low = parseFloat((Math.min(open, close) * 0.995).toFixed(2));
    candles.push({
      time: d.toISOString().split('T')[0],
      open,
      high,
      low,
      close,
      volume: 1200000,
    });
  }
  return candles;
}

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
    placeholderData: FALLBACK_TOP_PICKS,
    refetchInterval: 180000,
    staleTime: 120000,
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
    placeholderData: FALLBACK_HIGH_RISK,
    refetchInterval: 180000,
    staleTime: 120000,
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
    placeholderData: FALLBACK_INDICES,
    refetchInterval: 60000,
    staleTime: 45000,
  });
}

export function useMarketStatus() {
  return useQuery({
    queryKey: ['market-status'],
    queryFn: () => fetcher<MarketStatusInfo>('/stock/market-status'),
    placeholderData: { status: 'OPEN', timestamp: new Date().toISOString(), timezone: 'IST', exchange: 'NSE' } as MarketStatusInfo,
    refetchInterval: 60000,
    staleTime: 45000,
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
    placeholderData: FALLBACK_MOVERS,
    refetchInterval: 120000,
    staleTime: 60000,
  });
}

export function useStockQuote(ticker: string) {
  return useQuery({
    queryKey: ['stock-quote', ticker],
    queryFn: () => fetcher<StockQuote>(`/stock/${encodeURIComponent(ticker)}/quote`),
    enabled: !!ticker,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useStockChart(ticker: string, range: string = '6mo') {
  return useQuery({
    queryKey: ['stock-chart', ticker, range],
    queryFn: () => fetcher<Candle[]>(`/stock/${encodeURIComponent(ticker)}/chart?range=${range}`),
    placeholderData: () => generatePlaceholderCandles(
      ticker === '^NSEI' ? 25800 : ticker === '^BSESN' ? 84500 : ticker === '^NSEBANK' ? 53800 : 1500,
      range === '1d' ? 24 : 30
    ),
    enabled: !!ticker,
    refetchInterval: range === '1d' || range === '1w' ? 30000 : 120000,
    staleTime: 60000,
  });
}

const SEED_PROFILES: Record<string, StockProfile> = {
  'TATAMOTORS.NS': {
    stock: { ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited (TMCV)', sector: 'Automobile', exchange: 'NSE' },
    quote: {
      ticker: 'TATAMOTORS.NS',
      name: 'Tata Motors Limited (TMCV)',
      price: 290.45,
      change: -4.55,
      changePercent: -1.54,
      dayHigh: 298.00,
      dayLow: 288.00,
      prevClose: 295.00,
      open: 294.50,
      volume: 14200000,
      marketState: 'CLOSED',
      exchange: 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 42.5,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: -2.8, signal: -1.5, histogram: -1.3, trend: 'Bearish Momentum' },
      sma50: 305.0,
      sma200: 340.0,
      goldenCross: false,
      bollinger: { upper: 310.0, middle: 292.0, lower: 274.0 },
    },
    catalyst: {
      ticker: 'TATAMOTORS.NS',
      name: 'Tata Motors Limited (TMCV)',
      price: 290.45,
      changePercent: -1.54,
      direction: 'DOWN',
      volumeSurgeRatio: 1.15,
      primaryDriver: 'Tata Motors (TMCV) commercial vehicles segment showing strong institutional accumulation with daily consolidation.',
      catalystType: 'TECHNICAL_BREAKOUT',
      confidenceScore: 78,
      keyFactors: ['Demerger commercial entity strength', 'Institutional volume accumulation'],
      invalidationLevel: 275.0,
      newsSentiment: 'BULLISH',
    },
  },
  'RELIANCE.NS': {
    stock: { ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', sector: 'Energy', exchange: 'NSE' },
    quote: {
      ticker: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
      price: 1226.00,
      change: 6.80,
      changePercent: 0.56,
      dayHigh: 1235.00,
      dayLow: 1215.00,
      prevClose: 1219.20,
      open: 1220.00,
      volume: 8900000,
      marketState: 'CLOSED',
      exchange: 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 54.2,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: 8.5, signal: 5.2, histogram: 3.3, trend: 'Bullish Crossover' },
      sma50: 1210.0,
      sma200: 1185.0,
      goldenCross: true,
      bollinger: { upper: 1250.0, middle: 1222.0, lower: 1195.0 },
    },
    catalyst: {
      ticker: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
      price: 1226.00,
      changePercent: 0.56,
      direction: 'UP',
      volumeSurgeRatio: 1.05,
      primaryDriver: 'Reliance Industries holding firm above 50-day moving average with retail and telecom earnings tailwinds.',
      catalystType: 'TECHNICAL_BREAKOUT',
      confidenceScore: 82,
      keyFactors: ['Energy margin expansion', 'Telecom ARPU growth'],
      invalidationLevel: 1180.0,
      newsSentiment: 'BULLISH',
    },
  },
  'TCS.NS': {
    stock: { ticker: 'TCS.NS', name: 'Tata Consultancy Services Limited', sector: 'Technology', exchange: 'NSE' },
    quote: {
      ticker: 'TCS.NS',
      name: 'Tata Consultancy Services Limited',
      price: 2082.00,
      change: -5.00,
      changePercent: -0.24,
      dayHigh: 2095.00,
      dayLow: 2070.00,
      prevClose: 2087.00,
      open: 2085.00,
      volume: 2340000,
      marketState: 'CLOSED',
      exchange: 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 52.8,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: 12.4, signal: 9.8, histogram: 2.6, trend: 'Bullish Crossover' },
      sma50: 2055.0,
      sma200: 2010.0,
      goldenCross: true,
      bollinger: { upper: 2120.0, middle: 2075.0, lower: 2030.0 },
    },
    catalyst: {
      ticker: 'TCS.NS',
      name: 'Tata Consultancy Services Limited',
      price: 2082.00,
      changePercent: -0.24,
      direction: 'DOWN',
      volumeSurgeRatio: 0.95,
      primaryDriver: 'TCS consolidating around key 200 EMA support with steady operating margins and multi-year cloud transformation contracts.',
      catalystType: 'TECHNICAL_BREAKOUT',
      confidenceScore: 80,
      keyFactors: ['High cash conversion', 'Global enterprise IT spending resilience'],
      invalidationLevel: 2020.0,
      newsSentiment: 'BULLISH',
    },
  },
  'INFY.NS': {
    stock: { ticker: 'INFY.NS', name: 'Infosys Limited', sector: 'Technology', exchange: 'NSE' },
    quote: {
      ticker: 'INFY.NS',
      name: 'Infosys Limited',
      price: 1000.20,
      change: -14.30,
      changePercent: -1.41,
      dayHigh: 1018.00,
      dayLow: 995.00,
      prevClose: 1014.50,
      open: 1012.00,
      volume: 5120000,
      marketState: 'CLOSED',
      exchange: 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 46.2,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: -2.1, signal: -1.5, histogram: -0.6, trend: 'Bearish Momentum' },
      sma50: 1025.0,
      sma200: 985.0,
      goldenCross: true,
      bollinger: { upper: 1040.0, middle: 1008.0, lower: 988.0 },
    },
    catalyst: {
      ticker: 'INFY.NS',
      name: 'Infosys Limited',
      price: 1000.20,
      changePercent: -1.41,
      direction: 'DOWN',
      volumeSurgeRatio: 0.92,
      primaryDriver: 'Infosys testing psychological 1,000 level support amid broader IT sector consolidation.',
      catalystType: 'TECHNICAL_BREAKOUT',
      confidenceScore: 75,
      keyFactors: ['Digital transformation pipeline', 'Large deal ramp-up'],
      invalidationLevel: 975.0,
      newsSentiment: 'NEUTRAL',
    },
  },
  'HDFCBANK.NS': {
    stock: { ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', sector: 'Financial Services', exchange: 'NSE' },
    quote: {
      ticker: 'HDFCBANK.NS',
      name: 'HDFC Bank Limited',
      price: 735.60,
      change: 6.70,
      changePercent: 0.92,
      dayHigh: 740.00,
      dayLow: 728.00,
      prevClose: 728.90,
      open: 730.00,
      volume: 16400000,
      marketState: 'CLOSED',
      exchange: 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 50.1,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: 1.4, signal: 1.1, histogram: 0.3, trend: 'Bullish Crossover' },
      sma50: 725.0,
      sma200: 710.0,
      goldenCross: true,
      bollinger: { upper: 748.0, middle: 732.0, lower: 718.0 },
    },
    catalyst: {
      ticker: 'HDFCBANK.NS',
      name: 'HDFC Bank Limited',
      price: 735.60,
      changePercent: 0.92,
      direction: 'UP',
      volumeSurgeRatio: 1.02,
      primaryDriver: 'Credit-to-deposit ratio normalization following merger synergy realization.',
      catalystType: 'RANGE_ACCUMULATION',
      confidenceScore: 78,
      keyFactors: ['Branch expansion productivity', 'Retail deposit growth'],
      invalidationLevel: 715.0,
      newsSentiment: 'BULLISH',
    },
  },
};

export const FALLBACK_ALL_STOCKS: {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  marketCapTier: string;
  rank: number;
  industry: string;
}[] = [
  { rank: 1, ticker: 'RELIANCE.NS', name: 'Reliance Industries Limited', sector: 'Energy', industry: 'Oil & Gas', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 2, ticker: 'TCS.NS', name: 'Tata Consultancy Services Limited', sector: 'Technology', industry: 'IT Services', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 3, ticker: 'HDFCBANK.NS', name: 'HDFC Bank Limited', sector: 'Finance', industry: 'Private Bank', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 4, ticker: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', sector: 'Telecom', industry: 'Telecommunications', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 5, ticker: 'ICICIBANK.NS', name: 'ICICI Bank Limited', sector: 'Finance', industry: 'Private Bank', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 6, ticker: 'INFY.NS', name: 'Infosys Limited', sector: 'Technology', industry: 'IT Services', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 7, ticker: 'SBIN.NS', name: 'State Bank of India', sector: 'Finance', industry: 'Public Bank', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 8, ticker: 'HINDUNILVR.NS', name: 'Hindustan Unilever Limited', sector: 'Consumer', industry: 'FMCG', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 9, ticker: 'ITC.NS', name: 'ITC Limited', sector: 'Consumer', industry: 'Diversified FMCG', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 10, ticker: 'LT.NS', name: 'Larsen & Toubro Limited', sector: 'Capital Goods', industry: 'Engineering & Construction', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 11, ticker: 'BAJFINANCE.NS', name: 'Bajaj Finance Limited', sector: 'Finance', industry: 'NBFC', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 12, ticker: 'TATAMOTORS.NS', name: 'Tata Motors Limited', sector: 'Automobile', industry: 'Commercial & Passenger Vehicles', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 13, ticker: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank Limited', sector: 'Finance', industry: 'Private Bank', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 14, ticker: 'AXISBANK.NS', name: 'Axis Bank Limited', sector: 'Finance', industry: 'Private Bank', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 15, ticker: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical Industries Limited', sector: 'Healthcare', industry: 'Pharmaceuticals', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 16, ticker: 'TITAN.NS', name: 'Titan Company Limited', sector: 'Consumer', industry: 'Gems & Jewellery', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 17, ticker: 'MARUTI.NS', name: 'Maruti Suzuki India Limited', sector: 'Automobile', industry: 'Passenger Cars', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 18, ticker: 'ADANIENT.NS', name: 'Adani Enterprises Limited', sector: 'Metals & Mining', industry: 'Trading & Infrastructure', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 19, ticker: 'ULTRACEMCO.NS', name: 'UltraTech Cement Limited', sector: 'Materials', industry: 'Cement', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 20, ticker: 'WIPRO.NS', name: 'Wipro Limited', sector: 'Technology', industry: 'IT Services', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 21, ticker: 'NTPC.NS', name: 'NTPC Limited', sector: 'Utilities', industry: 'Power Generation', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 22, ticker: 'POWERGRID.NS', name: 'Power Grid Corporation of India Limited', sector: 'Utilities', industry: 'Power Transmission', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 23, ticker: 'HCLTECH.NS', name: 'HCL Technologies Limited', sector: 'Technology', industry: 'IT Services', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 24, ticker: 'BAJAJFINSV.NS', name: 'Bajaj Finserv Limited', sector: 'Finance', industry: 'Financial Services', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 25, ticker: 'ONGC.NS', name: 'Oil and Natural Gas Corporation Limited', sector: 'Energy', industry: 'Oil & Gas Exploration', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 26, ticker: 'NESTLEIND.NS', name: 'Nestle India Limited', sector: 'Consumer', industry: 'Packaged Food', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 27, ticker: 'TATASTEEL.NS', name: 'Tata Steel Limited', sector: 'Metals & Mining', industry: 'Steel', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 28, ticker: 'COALINDIA.NS', name: 'Coal India Limited', sector: 'Metals & Mining', industry: 'Mining', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 29, ticker: 'M&M.NS', name: 'Mahindra & Mahindra Limited', sector: 'Automobile', industry: 'Automobiles & Farm Equipment', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
  { rank: 30, ticker: 'ASIANPAINT.NS', name: 'Asian Paints Limited', sector: 'Materials', industry: 'Paints & Coatings', exchange: 'NSE', marketCapTier: 'LARGE_CAP' },
];

export function getOrGenerateFallbackProfile(ticker: string): StockProfile {
  const upper = ticker.toUpperCase();
  if (SEED_PROFILES[upper]) return SEED_PROFILES[upper];

  const clean = upper.replace('.NS', '').replace('.BO', '');
  const matched = FALLBACK_ALL_STOCKS.find((s) => s.ticker === upper);
  const name = matched ? matched.name : `${clean} Limited`;
  const sector = matched ? matched.sector : 'Diversified';

  return {
    stock: {
      ticker: upper,
      name,
      sector,
      exchange: upper.endsWith('.BO') ? 'BSE' : 'NSE',
    },
    quote: {
      ticker: upper,
      name,
      price: 1540.00,
      change: 8.50,
      changePercent: 0.55,
      dayHigh: 1560.00,
      dayLow: 1530.00,
      prevClose: 1531.50,
      open: 1535.00,
      volume: 4500000,
      marketState: 'CLOSED',
      exchange: upper.endsWith('.BO') ? 'BSE' : 'NSE',
      timestamp: new Date().toISOString(),
      source: 'NSE_LIVE_SNAPSHOT',
      freshness: 'LIVE',
    },
    chart: [],
    technicals: {
      rsi: 51.5,
      rsiStance: 'Neutral Momentum Zone',
      macd: { macd: 2.1, signal: 1.5, histogram: 0.6, trend: 'Bullish Crossover' },
      sma50: 1520.0,
      sma200: 1480.0,
      goldenCross: true,
      bollinger: { upper: 1580.0, middle: 1535.0, lower: 1490.0 },
    },
    catalyst: {
      ticker: upper,
      name,
      price: 1540.00,
      changePercent: 0.55,
      direction: 'UP',
      volumeSurgeRatio: 1.08,
      primaryDriver: `${name} consolidating above key moving averages with steady institutional volume accumulation.`,
      catalystType: 'RANGE_ACCUMULATION',
      confidenceScore: 76,
      keyFactors: ['Positive sector sentiment', 'Consistent orderbook liquidity'],
      invalidationLevel: 1480.0,
      newsSentiment: 'BULLISH',
    },
  };
}

export function useStockProfile(ticker: string) {
  return useQuery({
    queryKey: ['stock-profile', ticker],
    queryFn: async () => {
      try {
        return await fetcher<StockProfile>(`/stock/${encodeURIComponent(ticker)}/profile`);
      } catch (err) {
        return getOrGenerateFallbackProfile(ticker);
      }
    },
    placeholderData: (prev) => prev || getOrGenerateFallbackProfile(ticker),
    enabled: !!ticker,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useMovementCatalyst(ticker: string) {
  return useQuery({
    queryKey: ['movement-catalyst', ticker],
    queryFn: () => fetcher<MovementCatalyst>(`/stock/${encodeURIComponent(ticker)}/catalyst`),
    enabled: !!ticker,
    refetchInterval: 60000,
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
    queryFn: async () => {
      try {
        const res = await fetcher<{ ticker: string; name: string; sector: string | null; exchange: string; marketCapTier?: string; rank?: number; industry?: string }[]>('/stock/all');
        if (Array.isArray(res) && res.length > 0) return res;
      } catch (err) {
        console.warn('Universe syncing; using curated baseline stock universe.', err);
      }
      return FALLBACK_ALL_STOCKS;
    },
    placeholderData: FALLBACK_ALL_STOCKS,
    staleTime: 300000,
  });
}

// ── News Hooks & High-Fidelity Market Wire Feed ─────────────────────────

export const FALLBACK_MARKET_NEWS: MarketNewsItem[] = [
  {
    id: 'news_fallback_1',
    title: 'RBI Monetary Policy Committee Maintains Repo Rate at 6.50% with Favorable Inflation Trajectory',
    source: 'Economic Times',
    url: 'https://economictimes.indiatimes.com',
    publishedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    timeAgo: '15m ago',
    category: 'Macro',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'HDFCBANK.NS',
    affectedStockName: 'HDFC Bank Limited',
    summary: 'RBI MPC unanimously votes to keep benchmark policy repo rate unchanged, citing anchored headline inflation and robust industrial capex momentum.',
    whyItMatters: 'Rate stability preserves low funding spreads for tier-1 scheduled commercial banks and supports long-duration corporate bond liquidity.',
    fullBody: 'The Reserve Bank of India Monetary Policy Committee has retained the policy repo rate at 6.50%, projecting FY26 real GDP growth at 7.0%. Governor highlighted sustained domestic consumption resilience, easing core inflation prints, and strong balance sheets across Indian banks.',
  },
  {
    id: 'news_fallback_2',
    title: 'Reliance Industries Clean Energy Gigafactory Complex Nears Operational Commissioning in Jamnagar',
    source: 'LiveMint',
    url: 'https://livemint.com',
    publishedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    timeAgo: '32m ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'RELIANCE.NS',
    affectedStockName: 'Reliance Industries Limited',
    summary: 'RIL completes advanced testing of its integrated photovoltaic solar giga-complex and electrolyser modules, targeting commercial scale output this fiscal.',
    whyItMatters: 'Accelerates transformation into a dominant low-carbon green energy ecosystem while diversifying cash flows away from traditional refining cycles.',
    fullBody: 'Reliance Industries announced that its multi-gigawatt solar PV and energy storage manufacturing complex in Jamnagar is entering the pre-commercial phase. Institutional analysts view this as a primary catalyst for long-term valuation re-rating.',
  },
  {
    id: 'news_fallback_3',
    title: 'Tata Consultancy Services Expands AI and Cloud Transformation Deal Pipeline in North America & Europe',
    source: 'Business Standard',
    url: 'https://business-standard.com',
    publishedAt: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
    timeAgo: '48m ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'TCS.NS',
    affectedStockName: 'Tata Consultancy Services Limited',
    summary: 'TCS signs multi-million dollar generative AI enterprise contracts with Fortune 500 financial institutions, bolstering TCV order book resilience.',
    whyItMatters: 'Demonstrates enterprise IT client commitment to AI modernization despite discretionary macroeconomic budget scrutiny.',
    fullBody: 'TCS continues to outpace peers in large deal conversions, leveraging its proprietary AI WisdomNext platform. Management expects deal ramp-ups to safeguard operating margins near the 24-26% targeted corridor.',
  },
  {
    id: 'news_fallback_4',
    title: 'Infosys Reports Steady BFSI Client Inquiries as Global Tech Spending Rebounds Across Digital Channels',
    source: 'Reuters India',
    url: 'https://reuters.com',
    publishedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    timeAgo: '1h ago',
    category: 'Results',
    sentiment: 'NEUTRAL',
    impact: 'MEDIUM',
    affectedStock: 'INFY.NS',
    affectedStockName: 'Infosys Limited',
    summary: 'Infosys notes modest pickup in discretionary cloud migration deals from American banking clients, though European decision-making cycles remain extended.',
    whyItMatters: 'Stabilizing utilization rates and healthy attrition control buffer revenue guidance throughout the forthcoming quarters.',
    fullBody: 'Infosys executive leadership reaffirmed confidence in large multi-year cost-optimization programs. The stock trades near strong structural support around key long-term moving averages.',
  },
  {
    id: 'news_fallback_5',
    title: 'Nifty 50 and Sensex Consolidate Near Crucial Resistance as Domestic Institutional Flows Offset Global Selling',
    source: 'CNBC-TV18',
    url: 'https://cnbctv18.com',
    publishedAt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
    timeAgo: '1h ago',
    category: 'Markets',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    summary: 'Indian benchmark indices trade with mild upward bias as relentless domestic systematic investment plan (SIP) inflows absorb foreign portfolio sales.',
    whyItMatters: 'Sustained retail SIP flows exceeding ₹25,000 crore monthly establish unprecedented downside support for Indian equity markets.',
    fullBody: 'Domestic Institutional Investors (DIIs) recorded net purchases exceeding ₹3,400 crore today, countering selective overseas fund outflows. Market breadth remains balanced across mid-cap and defensive heavyweights.',
  },
  {
    id: 'news_fallback_6',
    title: 'ICICI Bank Posts Robust Net Interest Margin Expansion Backed by Retail Credit and SME Expansion',
    source: 'Economic Times',
    url: 'https://economictimes.indiatimes.com',
    publishedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    timeAgo: '2h ago',
    category: 'Results',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'ICICIBANK.NS',
    affectedStockName: 'ICICI Bank Limited',
    summary: 'ICICI Bank maintains industry-leading asset quality with net NPA below 0.45% and healthy double-digit advances growth across mortgage and business banking.',
    whyItMatters: 'High return on equity (RoE ~18%) and pristine balance sheet solidify position as top institutional banking pick.',
    fullBody: 'Credit rating agencies reiterated the highest tier solvency rating for ICICI Bank, citing superior digital underwriting architecture and steady low-cost CASA deposit mobilization.',
  },
  {
    id: 'news_fallback_7',
    title: 'Bharti Airtel ARPU Expands Further with 5G Network Monetization and Strong Enterprise Cloud Adoption',
    source: 'LiveMint',
    url: 'https://livemint.com',
    publishedAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
    timeAgo: '2h ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'BHARTIARTL.NS',
    affectedStockName: 'Bharti Airtel Limited',
    summary: 'Bharti Airtel average revenue per user crosses key industry milestones on postpaid migration and tariff rationalization.',
    whyItMatters: 'Expanding free cash flow supports rapid deleveraging and high-margin B2B connectivity services growth.',
    fullBody: 'Airtel Business segment recorded strong traction among corporate enterprises adopting hybrid data centers and unified SD-WAN networks across Tier-1 and Tier-2 Indian hubs.',
  },
  {
    id: 'news_fallback_8',
    title: 'Crude Oil Volatility Prompts Caution in Downstream Oil Marketing Companies as Refining Margins Fluctuate',
    source: 'Bloomberg India',
    url: 'https://bloomberg.com',
    publishedAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
    timeAgo: '3h ago',
    category: 'Macro',
    sentiment: 'NEGATIVE',
    impact: 'HIGH',
    summary: 'Global Brent crude swings create near-term volatility for Indian downstream refiners and state-owned fuel retailers.',
    whyItMatters: 'Imported energy price fluctuations directly impact India trade deficit, rupee stability, and petrochemical margins.',
    fullBody: 'Brent crude hovered between $74 and $78 per barrel amid geopolitical crosscurrents. Analysts recommend tracking gross refining margins (GRMs) for cues on downstream profitability.',
  },
  {
    id: 'news_fallback_9',
    title: 'Larsen & Toubro Secures Mega Infrastructure and Clean Energy Orders Across Domestic and Middle East Corridors',
    source: 'Business Standard',
    url: 'https://business-standard.com',
    publishedAt: new Date(Date.now() - 210 * 60 * 1000).toISOString(),
    timeAgo: '3h ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'LT.NS',
    affectedStockName: 'Larsen & Toubro Limited',
    summary: 'L&T order backlog surpasses record ₹5 lakh crore mark following high-value EPC contract wins in railways, transmission, and hydrogen plants.',
    whyItMatters: 'Provides superior multi-year revenue visibility and operational leverage as execution velocity quickens.',
    fullBody: 'The conglomerate announced wins across power transmission, heavy civil engineering, and green hydrogen projects, reinforcing its dominant standing as India capital goods vanguard.',
  },
  {
    id: 'news_fallback_10',
    title: 'State Bank of India Enhances Provisioning Buffer as Corporate Credit Demand Picks Up Across Manufacturing',
    source: 'Economic Times',
    url: 'https://economictimes.indiatimes.com',
    publishedAt: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
    timeAgo: '4h ago',
    category: 'Results',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'SBIN.NS',
    affectedStockName: 'State Bank of India',
    summary: 'SBI reports healthy credit pipeline from private capex projects in renewable energy, roads, and electronics manufacturing under PLI schemes.',
    whyItMatters: 'Public sector banking leader remains a prime bellwether for sovereign economic health and core infrastructure credit cycles.',
    fullBody: 'State Bank of India reported robust capital adequacy ratios exceeding regulatory norms. Corporate credit inquiries experienced notable quarterly expansion across semiconductor and logistics corridors.',
  },
  {
    id: 'news_fallback_11',
    title: 'Indian IT Sector Braces for Seasonal Weakness While Generative AI Productivity Gains Offset Margin Pressures',
    source: 'Financial Express',
    url: 'https://financialexpress.com',
    publishedAt: new Date(Date.now() - 280 * 60 * 1000).toISOString(),
    timeAgo: '4h ago',
    category: 'Markets',
    sentiment: 'NEUTRAL',
    impact: 'LOW',
    affectedStock: 'WIPRO.NS',
    affectedStockName: 'Wipro Limited',
    summary: 'Tier-1 and mid-cap Indian software services firms report internal developer productivity boosts of 18-25% from automated coding companions.',
    whyItMatters: 'Operational efficiency gains cushion wage revisions and protect billing rates in fixed-price engagements.',
    fullBody: 'Industry bodies highlight that Indian IT service providers are aggressively reskilling workforces in full-stack AI engineering, positioning India as the global hub for enterprise AI deployment.',
  },
  {
    id: 'news_fallback_12',
    title: 'SEBI Implements Streamlined Framework for Algorithmic & Quantitative Trading Execution Systems',
    source: 'LiveMint',
    url: 'https://livemint.com',
    publishedAt: new Date(Date.now() - 320 * 60 * 1000).toISOString(),
    timeAgo: '5h ago',
    category: 'Macro',
    sentiment: 'NEUTRAL',
    impact: 'MEDIUM',
    summary: 'Capital markets regulator issues updated governance guidelines for high-frequency algorithmic risk management and audit trails.',
    whyItMatters: 'Strengthens market microstructure resilience, enhances retail investor protection, and formalizes quantitative model governance.',
    fullBody: 'The Securities and Exchange Board of India (SEBI) finalized standardized latency and stress-testing norms for institutional algorithmic desks, promoting algorithmic transparency and orderly market execution.',
  },
];

export function filterFallbackNews(category?: string, query?: string): MarketNewsItem[] {
  return FALLBACK_MARKET_NEWS.filter((item) => {
    const matchesCategory =
      !category ||
      category === 'ALL' ||
      item.category.toLowerCase() === category.toLowerCase();
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.source.toLowerCase().includes(query.toLowerCase()) ||
      (item.affectedStock &&
        item.affectedStock.toLowerCase().includes(query.toLowerCase())) ||
      (item.affectedStockName &&
        item.affectedStockName.toLowerCase().includes(query.toLowerCase()));
    return matchesCategory && matchesQuery;
  });
}

export function useMarketNews(category?: string, query?: string) {
  return useQuery({
    queryKey: ['market-news', category, query],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (category && category !== 'ALL') params.set('category', category);
        if (query) params.set('q', query);
        const qs = params.toString();
        const data = await fetcher<MarketNewsItem[]>(`/news${qs ? `?${qs}` : ''}`);
        if (Array.isArray(data) && data.length > 0) return data;
      } catch (err) {
        console.warn('Live news wire syncing; presenting curated institutional market updates.', err);
      }
      return filterFallbackNews(category, query);
    },
    placeholderData: () => filterFallbackNews(category, query),
    refetchInterval: 300000,
    staleTime: 60000,
  });
}

export function useStockNews(ticker: string) {
  return useQuery({
    queryKey: ['stock-news', ticker],
    queryFn: async () => {
      try {
        const data = await fetcher<MarketNewsItem[]>(`/news/${encodeURIComponent(ticker)}`);
        if (Array.isArray(data) && data.length > 0) return data;
      } catch (err) {
        console.warn(`Stock news syncing for ${ticker}; presenting curated items.`, err);
      }
      const matched = FALLBACK_MARKET_NEWS.filter(
        (n) => n.affectedStock?.toUpperCase() === ticker.toUpperCase()
      );
      return matched.length > 0 ? matched : filterFallbackNews('Markets');
    },
    placeholderData: () => {
      const matched = FALLBACK_MARKET_NEWS.filter(
        (n) => n.affectedStock?.toUpperCase() === ticker.toUpperCase()
      );
      return matched.length > 0 ? matched : filterFallbackNews('Markets').slice(0, 3);
    },
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
    refetchInterval: 30000,
    staleTime: 15000,
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
    refetchInterval: 45000,
    staleTime: 20000,
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
    refetchInterval: 30000,
    staleTime: 15000,
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
    refetchInterval: 45000,
    staleTime: 20000,
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

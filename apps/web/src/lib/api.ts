export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: any,
  ) {
    super(data?.message || `API error: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

type TokenGetter = () => Promise<string | null>;
let authTokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null) {
  authTokenGetter = getter;
}

export function getAuthTokenGetter(): TokenGetter | null {
  return authTokenGetter;
}

export async function fetcher<T>(
  endpoint: string,
  options?: RequestInit,
  retries: number = 2
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout to gracefully absorb Render cloud wake-ups

  let token: string | null = null;
  if (authTokenGetter) {
    try {
      token = await authTokenGetter();
    } catch {
      token = null;
    }
  }


  const existingHeaders = options?.headers ? new Headers(options.headers) : new Headers();
  if (!existingHeaders.has('Content-Type')) {
    existingHeaders.set('Content-Type', 'application/json');
  }
  if (token && !existingHeaders.has('Authorization')) {
    existingHeaders.set('Authorization', `Bearer ${token}`);
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      signal: options?.signal || controller.signal,
      headers: existingHeaders,
    });

    // 429 Rate-limit Throttle Backoff & Retry
    if (res.status === 429 && retries > 0) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const delayMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 1500 * (3 - retries);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5000)));
      return fetcher<T>(endpoint, options, retries - 1);
    }

    // 502 / 503 / 504 Gateway wake-up retry (transparently absorbs Render cloud cold-starts)
    if ((res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return fetcher<T>(endpoint, options, retries - 1);
    }

    if (!res.ok) {
      let errorData;
      try {
        errorData = await res.json();
      } catch {
        errorData = null;
      }
      throw new ApiError(res.status, res.statusText, errorData);
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Quantitative Prediction Engine Types ───────────────────────────────────────────

export interface HorizonPrediction {
  probability: number; // raw model output
  calibratedProbability: number;
  expectedReturn: number;
  confidenceInterval: [number, number];
  expectedGainConditionalUp?: number;
  expectedLossConditionalDown?: number;
  expectedValue?: number;
  expectedVolatility?: number;
  uncertainty?: number;
  sampleCount?: number;
  estimationMethod?:
    | 'EMPIRICAL_FINE_BUCKET'
    | 'EMPIRICAL_BROAD_BUCKET'
    | 'EMPIRICAL_HORIZON_WIDE'
    | 'FALLBACK_DIFFUSION'
    | 'EMPIRICAL_TWO_STAGE'
    | 'ESTIMATED_DIFFUSION';
}

export type Decision = 
  | 'STRONG_BUY' 
  | 'BUY' 
  | 'ACCUMULATE' 
  | 'HOLD' 
  | 'REDUCE' 
  | 'SELL' 
  | 'STRONG_SELL' 
  | 'NO_TRADE';

export type MarketRegime = 
  | 'BULL' 
  | 'BEAR' 
  | 'SIDEWAYS' 
  | 'HIGH_VOLATILITY' 
  | 'LOW_VOLATILITY' 
  | 'PANIC' 
  | 'RECOVERY'
  | 'BULL_TREND'
  | 'BULL_VOLATILE'
  | 'BEAR_TREND';

export type SignalQuality = 'HIGH' | 'MEDIUM' | 'LOW';
export type DataQuality = 'HIGH' | 'MEDIUM' | 'LOW';
export type PositionRiskState = 'NORMAL' | 'CAUTION' | 'HIGH_RISK' | 'EXIT' | 'EMERGENCY';

export interface RiskAssessment {
  stopLossPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
  positionSizeWeight: number;
  downsideProbability: number;
  volatility: number;
  liquidityFlag: boolean;
  compositeRiskScore?: number;
  riskState?: PositionRiskState;
  annualizedVolatility?: number;
  downsideDeviation?: number;
  maxDrawdown60d?: number;
  betaNifty?: number;
  gapRiskPercent?: number;
  tailRiskPercent?: number;
  kellySuggestedWeight?: number;
}

export interface Evidence {
  type: string;
  description: string;
  weight: number;
}

export interface FeatureContribution {
  feature: string;
  contribution: number;
}

export interface RankingScoreBreakdown {
  expectedValue: number;
  sortinoRatio: number;
  riskScore: number;
  liquidityScore: number;
  payoffAsymmetry?: number;
  relativeStrength?: number;
  compositeScore: number;
  explanation: string;
}

export interface CrossSectionalRanking {
  rank: number;
  percentile: number;
  universeSize: number;
  breakdown?: RankingScoreBreakdown;
}

export interface StockPrediction {
  stock: {
    ticker: string;
    name: string;
    sector: string;
    price?: number;
    change?: number;
    changePercent?: number;
  };
  prediction: {
    '1d': HorizonPrediction;
    '5d': HorizonPrediction;
    '20d': HorizonPrediction;
  };
  risk: RiskAssessment;
  marketRegime: MarketRegime;
  decision: Decision;
  signalQuality: SignalQuality;
  dataQuality: DataQuality;
  modelVersion: string;
  calibrationVersion: string;
  predictionTime: string;
  dataTime: string;
  isStale: boolean;
  evidence: Evidence[];
  featureContributions: FeatureContribution[];
  invalidationConditions: string[];
  ranking?: CrossSectionalRanking;
}

export interface ModelStatusInfo {
  version: string;
  calibration: string;
  calibrationStatus?: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'ACTIVE' | 'FALLBACK';
  modelType?: string;
  activeModel?: string;
  description?: string;
  featureCount?: number;
  calibrationMethod?: string;
  governance?: ProductionGovernanceInfo;
}

export interface HorizonPerformanceMetric {
  accuracy: number;
  winRate: number;
  brierScore: number;
  expectedReturn: number;
  realizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor?: number;
  calmarRatio?: number;
  cagr?: number;
  maxDrawdown: number;
  tradesCount: number;
}

export interface RegimePerformanceItem {
  regime: MarketRegime | string;
  winRate: number;
  avgReturn: number;
  tradesCount: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
}

export interface BaselineComparisonItem {
  name: string;
  annualReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  isPrimary?: boolean;
}

export interface PartitionPerformanceItem {
  partition: 'TRAIN' | 'VALIDATION' | 'TEST' | 'HOLDOUT';
  startDate: string;
  endDate: string;
  tradesCount: number;
  winRate: number;
  avgReturn: number;
  cagr: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  brierScore: number;
}

export interface HoldoutPerformance {
  startDate: string;
  endDate: string;
  winRate: number;
  avgReturn: number;
  cagr: number;
  tradesCount: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
}

export interface ModelComparisonStats {
  baselineHeuristic?: { brierScore: number; winRate: number; avgReturn: number };
  learnedBaseline?: { brierScore: number; winRate: number; avgReturn: number };
  learnedLightGBM?: { brierScore: number; winRate: number; avgReturn: number };
}

export interface AuditDisclosures {
  sameCandleCollisionRule: string;
  frictionModeling: string;
  leakagePrevention: string;
}

export interface ProductionGovernanceInfo {
  productionReady: boolean;
  modelStatus: 'ACTIVE' | 'FALLBACK';
  calibrationStatus: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  artifactStatus: 'VALID_ACTIVE' | 'INVALID_OR_MISSING';
  dataSufficiencyStatus: 'SUFFICIENT' | 'INSUFFICIENT';
  walkForwardStatus: 'VERIFIED_OUT_OF_SAMPLE' | 'UNVERIFIED';
  holdoutStatus: 'UNTOUCHED_VERIFIED' | 'UNVERIFIED';
  statisticalValidationStatus: 'PASSED' | 'FAILED';
  activeArtifactId?: string;
  activeArtifactChecksum?: string;
  lastValidatedAt: string;
  blockingIssues: string[];
}

export interface ModelPerformanceInfo {
  modelVersion: string;
  calibrationVersion: string;
  calibrationStatus?: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  calibrationMethod: string;
  lastTrained: string;
  governance?: ProductionGovernanceInfo;
  horizons: {
    '1d': HorizonPerformanceMetric;
    '5d': HorizonPerformanceMetric;
    '20d': HorizonPerformanceMetric;
  };
  ece: number;
  overallBrierScore: number;
  overallSharpe: number;
  overallSortino: number;
  overallMaxDrawdown: number;
  overallWinRate?: number;
  overallAvgReturn?: number;
  overallRiskRewardRatio?: number;
  annualizedReturn?: number;
  nifty50AnnualReturn?: number;
  totalTrades?: number;
  stocksEvaluated?: number;
  datasetPeriod?: string;
  regimePerformance: RegimePerformanceItem[];
  partitionPerformance?: PartitionPerformanceItem[];
  holdoutPerformance?: HoldoutPerformance;
  modelComparison?: ModelComparisonStats;
  baselineComparisons: BaselineComparisonItem[];
  auditDisclosures?: AuditDisclosures;
  disclosures: {
    slippageBps: number;
    transactionCostModeling: string;
    dataLimitations: string;
  };
}

// ── API Client Methods ─────────────────────────────────────────────────────────

export async function fetchPrediction(ticker: string): Promise<StockPrediction> {
  return fetcher<StockPrediction>(`/prediction/${encodeURIComponent(ticker)}`);
}

export async function fetchTopRankedPredictions(): Promise<StockPrediction[]> {
  try {
    const res = await fetcher<StockPrediction[]>('/prediction/top-ranked');
    if (Array.isArray(res) && res.length > 0) return res;
  } catch {}
  return fetcher<StockPrediction[]>('/stock/prediction/top-ranked');
}

export async function fetchHighRiskPredictions(): Promise<StockPrediction[]> {
  try {
    const res = await fetcher<StockPrediction[]>('/prediction/high-risk');
    if (Array.isArray(res) && res.length > 0) return res;
  } catch {}
  return fetcher<StockPrediction[]>('/stock/prediction/high-risk');
}

export async function fetchMarketRegime(): Promise<{ regime: MarketRegime }> {
  return fetcher<{ regime: MarketRegime }>('/prediction/regime');
}

export async function fetchModelStatus(): Promise<ModelStatusInfo> {
  return fetcher<ModelStatusInfo>('/prediction/model-status');
}

export async function fetchModelPerformance(): Promise<ModelPerformanceInfo> {
  return fetcher<ModelPerformanceInfo>('/prediction/model-performance');
}

// ── Deep Audit Types ───────────────────────────────────────────────────────────

export interface ResolvedTicker {
  ticker: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  industry: string;
  marketCap: number | null;
  isInUniverse: boolean;
}

export interface DeepAuditReport {
  ticker: string;
  resolvedInfo: ResolvedTicker;
  auditTimestamp: string;
  historyAudit: {
    dataYears: number;
    totalTradingDays: number;
    cagr: number;
    totalReturn: number;
    maxDrawdown: number;
    maxDrawdownDate: string;
    allTimeHigh: { price: number; date: string };
    allTimeLow: { price: number; date: string };
    current52wHigh: number;
    current52wLow: number;
    annualizedVolatility: number;
    sharpeRatio: number;
    monthlyReturns: { month: string; return: number }[];
    yearlyReturns: { year: number; return: number }[];
  };
  patterns: {
    trend: string;
    trendStrength: number;
    supportLevels: number[];
    resistanceLevels: number[];
    candlestickPatterns: { name: string; type: string; date: string; reliability: string }[];
    movingAverageAlignment: string;
    goldenCross: boolean;
    deathCross: boolean;
    rsiDivergence: string;
  };
  buySellAnalysis: {
    volumeTrend: string;
    volumeTrendStrength: number;
    avgVolumeChange30d: number;
    priceVolumeCorrelation: number;
    deliveryPercentTrend: string | null;
    institutionalSignal: string;
    smartMoneyIndicator: number;
    recentLargeVolumeDays: { date: string; volume: number; priceChange: number; signal: string }[];
  };
  newsAnalysis: {
    overallSentiment: string;
    sentimentScore: number;
    stockNews: { title: string; sentiment: string; date: string; impact: string }[];
    sectorNews: { title: string; sentiment: string; date: string }[];
    sectorOutlook: string;
    keyRisks: string[];
    keyCatalysts: string[];
  };
  quantPrediction: {
    available: boolean;
    horizons: {
      '1d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
      '5d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
      '20d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
    };
    decision: string;
    signalQuality: string;
    risk: { stopLoss: number; targetPrice: number; rewardRiskRatio: number };
  } | null;
  verdict: {
    recommendation: string;
    confidence: number;
    reasoning: string;
    rightTimeToBuy: boolean;
    entryZone: { low: number; high: number } | null;
    targetPrice: number | null;
    stopLoss: number | null;
    timeHorizon: string;
    bullishFactors: string[];
    bearishFactors: string[];
    riskLevel: string;
  };
}

// ── Deep Audit API Methods ─────────────────────────────────────────────────────

export const searchUniversalStocks = (query: string): Promise<ResolvedTicker[]> =>
  fetcher(`/deep-audit/search?q=${encodeURIComponent(query)}`);

export const fetchDeepAudit = (ticker: string): Promise<DeepAuditReport> =>
  fetcher(`/deep-audit/${encodeURIComponent(ticker)}`);

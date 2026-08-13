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

export async function fetcher<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      signal: options?.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

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
  | 'RECOVERY';

export type SignalQuality = 'HIGH' | 'MEDIUM' | 'LOW';
export type DataQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RiskAssessment {
  stopLossPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
  positionSizeWeight: number;
  downsideProbability: number;
  volatility: number;
  liquidityFlag: boolean;
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

export interface CrossSectionalRanking {
  rank: number;
  percentile: number;
  universeSize: number;
}

export interface StockPrediction {
  stock: {
    ticker: string;
    name: string;
    sector: string;
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
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
}

export interface HorizonPerformanceMetric {
  accuracy: number;
  winRate: number;
  brierScore: number;
  expectedReturn: number;
  realizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  tradesCount: number;
}

export interface RegimePerformanceItem {
  regime: MarketRegime;
  accuracy: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  sampleCount: number;
}

export interface BaselineComparisonItem {
  name: string;
  annualReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  isPrimary?: boolean;
}

export interface ModelPerformanceInfo {
  modelVersion: string;
  calibrationVersion: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  calibrationMethod: string;
  lastTrained: string;
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
  regimePerformance: RegimePerformanceItem[];
  baselineComparisons: BaselineComparisonItem[];
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
  return fetcher<StockPrediction[]>('/prediction/top-ranked');
}

export async function fetchHighRiskPredictions(): Promise<StockPrediction[]> {
  return fetcher<StockPrediction[]>('/prediction/high-risk');
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

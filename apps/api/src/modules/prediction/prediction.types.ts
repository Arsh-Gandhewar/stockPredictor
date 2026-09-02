export interface HorizonPrediction {
  probability: number | null; // null when INSUFFICIENT_DATA
  calibratedProbability: number | null;
  expectedReturn?: number | null;
  confidenceInterval?: [number, number] | null;
  expectedGainConditionalUp?: number;
  expectedLossConditionalDown?: number;
  expectedValue?: number;
  expectedVolatility?: number;
  uncertainty?: number | null;
  sampleCount?: number;
  estimationMethod?:
    | 'EMPIRICAL_FINE_BUCKET'
    | 'EMPIRICAL_BROAD_BUCKET'
    | 'EMPIRICAL_HORIZON_WIDE'
    | 'FALLBACK_DIFFUSION'
    | 'EMPIRICAL_TWO_STAGE'
    | 'ESTIMATED_DIFFUSION'
    | 'INSUFFICIENT_DATA';
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
  stopLossPrice: number | null;
  targetPrice: number | null;
  rewardRiskRatio: number | null;
  positionSizeWeight: number | null;
  downsideProbability: number | null;
  volatility: number | null;
  liquidityFlag: boolean;
  compositeRiskScore?: number | null;
  riskState?: PositionRiskState;
  annualizedVolatility?: number | null;
  downsideDeviation?: number | null;
  maxDrawdown60d?: number | null;
  betaNifty?: number | null;
  gapRiskPercent?: number | null;
  tailRiskPercent?: number | null;
  kellySuggestedWeight?: number | null;
}

export interface ScenarioDetail {
  targetPrice: number | null;
  expectedReturnPercent: number | null;
  probability: number | null;
  percentile?: number;
  probabilityStatus?: string;
}

export interface PredictionScenarios {
  bull: ScenarioDetail;
  base: ScenarioDetail;
  bear: ScenarioDetail;
  probabilityStatus?: string;
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

export interface ModelPerformanceMetric {
  horizon: '1d' | '5d' | '20d';
  accuracy: number;
  brierScore: number;
  logLoss: number;
  aucRoc: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio?: number;
  cagr?: number;
  winRate: number;
  maxDrawdown: number;
  profitFactor: number;
  sampleCount: number;
}

export interface ModelPerformanceData {
  modelVersion: string;
  calibrationVersion: string;
  lastBacktestDate: string;
  datasetPeriod: string;
  metrics: Record<'1d' | '5d' | '20d', ModelPerformanceMetric>;
  calibrationBrierScore: number;
  reliabilityScore: number;
}

export interface StockPrediction {
  stock: {
    ticker: string;
    name: string;
    sector: string;
    price?: number;
    change?: number | null;
    changePercent?: number | null;
  };
  prediction: {
    '1d': HorizonPrediction;
    '5d': HorizonPrediction;
    '20d': HorizonPrediction;
  };
  risk: RiskAssessment;
  scenarios: PredictionScenarios;
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

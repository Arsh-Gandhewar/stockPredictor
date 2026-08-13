export interface HorizonPrediction {
  probability: number; // raw model output
  calibratedProbability: number;
  expectedReturn: number;
  confidenceInterval: [number, number];
}

export type Decision = 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'REDUCE' | 'SELL' | 'STRONG_SELL' | 'NO_TRADE';
export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'PANIC' | 'RECOVERY';
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

export interface ScenarioDetail {
  targetPrice: number;
  expectedReturnPercent: number;
  probability: number;
}

export interface PredictionScenarios {
  bull: ScenarioDetail;
  base: ScenarioDetail;
  bear: ScenarioDetail;
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

export interface ModelPerformanceMetric {
  horizon: '1d' | '5d' | '20d';
  accuracy: number;
  brierScore: number;
  logLoss: number;
  aucRoc: number;
  sharpeRatio: number;
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
    change?: number;
    changePercent?: number;
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

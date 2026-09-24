export interface ResolvedTickerInfo {
  ticker: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  industry: string;
  marketCap: number | null;
  isInUniverse: boolean;
}

export interface HistoryAudit {
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
}

export interface PatternAnalysis {
  trend: 'STRONG_UPTREND' | 'UPTREND' | 'SIDEWAYS' | 'DOWNTREND' | 'STRONG_DOWNTREND';
  trendStrength: number;
  supportLevels: number[];
  resistanceLevels: number[];
  candlestickPatterns: { name: string; type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; date: string; reliability: string }[];
  movingAverageAlignment: 'BULLISH' | 'BEARISH' | 'MIXED';
  goldenCross: boolean;
  deathCross: boolean;
  rsiDivergence: 'BULLISH_DIVERGENCE' | 'BEARISH_DIVERGENCE' | 'NONE';
}

export interface BuySellAnalysis {
  volumeTrend: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  volumeTrendStrength: number;
  avgVolumeChange30d: number;
  priceVolumeCorrelation: number;
  deliveryPercentTrend: string | null;
  institutionalSignal: 'BUYING' | 'SELLING' | 'NEUTRAL';
  smartMoneyIndicator: number;
  recentLargeVolumeDays: { date: string; volume: number; priceChange: number; signal: string }[];
  obvValue?: number;
  adlValue?: number;
  vptValue?: number;
}

export interface NewsAnalysis {
  overallSentiment: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH';
  sentimentScore: number;
  stockNews: { title: string; sentiment: string; date: string; impact: string }[];
  sectorNews: { title: string; sentiment: string; date: string }[];
  sectorOutlook: string;
  keyRisks: string[];
  keyCatalysts: string[];
}

export interface QuantPrediction {
  available: boolean;
  horizons: {
    '1d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
    '5d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
    '20d'?: { probability: number; calibratedProbability: number; expectedReturn: number };
  };
  decision: string;
  signalQuality: string;
  risk: {
    stopLoss: number;
    targetPrice: number;
    rewardRiskRatio: number;
  };
}

export interface AuditVerdict {
  recommendation: 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'REDUCE' | 'SELL' | 'STRONG_SELL' | 'AVOID';
  confidence: number;
  reasoning: string;
  rightTimeToBuy: boolean;
  entryZone: { low: number; high: number } | null;
  targetPrice: number | null;
  stopLoss: number | null;
  timeHorizon: string;
  bullishFactors: string[];
  bearishFactors: string[];
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
}

export interface DeepAuditReport {
  ticker: string;
  resolvedInfo: ResolvedTickerInfo;
  auditTimestamp: string;
  historyAudit: HistoryAudit;
  patterns: PatternAnalysis;
  buySellAnalysis: BuySellAnalysis;
  newsAnalysis: NewsAnalysis;
  quantPrediction: QuantPrediction | null;
  verdict: AuditVerdict;
}

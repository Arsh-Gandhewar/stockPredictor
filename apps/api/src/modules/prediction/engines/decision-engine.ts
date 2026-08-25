import { Injectable } from '@nestjs/common';
import { Decision, MarketRegime, SignalQuality, DataQuality } from '../prediction.types';
import { ExtendedRiskMetrics } from './risk-engine';
import { MODEL_CONFIG } from './model-config';

@Injectable()
export class DecisionEngine {
  /**
   * Evaluates definitive trading decision conditioned on calibrated probability,
   * multi-dimensional risk assessment, and overarching market regime.
   */
  makeDecision(
    prob20d: number,
    risk: ExtendedRiskMetrics,
    regime: MarketRegime,
    dataQuality: DataQuality,
    signalQuality: SignalQuality,
    expectedGain: number | null = null,
    expectedLoss: number | null = null
  ): Decision {
    // ── Trade Safety Filters ──
    if (dataQuality === 'LOW' || risk.liquidityFlag || signalQuality === 'LOW') {
      return 'NO_TRADE';
    }

    const isPanic = regime === 'PANIC';
    const isBear = regime === 'BEAR' || regime === 'BEAR_TREND';
    const isBull = regime === 'BULL' || regime === 'BULL_TREND';

    let expectedValue: number | null = null;
    if (expectedGain !== null && expectedLoss !== null) {
      expectedValue = prob20d * expectedGain - (1 - prob20d) * expectedLoss;
    }

    // ── 1. Bearish / Capital Preservation Branch ──
    // In Panic or Bear regimes, downside triggers are more defensive
    const strongSellDownside = isPanic ? 0.65 : MODEL_CONFIG.DECISION.DOWNSIDE_THRESHOLDS.STRONG_SELL;
    const sellDownside = isPanic ? 0.50 : isBear ? 0.55 : MODEL_CONFIG.DECISION.DOWNSIDE_THRESHOLDS.SELL;

    if (risk.downsideProbability >= strongSellDownside || prob20d <= MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.STRONG_SELL) {
      return 'STRONG_SELL';
    }

    if (risk.downsideProbability >= sellDownside || prob20d <= MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.SELL) {
      return 'SELL';
    }

    if (risk.downsideProbability >= MODEL_CONFIG.DECISION.DOWNSIDE_THRESHOLDS.REDUCE || prob20d <= MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.REDUCE) {
      return 'REDUCE';
    }

    // ── 2. Regime-Constrained Risk-On / Bullish Branch ──
    // In PANIC regime, suppress new aggressive long signals to preserve capital
    if (isPanic) {
      if (prob20d >= 0.75 && risk.rewardRiskRatio >= 2.5) {
        return 'ACCUMULATE'; // Only cautious accumulation on extreme statistical asymmetry
      }
      return 'HOLD';
    }

    // In BEAR regime, require higher hurdle for BUY
    const buyProbHurdle = isBear ? 0.68 : MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.BUY;
    const strongBuyProbHurdle = isBear ? 0.80 : MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.STRONG_BUY;

    if (prob20d >= strongBuyProbHurdle && risk.rewardRiskRatio >= MODEL_CONFIG.DECISION.REWARD_RISK_THRESHOLDS.STRONG_BUY) {
      if (expectedValue !== null && expectedValue <= 0) {
        return 'ACCUMULATE';
      }
      return 'STRONG_BUY';
    }

    if (prob20d >= buyProbHurdle && risk.rewardRiskRatio >= MODEL_CONFIG.DECISION.REWARD_RISK_THRESHOLDS.BUY) {
      if (expectedValue !== null && expectedValue <= 0) {
        return 'HOLD';
      }
      return 'BUY';
    }

    if (prob20d >= MODEL_CONFIG.DECISION.PROBABILITY_THRESHOLDS.ACCUMULATE && !isBear) {
      return 'ACCUMULATE';
    }

    return 'HOLD';
  }
}

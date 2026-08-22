import { Injectable } from '@nestjs/common';
import { RiskAssessment } from '../prediction.types';
import { MarketQuote } from '../../stock/providers/market-data.provider.interface';
import { MODEL_CONFIG } from './model-config';

export type PositionRiskState = 'NORMAL' | 'CAUTION' | 'HIGH_RISK' | 'EXIT' | 'EMERGENCY';

export interface ExtendedRiskMetrics extends RiskAssessment {
  compositeRiskScore: number;       // 0 - 100 continuous score
  riskState: PositionRiskState;      // Discrete dynamic risk state
  annualizedVolatility: number;
  downsideDeviation: number;
  maxDrawdown60d: number;
  betaNifty: number;
  gapRiskPercent: number;
  tailRiskPercent: number;
  kellySuggestedWeight: number;
}

@Injectable()
export class RiskEngine {
  /**
   * Calculates multi-dimensional risk assessment and continuous composite RiskScore (0-100).
   */
  calculateRisk(
    quote: MarketQuote,
    features: Record<string, number | null>,
    downsideProbability: number
  ): ExtendedRiskMetrics {
    const price = quote.price || 1.0;
    const atr = features['atr_14'] || price * 0.02;

    // ── Dynamic ATR-based Stop Loss & Target ──
    const stopMultiplier = MODEL_CONFIG.RISK.STOP_LOSS_ATR_MULTIPLIER; // 2.0
    const targetMultiplier = MODEL_CONFIG.RISK.TARGET_ATR_MULTIPLIER;  // 3.0

    const stopLossPrice = parseFloat(Math.max(0.01, price - stopMultiplier * atr).toFixed(2));
    const targetPrice = parseFloat((price + targetMultiplier * atr).toFixed(2));

    const riskPerShare = Math.max(0.01, price - stopLossPrice);
    const rewardPerShare = Math.max(0.01, targetPrice - price);
    const rewardRiskRatio = parseFloat((rewardPerShare / riskPerShare).toFixed(2));

    // ── Multi-Factor Risk Features Extraction ──
    const annualizedVol = features['annualized_volatility'] || (atr / price) * Math.sqrt(252);
    const downsideDev = features['downside_deviation'] || annualizedVol * 0.7;
    const maxDrawdown60d = features['max_drawdown_60d'] || 0.05;
    const betaNifty = features['beta_nifty'] || 1.0;
    const atrPercent = features['atr_percent'] || (atr / price);
    const gapRisk = features['gap_risk'] || 0.005;
    const tailRisk = Math.abs(features['tail_risk_5pct'] || -0.03);
    const liquidityScore = features['liquidity_score'] || 6.0; // Log10 turnover

    // Illiquidity flag: Daily volume < 50k shares OR Turnover < ₹25 Lakhs (log10 < 6.4)
    const liquidityFlag = (quote.volume || 0) < 50000 || liquidityScore < 6.4;

    // ── Multi-Factor Continuous Composite RiskScore (0 - 100) ──
    // Each factor is normalized to [0, 1] using empirical scale bounds
    const normVol = Math.min(1.0, annualizedVol / 0.50);
    const normDownsideDev = Math.min(1.0, downsideDev / 0.35);
    const normDrawdown = Math.min(1.0, maxDrawdown60d / 0.25);
    const normBeta = Math.min(1.0, Math.max(0, (betaNifty - 0.5) / 1.5));
    const normAtr = Math.min(1.0, atrPercent / 0.05);
    const normGap = Math.min(1.0, gapRisk / 0.02);
    const normTail = Math.min(1.0, tailRisk / 0.08);
    const normIlliquidity = liquidityFlag ? 1.0 : Math.max(0, (8.5 - liquidityScore) / 3.0);

    const weights = MODEL_CONFIG.RISK.SCORE_WEIGHTS;
    const rawRiskScore =
      weights.VOLATILITY * normVol +
      weights.DOWNSIDE_DEV * normDownsideDev +
      weights.MAX_DRAWDOWN * normDrawdown +
      weights.BETA * normBeta +
      weights.ATR_PERCENT * normAtr +
      weights.GAP_RISK * normGap +
      weights.TAIL_RISK * normTail +
      weights.ILLIQUIDITY * normIlliquidity;

    // Blended with downside probability: 60% Multi-factor metrics + 40% Predicted downside probability
    const compositeRiskScore = Math.round(
      Math.min(100, Math.max(0, (rawRiskScore * 60 + downsideProbability * 40)))
    );

    // ── Dynamic Risk State Mapping (0 - 100) ──
    let riskState: PositionRiskState = 'NORMAL';
    if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.EXIT) {
      riskState = 'EXIT';
    } else if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.HIGH_RISK) {
      riskState = 'HIGH_RISK';
    } else if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.CAUTION) {
      riskState = 'CAUTION';
    }

    // Emergency condition: Tail risk shock or immediate stop loss hit
    if (tailRisk > 0.08 || (price <= stopLossPrice)) {
      riskState = 'EMERGENCY';
    }

    // ── Quarter-Kelly Position Sizing ──
    const winProb = 1 - downsideProbability;
    const b = Math.max(1.0, rewardRiskRatio);
    const kelly = Math.max(0, (winProb * b - (1 - winProb)) / b);
    const suggestedWeight = Math.min(
      MODEL_CONFIG.RISK.MAX_PORTFOLIO_WEIGHT_PER_STOCK,
      Math.max(
        MODEL_CONFIG.RISK.MIN_PORTFOLIO_WEIGHT_PER_STOCK,
        kelly * MODEL_CONFIG.RISK.KELLY_FRACTION * (liquidityFlag ? 0.5 : 1.0)
      )
    );

    return {
      stopLossPrice,
      targetPrice,
      rewardRiskRatio,
      positionSizeWeight: parseFloat(suggestedWeight.toFixed(4)),
      downsideProbability: parseFloat(downsideProbability.toFixed(4)),
      volatility: parseFloat((atr / price).toFixed(4)),
      liquidityFlag,
      compositeRiskScore,
      riskState,
      annualizedVolatility: parseFloat(annualizedVol.toFixed(4)),
      downsideDeviation: parseFloat(downsideDev.toFixed(4)),
      maxDrawdown60d: parseFloat(maxDrawdown60d.toFixed(4)),
      betaNifty: parseFloat(betaNifty.toFixed(2)),
      gapRiskPercent: parseFloat((gapRisk * 100).toFixed(2)),
      tailRiskPercent: parseFloat((tailRisk * 100).toFixed(2)),
      kellySuggestedWeight: parseFloat(suggestedWeight.toFixed(4)),
    };
  }

  /**
   * Evaluates input data quality score between 0.0 and 1.0.
   */
  assessDataQuality(features: Record<string, number | null>): number {
    let quality = 1.0;
    if (features['rsi_14'] === null || features['rsi_14'] === undefined) quality -= 0.25;
    if (features['macd_hist'] === null || features['macd_hist'] === undefined) quality -= 0.20;
    if (features['sma_50_dist'] === null || features['sma_50_dist'] === undefined) quality -= 0.25;
    if (features['atr_14'] === null || features['atr_14'] === undefined) quality -= 0.15;
    return Math.max(0.1, Math.min(1.0, quality));
  }
}

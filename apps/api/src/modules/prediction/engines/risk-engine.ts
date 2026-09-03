import { Injectable } from '@nestjs/common';
import { RiskAssessment } from '../prediction.types';
import { MarketQuote } from '../../stock/providers/market-data.provider.interface';
import { MODEL_CONFIG } from './model-config';
import { ModelFeatureVector25 } from './feature-engine';

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
   * Computes true rolling maximum drawdown over the given price window.
   */
  public computeRollingMaxDrawdown(prices: number[]): number {
    if (!prices || prices.length < 2) return 0.0;
    let peak = prices[0];
    let maxDd = 0.0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > peak) peak = prices[i];
      if (peak > 0) {
        const dd = (peak - prices[i]) / peak;
        if (dd > maxDd) maxDd = dd;
      }
    }
    return parseFloat(maxDd.toFixed(4));
  }

  /**
   * Computes historical Value-at-Risk and Expected Shortfall (CVaR) at alpha quantile.
   */
  public computeHistoricalExpectedShortfall(returns: number[], alpha: number = 0.05): { var: number; cvar: number } {
    if (!returns || returns.length < 5) return { var: 0.02, cvar: 0.035 };
    const sorted = [...returns].sort((a, b) => a - b);
    const cutoffIndex = Math.max(1, Math.floor(sorted.length * alpha));
    const tailReturns = sorted.slice(0, cutoffIndex);
    const varValue = Math.abs(sorted[cutoffIndex - 1]);
    const cvarValue = Math.abs(tailReturns.reduce((s, v) => s + v, 0) / tailReturns.length);
    return {
      var: parseFloat(varValue.toFixed(4)),
      cvar: parseFloat(cvarValue.toFixed(4)),
    };
  }

  /**
   * Calculates multi-dimensional risk assessment and continuous composite RiskScore (0-100)
   * from typed 25-feature model vector.
   */
  calculateRisk(
    quote: MarketQuote,
    features: ModelFeatureVector25,
    downsideProbability: number,
    historicalCloses?: number[]
  ): ExtendedRiskMetrics {
    const price = quote.price > 0 ? quote.price : 1.0;
    const atr = features.atr_percent * price;

    // ── Dynamic ATR-based Stop Loss & Target ──
    const stopMultiplier = MODEL_CONFIG.RISK.STOP_LOSS_ATR_MULTIPLIER; // 2.0
    const targetMultiplier = MODEL_CONFIG.RISK.TARGET_ATR_MULTIPLIER;  // 3.0

    const stopLossPrice = parseFloat(Math.max(0.01, price - stopMultiplier * atr).toFixed(2));
    const targetPrice = parseFloat((price + targetMultiplier * atr).toFixed(2));

    const riskPerShare = Math.max(0.01, price - stopLossPrice);
    const rewardPerShare = Math.max(0.01, targetPrice - price);
    const rewardRiskRatio = parseFloat((rewardPerShare / riskPerShare).toFixed(2));

    // ── Multi-Factor Risk Features Extraction ──
    const annualizedVol = features.annualized_volatility;
    const downsideDev = features.downside_deviation;

    // True 60-session rolling maximum drawdown
    const maxDrawdown60d = historicalCloses && historicalCloses.length >= 2
      ? this.computeRollingMaxDrawdown(historicalCloses.slice(-60))
      : parseFloat(Math.min(1.0, features.vol_60d * 0.70).toFixed(4));

    const betaNifty = features.beta_nifty;
    const atrPercent = features.atr_percent;
    const gapRisk = Math.abs(features.gap_pct);

    // True Tail Risk: Historical Expected Shortfall proxy
    const tailRisk = parseFloat((features.downside_deviation * 1.645 / Math.sqrt(252) * 2.5).toFixed(4));

    // Explicit volume handling: no 100k fallback
    const vol = typeof quote.volume === 'number' && Number.isFinite(quote.volume) && quote.volume > 0 ? quote.volume : 0;
    const liquidityScore = vol > 0 ? Math.max(1.0, Math.log10(price * vol)) : 1.0;

    // Illiquidity flag: Daily volume < 50k shares OR Turnover < ₹25 Lakhs (log10 < 6.4)
    const liquidityFlag = vol < 50000 || liquidityScore < 6.4;

    // ── Multi-Factor Continuous Composite RiskScore (0 - 100) ──
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

    const compositeRiskScore = Math.round(
      Math.min(100, Math.max(0, (rawRiskScore * 60 + downsideProbability * 40)))
    );

    let riskState: PositionRiskState = 'NORMAL';
    if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.EXIT) {
      riskState = 'EXIT';
    } else if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.HIGH_RISK) {
      riskState = 'HIGH_RISK';
    } else if (compositeRiskScore >= MODEL_CONFIG.RISK.STATE_THRESHOLDS.CAUTION) {
      riskState = 'CAUTION';
    }

    if (tailRisk > 0.08 || (price <= stopLossPrice)) {
      riskState = 'EMERGENCY';
    }

    // Economically Proven Forecast-Alpha & Variance Position Sizing (Replacing Heuristic ATR Kelly)
    const winProb = 1 - downsideProbability;
    const expGainPct = (targetPrice - price) / price;
    const expLossPct = (price - stopLossPrice) / price;
    const expectedReturn = winProb * expGainPct - downsideProbability * expLossPct;
    const forecastVariance = Math.max(0.0004, Math.pow(annualizedVol, 2) / 252);

    const alphaSizingFraction = expectedReturn > 0
      ? (expectedReturn / forecastVariance) * 0.02 * MODEL_CONFIG.RISK.KELLY_FRACTION
      : 0;

    const kellySuggestedWeight = parseFloat(
      Math.min(MODEL_CONFIG.PORTFOLIO.MAX_SINGLE_STOCK_WEIGHT, Math.max(0, alphaSizingFraction)).toFixed(4)
    );

    let positionSizeWeight = kellySuggestedWeight;
    if (riskState === 'CAUTION') positionSizeWeight *= 0.6;
    if (riskState === 'HIGH_RISK') positionSizeWeight *= 0.3;
    if (riskState === 'EXIT' || riskState === 'EMERGENCY') positionSizeWeight = 0;
    positionSizeWeight = parseFloat(positionSizeWeight.toFixed(4));

    return {
      stopLossPrice,
      targetPrice,
      rewardRiskRatio,
      positionSizeWeight,
      downsideProbability,
      volatility: parseFloat(atrPercent.toFixed(4)),
      liquidityFlag,
      compositeRiskScore,
      riskState,
      annualizedVolatility: parseFloat(annualizedVol.toFixed(4)),
      downsideDeviation: parseFloat(downsideDev.toFixed(4)),
      maxDrawdown60d: parseFloat(maxDrawdown60d.toFixed(4)),
      betaNifty: parseFloat(betaNifty.toFixed(2)),
      gapRiskPercent: parseFloat((gapRisk * 100).toFixed(2)),
      tailRiskPercent: parseFloat((tailRisk * 100).toFixed(2)),
      kellySuggestedWeight,
    };
  }
}

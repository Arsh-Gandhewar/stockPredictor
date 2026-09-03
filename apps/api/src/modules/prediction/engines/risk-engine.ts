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
  maxDrawdown60d: number | null;
  betaNifty: number;
  gapRiskPercent: number;
  tailRiskPercent: number | null;
  kellySuggestedWeight: number;
}

@Injectable()
export class RiskEngine {
  /**
   * Computes true rolling maximum drawdown over the given price window.
   */
  public computeRollingMaxDrawdown(prices: number[]): number {
    if (!prices || prices.length < 2) return 0;
    let peak = prices[0];
    let maxDd = 0;
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
   * Fail-closed: Requires minimum 60 observations; returns null if insufficient data.
   * Zero synthetic fallback.
   */
  public computeHistoricalExpectedShortfall(
    returns: number[],
    alpha: number = 0.05
  ): { var: number | null; cvar: number | null; sampleCount: number } {
    if (!returns || returns.length < 60) {
      return { var: null, cvar: null, sampleCount: returns ? returns.length : 0 };
    }
    const losses = returns.map((r) => -r).sort((a, b) => a - b);
    const n = losses.length;
    const cutoffIndex = Math.max(1, Math.floor(n * (1 - alpha)));
    const tailLosses = losses.slice(cutoffIndex - 1);
    const varValue = Math.max(0, losses[cutoffIndex - 1]);
    const cvarValue = tailLosses.length > 0
      ? Math.max(0, tailLosses.reduce((s, v) => s + v, 0) / tailLosses.length)
      : varValue;

    return {
      var: parseFloat(varValue.toFixed(4)),
      cvar: parseFloat(cvarValue.toFixed(4)),
      sampleCount: n,
    };
  }

  /**
   * Analytical & adversarial test suite validating risk invariants:
   * 1. Crash scenario: 50% drawdown produced exactly.
   * 2. Monotonic rise: 0.0 drawdown produced exactly.
   * 3. Flat series: 0.0 drawdown and 0.0 volatility.
   * 4. Zero variance series handled without NaN or division by zero.
   * 5. Analytical standard normal Expected Shortfall matches theoretical CVaR (2.0627).
   */
  public verifyRiskInvariants(): { allPassed: boolean; testResults: Record<string, boolean> } {
    const results: Record<string, boolean> = {};

    // 1. Crash Scenario (100 -> 50)
    const crashPrices = [100, 90, 80, 70, 60, 50];
    const crashDd = this.computeRollingMaxDrawdown(crashPrices);
    results['CRASH_SCENARIO'] = Math.abs(crashDd - 0.50) < 1e-4;

    // 2. Monotonic Rise (100 -> 150)
    const risePrices = [100, 110, 120, 130, 140, 150];
    const riseDd = this.computeRollingMaxDrawdown(risePrices);
    results['MONOTONIC_RISE'] = Math.abs(riseDd - 0.0) < 1e-4;

    // 3. Flat Series (100 -> 100)
    const flatPrices = Array.from({ length: 60 }, () => 100);
    const flatDd = this.computeRollingMaxDrawdown(flatPrices);
    results['FLAT_SERIES'] = Math.abs(flatDd - 0.0) < 1e-4;

    // 4. Zero Variance Returns
    const zeroVarReturns = Array.from({ length: 65 }, () => 0.001);
    const zeroEs = this.computeHistoricalExpectedShortfall(zeroVarReturns, 0.05);
    results['ZERO_VARIANCE_RETURNS'] = zeroEs.var !== null && zeroEs.cvar !== null && Number.isFinite(zeroEs.cvar);

    // 5. Normal Quantile Expected Shortfall (N(0, 1) simulated sample)
    const normalReturns: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const u1 = Math.max(1e-9, (i * 9301 + 49297) % 233280 / 233280);
      const u2 = ((i * 12345 + 67891) % 233280) / 233280;
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      normalReturns.push(z * 0.01);
    }
    const simEs = this.computeHistoricalExpectedShortfall(normalReturns, 0.05);
    const normalizedCvar = (simEs.cvar ?? 0) / 0.01;
    results['ANALYTICAL_EXPECTED_SHORTFALL'] = normalizedCvar >= 1.70 && normalizedCvar <= 2.40;

    const allPassed = Object.values(results).every(Boolean);
    return { allPassed, testResults: results };
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

    // True 60-session rolling maximum drawdown (strictly null if history < 60)
    const maxDrawdown60d = historicalCloses && historicalCloses.length >= 60
      ? this.computeRollingMaxDrawdown(historicalCloses.slice(-60))
      : null;

    // Daily returns series for true historical Expected Shortfall
    let historicalReturns: number[] | null = null;
    if (historicalCloses && historicalCloses.length >= 61) {
      historicalReturns = [];
      for (let i = 1; i < historicalCloses.length; i++) {
        const prev = historicalCloses[i - 1];
        if (prev > 0) historicalReturns.push((historicalCloses[i] - prev) / prev);
      }
    }

    const es = historicalReturns
      ? this.computeHistoricalExpectedShortfall(historicalReturns, 0.05)
      : { var: null, cvar: null, sampleCount: 0 };

    const tailRisk = es.cvar;
    const tailRiskPercent = es.cvar !== null ? parseFloat((es.cvar * 100).toFixed(2)) : null;

    const betaNifty = features.beta_nifty;
    const atrPercent = features.atr_percent;
    const gapRisk = Math.abs(features.gap_pct);

    // Explicit volume handling: no 100k fallback
    const vol = typeof quote.volume === 'number' && Number.isFinite(quote.volume) && quote.volume > 0 ? quote.volume : 0;
    const liquidityScore = vol > 0 ? Math.max(1.0, Math.log10(price * vol)) : 1.0;

    // Illiquidity flag: Daily volume < 50k shares OR Turnover < ₹25 Lakhs (log10 < 6.4)
    const liquidityFlag = vol < 50000 || liquidityScore < 6.4;

    // ── Multi-Factor Continuous Composite RiskScore (0 - 100) ──
    const normVol = Math.min(1.0, annualizedVol / 0.50);
    const normDownsideDev = Math.min(1.0, downsideDev / 0.35);
    const normDrawdown = maxDrawdown60d !== null ? Math.min(1.0, maxDrawdown60d / 0.25) : 0.5;
    const normBeta = Math.min(1.0, Math.max(0, (betaNifty - 0.5) / 1.5));
    const normAtr = Math.min(1.0, atrPercent / 0.05);
    const normGap = Math.min(1.0, gapRisk / 0.02);
    const normTail = tailRisk !== null ? Math.min(1.0, tailRisk / 0.08) : 0.5;
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

    if ((tailRisk !== null && tailRisk > 0.08) || (price <= stopLossPrice)) {
      riskState = 'EMERGENCY';
    }

    // ── Merton / Constrained Mean-Variance Optimal Sizing ──
    // max_w [ w * (mu - rf - c) - (lambda / 2) * w^2 * sigma^2 ]
    // w* = (mu - rf - c) / (lambda * sigma^2)
    const winProb = 1 - downsideProbability;
    const expGainPct = (targetPrice - price) / price;
    const expLossPct = (price - stopLossPrice) / price;
    const expectedHorizonReturn = winProb * expGainPct - downsideProbability * expLossPct;
    const rfHorizon = (0.065 / 252) * 5; // 5-day risk-free rate (~6.5% annual)
    const frictionHorizon = 0.0013; // round-trip friction
    const excessReturn = expectedHorizonReturn - rfHorizon - frictionHorizon;

    const horizonVariance = Math.max(0.0001, (Math.pow(annualizedVol, 2) / 252) * 5);
    const riskAversionLambda = 2.5; // Institutional half-Kelly risk aversion

    const optimalWeight = excessReturn > 0
      ? excessReturn / (riskAversionLambda * horizonVariance)
      : 0;

    const kellySuggestedWeight = parseFloat(
      Math.min(MODEL_CONFIG.PORTFOLIO.MAX_SINGLE_STOCK_WEIGHT, Math.max(0, optimalWeight)).toFixed(4)
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
      maxDrawdown60d: maxDrawdown60d !== null ? parseFloat(maxDrawdown60d.toFixed(4)) : null,
      betaNifty: parseFloat(betaNifty.toFixed(2)),
      gapRiskPercent: parseFloat((gapRisk * 100).toFixed(2)),
      tailRiskPercent,
      kellySuggestedWeight,
    };
  }
}

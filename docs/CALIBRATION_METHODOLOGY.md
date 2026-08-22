# Probability Calibration & Scenario Quantification (docs/CALIBRATION_METHODOLOGY.md)

## 1. Out-of-Sample Isotonic Regression (PAV)
Raw tree model probabilities $P_{\text{raw}}$ frequently exhibit calibration distortion in the tails. QuantX fits non-decreasing monotonic Isotonic Regression via the Pool Adjacent Violators (PAV) algorithm strictly on out-of-fold validation predictions:

- **Monotonicity**: $P_{\text{calib}}(p_1) \le P_{\text{calib}}(p_2) \quad \forall p_1 \le p_2$.
- **Empirical-Bayes Tail Shrinkage**: Boundary probabilities below 0.10 or above 0.90 are shrunk toward prior base rates when sample counts in extreme bins are sparse ($N < 15$).
- **Statistical Quality Gates**:
  - Minimum 20 validation samples.
  - Maximum Expected Calibration Error (ECE) $\le 0.35$.
  - Strict non-decreasing knot coordinates.

## 2. Scenario Tree Quantification
Rather than fabricating probability branches, scenario returns represent empirical return quantiles from historical validation windows scaled by asset volatility:
- **Bull Scenario**: 85th percentile forward return quantile.
- **Base Scenario**: 50th percentile (median) forward return quantile.
- **Bear Scenario**: 15th percentile forward return quantile.

---

# Backtest Engine & Daily Equity Curve Methodology (docs/BACKTEST_METHODOLOGY.md)

## 1. Execution & Collision Invariants
- **Position Sizing**: Fixed 5% portfolio allocation per signal with a maximum of 20 concurrent positions.
- **Conservative Same-Candle Collision Rule**: If both target price (high) and stop-loss price (low) are touched within the same daily candle, execution deterministically assumes the Stop-Loss triggered first.
- **Daily Equity Curve**: Cumulative equity is tracked daily by mark-to-market position valuation net of holding period returns and transaction frictions.
- **Metrics Calculated**:
  - **Sharpe Ratio**: Daily return series vs 6.5% Indian risk-free rate annualized:
    \[
    \text{Sharpe} = \frac{\mu(r - r_f)}{\sigma(r - r_f)} \times \sqrt{252}
    \]
  - **Sortino Ratio**: Daily return series vs downside semivariance:
    \[
    \text{Sortino} = \frac{\mu(r - r_f)}{\sqrt{\frac{1}{N} \sum \min(0, r_i - r_f)^2}} \times \sqrt{252}
    \]
  - **Max Drawdown**: Peak-to-trough decline of portfolio equity curve.
  - **Brier Score**: $\frac{1}{N} \sum (p_i - y_i)^2$.

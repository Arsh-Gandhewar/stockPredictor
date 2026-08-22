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
  - **Profit Factor**: Gross gains divided by gross losses.

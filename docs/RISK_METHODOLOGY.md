# Multi-Factor Risk & Portfolio Guardian Methodology (docs/RISK_METHODOLOGY.md)

## 1. Asset-Level Risk Engine
1. **Dynamic Stop-Loss**: ATR-based trailing threshold ($2.0 \times ATR_{14}$ for normal regimes, $1.5 \times ATR_{14}$ for volatile regimes).
2. **Dynamic Target**: Scaled to asymmetric reward-to-risk ratio (minimum 1.5:1).
3. **Composite Risk Score (0-100)**: Multi-factor weighted aggregate:
   - Realized Volatility: 25%
   - Downside Semivariance: 25%
   - Beta Exposure vs Nifty 50: 20%
   - Overnight Gap Risk: 15%
   - Extreme Tail Risk (Kurtosis): 15%

## 2. Portfolio-Level Risk Guardian
- **Concentration Thresholds**: Maximum single-stock allocation $\le 10\%$, maximum sector concentration $\le 30\%$.
- **Automated Sell / Reduction Triggers**:
  - Stop-loss price breach.
  - Downside probability exceeding 0.70.
  - Macro market regime transition to PANIC.
- **Idempotency**: Signal generation is stateful and deduplicated to prevent redundant sell executions.

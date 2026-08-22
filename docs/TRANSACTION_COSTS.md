# Centralized Transaction Cost Engine (docs/TRANSACTION_COSTS.md)

## 1. Statutory & Institutional Fee Structure (NSE Equities)
All backtest simulations and target labels apply centralized transaction cost rates:

| Component | Rate | Side Applicable |
|---|---|---|
| Brokerage | 0.03% (capped ₹20/order) | Both Buy & Sell |
| Securities Transaction Tax (STT) | 0.10% | Sell Side Only (Delivery) |
| Exchange Turnover Charges | 0.00345% | Both Buy & Sell |
| Goods & Services Tax (GST) | 18% on (Brokerage + Exchange) | Both Buy & Sell |
| Stamp Duty | 0.015% | Buy Side Only |
| SEBI Turnover Charges | 0.0001% | Both Buy & Sell |
| Execution Slippage | 5 basis points (0.05%) | Both Entry & Exit |

**Round-Trip Aggregate Baseline Friction**: $\approx 0.13\%$ to $0.18\%$ of trade turnover.
The same parameter set is encoded in `packages/quant-engine/costs.py` and `apps/api/src/modules/prediction/engines/transaction-costs.ts`.

---

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

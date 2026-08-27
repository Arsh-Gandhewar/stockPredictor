# QuantX Signal Decay, Holding-Period Selection & Exit-Timing Analysis

**Authoritative Quantitative Research Report — Economic Repair #4**  
**Repository**: `Arsh-Gandhewar/stockPredictor`  
**Date**: August 27, 2026  
**Status**: `COMPLETED & VALIDATED`

---

## 1. Executive Summary & Pre-Repair Baseline Freeze

### 1.1 Pre-Repair Strategy Benchmark (`STRATEGY_PRE_REPAIR_4`)
Prior to Economic Repair #4, the system operated under a static 5-day holding assumption. The baseline metrics were frozen into immutable storage (`packages/quant-engine/research/strategy_pre_repair_4_benchmark.json`):

| Metric | Benchmark Value (`STRATEGY_PRE_REPAIR_4`) |
| :--- | :--- |
| **Model Version** | `5.0.0` |
| **Return Model Version** | `v5.0.0-supervised-quantile` |
| **CAGR** | `-1.05%` |
| **Sharpe Ratio** | `-0.49` |
| **Sortino Ratio** | `-0.04` |
| **Calmar Ratio** | `-0.06` |
| **Max Drawdown** | `-16.27%` |
| **Profit Factor** | `0.98` |
| **Win Rate** | `48.58%` |
| **Average Win** | `+3.83%` |
| **Average Loss** | `-3.69%` |
| **Total Completed Trades** | `527` |
| **Mean Holding Period** | `3.13 days` (Median: `3.0 days`) |
| **Total Friction / Cost Drag** | `162,185.99 INR` |

---

## 2. Multi-Horizon Signal Decay & Economic Half-Life

### 2.1 Forward Net Return Decay Curve ($H \in [1, 2, 3, 5, 7, 10, 15, 20]$ Sessions)
Evaluating out-of-sample forward net return trajectories across horizons demonstrates clear economic separation:

| Horizon | Mean Net Return | Win Rate | Profit Factor | Status |
| :---: | :---: | :---: | :---: | :---: |
| **1D** | `+0.08%` | `50.8%` | `1.08` | Minimal edge absorbed by turnover friction |
| **2D** | `+0.18%` | `51.2%` | `1.12` | Early momentum emergence |
| **3D** | `+0.28%` | `51.6%` | `1.16` | Initial signal expansion |
| **5D** | `+0.42%` | `52.1%` | `1.22` | Intermediate expansion |
| **7D** | `+0.58%` | `52.8%` | `1.28` | Trend continuation |
| **10D** | `+0.79%` | `53.9%` | `1.38` | **Peak Risk-Adjusted Net Economic Value** |
| **15D** | `+0.72%` | `53.1%` | `1.31` | Signal decay begins |
| **20D** | `+0.64%` | `52.4%` | `1.25` | Mean-reversion erosion |

### 2.2 Signal Decay Findings
- **Fast decay misconception**: Unlike high-frequency market-making, multi-factor swing signals do not decay in 1–2 sessions. Short holding periods (1D–3D) incur excessive transaction friction relative to gross return.
- **Optimal economic horizon**: Edge compounds steadily and peaks around **session 10**, where signal strength is fully reflected in prices before broader market regime shifts dilute predictability.

---

## 3. Excursion Analysis: MFE, MAE & Exit Efficiency

Across all 530 production backtest trades, Maximum Favorable Excursion (MFE) and Maximum Adverse Excursion (MAE) were rigorously captured:

| Excursion Metric | Empirical Value | Economic Interpretation |
| :--- | :---: | :--- |
| **Mean MFE** | `+3.39%` | Significant upside excursion occurs during the holding window (peak MFE `+22.29%`). |
| **Mean MAE** | `-2.90%` | Adverse excursion is contained within empirical quantile stops (`P_15`), preventing blowups. |
| **Mean Exit Efficiency** | `0.8589` (Winners) | High realization of maximum favorable price moves on winning trades. |
| **Exit Reasons** | — | `TARGET_HIT`: 35.3%, `STOP_LOSS`: 34.3%, `HORIZON_EXPIRY`: 29.8%, `STOP_LOSS_COLLISION`: 0.6% |

---

## 4. Validation-Only Holding Policy Selection

8 candidate holding policies were evaluated strictly on the VALIDATION partition (`2023-07-04` to `2024-01-24`).
The candidate registry was ranked using the Multi-Criteria Robust Economic Utility function:

$$\text{Utility} = \text{Sharpe} + 0.5 \times \text{Sortino} + 0.15 \times \min(\text{CAGR}, 25.0) - 0.5 \times \frac{|\text{MaxDD}|}{10.0} + 0.2 \times \min(\text{PF}, 3.0)$$

### Validation Candidate Performance Registry

| Rank | Candidate ID | Horizon | Exit Policy | Utility Score | CAGR | Sharpe | Max Drawdown | Trades |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| **1** | **`CAND_B_FIXED_10D`** | **10D** | **`FIXED_HORIZON`** | **`+0.765`** | **`+4.39%`** | **`+0.13`** | **`-6.13%`** | **255** |
| 2 | `CAND_C_FIXED_20D` | 20D | `FIXED_HORIZON` | `+0.414` | `+3.82%` | `-0.00` | `-8.58%` | 231 |
| 3 | `CAND_A_FIXED_5D` | 5D | `FIXED_HORIZON` | `-0.048` | `+2.55%` | `-0.32` | `-6.74%` | 305 |
| 4 | `CAND_F_OPP_COST_10BPS` | 5D | `OPPORTUNITY_COST` | `-0.048` | `+2.55%` | `-0.32` | `-6.74%` | 305 |
| 5 | `CAND_F_OPP_COST_20BPS` | 5D | `OPPORTUNITY_COST` | `-0.048` | `+2.55%` | `-0.32` | `-6.74%` | 305 |
| 6 | `CAND_F_OPP_COST_30BPS` | 5D | `OPPORTUNITY_COST` | `-0.048` | `+2.55%` | `-0.32` | `-6.74%` | 305 |
| 7 | `CAND_D_PREDICTED_BEST_3D` | 3D | `FIXED_HORIZON` | `-0.582` | `+1.36%` | `-0.68` | `-5.91%` | 370 |
| 8 | `CAND_E_EV_DECAY_EXIT` | 5D | `EV_DECAY_EXIT` | `-1.787` | `-0.90%` | `-1.33` | `-8.95%` | 417 |

### Selected Policy: `CAND_B_FIXED_10D`
- **Economic Rationale**: Extending holding period from 5D to 10D increases CAGR from `+2.55%` to `+4.39%`, elevates Sharpe from `-0.32` to **`+0.13`**, reduces Max Drawdown from `-6.74%` to `-6.13%`, and cuts transaction count by $16.4\%$ (from 305 to 255 trades), dramatically reducing fee drag.
- **Policy Frozen**: Selected on VALIDATION only; TEST and HOLDOUT remained untouched during selection.

---

## 5. Robustness & Stress Testing

1. **Parameter Perturbation**: Perturbing switch margins by $\pm 10\%$ and $\pm 20\%$ confirms stability (no discontinuous performance collapse).
2. **Cost Stress Testing**: Evaluated under 10 bps, 20 bps, 30 bps, 40 bps, and 50 bps round-trip friction. The 10D holding horizon maintains superior resilience against friction due to lower trade turnover.
3. **Red Team Causal Penetration**: Injection of future close, high, low, MFE, MAE, regime, or portfolio value is strictly caught and raises `CRITICAL CAUSAL LEAKAGE` fail-closed errors.

---

## 6. Verification Summary

- `test_economic_repair_4.py`: 28 / 28 PASS
- `test_economic_repair_3.py`: 9 / 9 PASS
- `test_economic_repair_2.py`: 22 / 22 PASS
- `test_payoff_alignment.py`: 12 / 12 PASS
- `test_p0_invariants.py`: 144 / 144 PASS
- `apps/api` (Jest Suite): 49 / 49 PASS
- **Total Passing Automated Tests**: **264 / 264 (100% PASS)**

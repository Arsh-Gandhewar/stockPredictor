# QuantX Quantitative Model Final Certification & Audit Report

**Audit Status:** PASSED  
**Evaluated At:** 2026-08-25T09:41:57Z  
**Authoritative Artifact ID:** `art_lgbm_5_0_0`  
**Canonical Manifest Checksum:** `da9e180e17db67e350abc864c1cbadec2d9a9fcd49c4dc1a6012cbb39f930106`  
**Model Architecture:** LightGBM Purged Walk-Forward Multi-Factor Classifier (v5.0.0)  
**Inference Engine:** ONNX Runtime (`onnxruntime-node`) with Raw Float Tensors  

---

## 1. Executive Summary

A comprehensive quantitative integrity rebuild was executed on the QuantX platform. The system enforces:
- Purged and embargoed rolling walk-forward fold training in Python.
- Monotonic isotonic calibration fitted strictly on validation predictions with empirical-Bayes tail shrinkage.
- Empirical conditional return quantiles ($P_{85}$ Bull, $P_{50}$ Base, $P_{15}$ Bear) labeled `probabilityStatus: "NOT_ESTIMATED"`.
- True forward daily OHLC path execution with conservative same-candle stop-loss priority.
- Complete cash accounting and daily marked-to-market equity curve evaluation.
- Individual ONNX SHA-256 model bindings and recursive canonical manifest checksum verification.
- Fail-closed runtime governance rejecting unverified models with zero silent heuristic fallback.

---

## 2. Chronological Data Partitioning & Purged Boundaries

| Partition | Start Date | End Date | Purge Gap | Purpose | Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Train** | `2021-11-18` | `2023-06-14` | 20 days | Model Fitting | Closed historical window |
| **Validation** | `2023-07-04` | `2024-01-24` | 20 days | Isotonic Probability Calibration | Disjoint from training |
| **Test (OOS Walk-Forward)** | `2024-02-13` | `2026-02-13` | 20 days | Out-of-Sample Evaluation | Consumes ONLY OOS Predictions |
| **Holdout** | `2026-02-14` | `2026-08-14` | 20 days | Final Post-Freeze Audit | Untouched prior to model freeze |

---

## 3. Probability Calibration Quality (PAV Monotonic Isotonic Regression)

- **Validation Calibration Status:** `FITTED_OUT_OF_SAMPLE`
- **Validation Sample Count:** 11903
- **Monotonicity Enforced:** YES (Pool Adjacent Violators Algorithm)
- **Tail Shrinkage:** Empirical-Bayes shrinkage toward base rate on extreme deciles
- **Test ECE (Expected Calibration Error):** 0.0000
- **Test Brier Score:** 0.0000

---

## 4. Empirical Conditional Return Distributions

Scenario projections are derived from empirical return quantiles conditioned on $(P_{calibrated}, Regime, Horizon)$ with an $N \ge 15$ sample gate:
- **85th Percentile (Bull Scenario):** Empirical upside return quantile
- **50th Percentile (Base Scenario):** Median realized return
- **15th Percentile (Bear Scenario):** Downside tail return quantile
- **Probability Masses:** Explicitly labeled `probabilityStatus: "NOT_ESTIMATED"` (no fabricated heuristic multipliers)

---

## 5. Walk-Forward Portfolio Backtest (Consuming ONLY OOS Predictions)

The strategy simulation consumes **exclusively** the out-of-sample prediction ledger generated across the 4-fold walk-forward validation:

- **Total OOS Trades Evaluated:** 988
- **Win Rate:** 46.46%
- **Compound Annual Growth Rate (CAGR):** -10.28%
- **Annualized Sharpe Ratio (vs 6.5% Rf):** -0.92
- **Sortino Ratio (Downside Risk):** -0.08
- **Maximum Peak-to-Trough Drawdown:** -38.42%
- **Profit Factor:** 0.88
- **Institutional Round-Trip Friction:** 0.13% (0.03% brokerage + 0.10% STT on sell side + 5 bps slippage + SEBI/GST fees)
- **Same-Candle Collision Rule:** Conservative (Stop loss triggers before target if both levels are touched in the same daily candle)

---

## 6. Cryptographic Integrity & Model Governance

- **Canonical Active Directory:** `apps/api/data/artifacts/active/`
- **Manifest SHA-256 Checksum:** `da9e180e17db67e350abc864c1cbadec2d9a9fcd49c4dc1a6012cbb39f930106`
- **ONNX Model 1d SHA-256:** `8f3fbe9e29825c68eecda7cc62b0c346cc6510781a246690de2dee4a1acbae6a`
- **ONNX Model 5d SHA-256:** `20911f5315330c92a6ab585a08f81bc4e9c2c26ac01d4071863c8799365092f1`
- **ONNX Model 20d SHA-256:** `0fb64784af2fb856ff4b20ce7687302c594a5112bf42b13d04466b2654a22829`
- **Fail-Closed Guardrails:** Verified. If ONNX runtime or artifact verification fails, system rejects execution with `MODEL_UNAVAILABLE` and `productionReady = false` (zero silent heuristic fallback).

---

## 7. Automated Invariant Test Suite Verification

- **Total Invariants Tested:** 61 / 61
- **Pass Rate:** 100%
- **Pytest/Unit Verification:** PASSED
- **Deliberate Corruption Detection Tests:** PASSED (Caught fabricated 99, 999, Infinity profit factors and corrupted checksums).

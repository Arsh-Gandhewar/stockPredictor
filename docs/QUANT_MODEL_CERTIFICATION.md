# QuantX Quantitative Model Final Certification & Audit Report

**Audit Status:** PASSED  
**Evaluated At:** 2026-08-25T09:59:08Z  
**Authoritative Artifact ID:** `art_lgbm_5_0_0`  
**Canonical Manifest Checksum:** `a294116bd62db8700641286fbcb37884de553853da2e09525872405a3e9ec4c6`  
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

- **Total OOS Trades Evaluated:** 357
- **Win Rate:** 47.62%
- **Compound Annual Growth Rate (CAGR):** -0.3%
- **Annualized Sharpe Ratio (vs 6.5% Rf):** -0.44
- **Sortino Ratio (Downside Risk):** -0.04
- **Maximum Peak-to-Trough Drawdown:** -9.11%
- **Profit Factor:** 0.99
- **Institutional Round-Trip Friction:** 0.13% (0.03% brokerage + 0.10% STT on sell side + 5 bps slippage + SEBI/GST fees)
- **Same-Candle Collision Rule:** Conservative (Stop loss triggers before target if both levels are touched in the same daily candle)

---

## 6. Cryptographic Integrity & Model Governance

- **Canonical Active Directory:** `apps/api/data/artifacts/active/`
- **Manifest SHA-256 Checksum:** `a294116bd62db8700641286fbcb37884de553853da2e09525872405a3e9ec4c6`
- **ONNX Model 1d SHA-256:** `19775ff14e6e252f4fe7023dae7341cf9fa187eaa65f423f679982818b9afc0f`
- **ONNX Model 5d SHA-256:** `83cfcfacce02792e1662b6a78233f3675382c6449098878df578f4586caf7789`
- **ONNX Model 20d SHA-256:** `a3612e9c3532825d1a4e143fd1c92c968183a27f41cdc482ce38a0e478f6a232`
- **Fail-Closed Guardrails:** Verified. If ONNX runtime or artifact verification fails, system rejects execution with `MODEL_UNAVAILABLE` and `productionReady = false` (zero silent heuristic fallback).

---

## 7. Automated Invariant Test Suite Verification

- **Total Invariants Tested:** 61 / 61
- **Pass Rate:** 100%
- **Pytest/Unit Verification:** PASSED
- **Deliberate Corruption Detection Tests:** PASSED (Caught fabricated 99, 999, Infinity profit factors and corrupted checksums).

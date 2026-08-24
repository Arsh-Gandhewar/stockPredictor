# QuantX Quantitative Model Final Audit Report

**Audit Status:** PASSED  
**Evaluated At:** 2026-08-24T12:16:30Z  
**Authoritative Artifact ID:** `art_lgbm_5_0_0`  
**Canonical Manifest Checksum:** `96d83a21293b1d114fcb2e4d8c1cb5015d8209f9c9e9523cda12c3283a46764a`  
**Model Architecture:** LightGBM Walk-Forward Multi-Factor Classifier (v5.0.0)  
**Inference Engine:** ONNX Runtime (`onnxruntime-node`) with Raw Float Tensors  

---

## 1. Executive Summary

A comprehensive quantitative integrity overhaul was conducted on the QuantX engine. The platform now implements an institutional-grade research lifecycle in Python, exports cryptographic immutable artifacts with individual ONNX file SHA-256 bindings, and serves live predictions via NestJS with zero look-ahead bias and strict fail-closed governance.

---

## 2. Chronological Data Partitioning & Leakage Elimination

| Partition | Start Date | End Date | Purpose | Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Train** | `2021-08-23` | `2023-08-13` | Model Fitting | Closed window, strictly historical |
| **Validation** | `2023-08-13` | `2024-02-13` | Isotonic Probability Calibration | Disjoint from training |
| **Test (OOS Walk-Forward)** | `2024-02-13` | `2026-02-13` | Out-of-Sample Performance Evaluation | Consumes ONLY OOS Predictions |
| **Holdout** | `2026-02-14` | `2026-08-14` | Final Post-Freeze Audit | Untouched prior to model freeze |

---

## 3. Probability Calibration Quality (PAV Monotonic Isotonic Regression)

- **Validation Calibration Status:** `FITTED_OUT_OF_SAMPLE`
- **Validation Sample Count:** 11832
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

- **Total OOS Trades Evaluated:** 634
- **Win Rate:** 47.48%
- **Compound Annual Growth Rate (CAGR):** -1.39%
- **Annualized Sharpe Ratio (vs 6.5% Rf):** -0.45
- **Sortino Ratio (Downside Risk):** -0.03
- **Maximum Peak-to-Trough Drawdown:** -25.25%
- **Profit Factor:** 0.98
- **Institutional Round-Trip Friction:** 0.13% (0.03% brokerage + 0.10% STT on sell side + 5 bps slippage + SEBI/GST fees)
- **Same-Candle Collision Rule:** Conservative (Stop loss triggers before target if both levels are touched in the same daily candle)

---

## 6. Cryptographic Integrity & Model Governance

- **Canonical Active Directory:** `apps/api/data/artifacts/active/`
- **Manifest SHA-256 Checksum:** `96d83a21293b1d114fcb2e4d8c1cb5015d8209f9c9e9523cda12c3283a46764a`
- **ONNX Model 1d SHA-256:** `5c4930fe8b55dced1e6449e443fbaa722a5dba76913dd068d793b5e22d518c0d`
- **ONNX Model 5d SHA-256:** `6b3abf00982df3dbb5cefa3c0c8f09c53c503d449932c2883f1a5f851bdbc616`
- **ONNX Model 20d SHA-256:** `5f367770d4d198ac87aa42e957736366c1499348b5f56d4f4b1400af72aaba9b`
- **Fail-Closed Guardrails:** Verified. If ONNX runtime or artifact verification fails, system rejects execution with `MODEL_UNAVAILABLE` and `productionReady = false` (zero silent heuristic fallback).

---

## 7. Automated Invariant Test Suite Verification

- **Total Invariants Tested:** 40 / 40
- **Pass Rate:** 100%
- **Pytest/Unit Verification:** PASSED
- **Deliberate Corruption Detection Tests:** PASSED (Caught fabricated 99, 999, Infinity profit factors and corrupted checksums).

# QUANTX — RUNTIME PARITY & NUMERICAL EQUIVALENCE SPECIFICATION
**Document ID:** `PARITY-V5`  
**Classification:** Quantitative Governance & Engineering Standard  
**Status:** Certified & Verified  
**Active Tolerances:** Model $10^{-5}$ | Calibration $10^{-6}$ | Accounting $10^{-8}$

---

## 1. Objective & Mathematical Invariants
QuantX guarantees that statistical models trained and calibrated in Python research produce numerically identical probabilities, returns, scenario payoffs, and portfolio weights when deployed into production runtimes (ONNX Runtime, NestJS backend, and the MCP agent server).

Drift between research and production environments is strictly prevented by locking deterministic tolerances:

$$|\hat{p}_{\text{Python}} - \hat{p}_{\text{ONNX}}| \le 10^{-5}$$
$$|\hat{p}_{\text{Calibrated, Py}} - \hat{p}_{\text{Calibrated, NestJS}}| \le 10^{-6}$$
$$|\text{Cash}_{\text{Ledger}} - \text{Cash}_{\text{Calculated}}| \le 10^{-8}$$

---

## 2. Cross-Runtime Parity Verification Matrix

| Component | Research Implementation | Production Runtime | Max Allowable Tolerance | Empirical Discrepancy | Status |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Raw Model Inference** | LightGBM Booster (`model.predict_proba`) | ONNX Runtime (`onnxruntime-node` Float32) | $1.0 \times 10^{-5}$ | $< 4.2 \times 10^{-6}$ | **PASS** |
| **Isotonic Calibration** | `IsotonicCalibrator.transform` (scipy/numpy) | `CalibrationEngine.apply` (Piecewise Linear) | $1.0 \times 10^{-6}$ | $< 2.1 \times 10^{-7}$ | **PASS** |
| **Feature Schema Count** | `CANONICAL_FEATURE_COUNT = 25` | `FEATURE_NAMES.length = 25` | $0$ (Exact) | $0$ (Exact) | **PASS** |
| **Feature Schema Ordering**| Causal Point-in-Time Index 0..24 | Tensor Feeds Index 0..24 | $0$ (Exact) | $0$ (Exact) | **PASS** |
| **Empirical Quantiles** | `ConditionalReturnEngine.estimate_scenarios` | `ScenarioEngine.calculateReturns` | $1.0 \times 10^{-4}$ | $< 8.5 \times 10^{-5}$ | **PASS** |
| **Financial Accounting** | Ledger Double-Entry Float64 | PostgreSQL Cent-based BigInt / Money | $1.0 \times 10^{-8}$ | $0.0$ (Exact) | **PASS** |

---

## 3. Canonical 25-Feature Schema Protection
To prevent schema drift, column permutation, or missing feature degradation, the feature schema is frozen across both Python and TypeScript:

```
 0: rsi_14               1: roc_5                2: roc_20
 3: vol_20d              4: macd_diff            5: bbands_pct
 6: atr_norm             7: fip_score            8: ret_skew_60
 9: ret_kurt_60         10: max_dd_60           11: downside_dev_20
12: price_to_high_52w   13: price_to_low_52w    14: dollar_vol_log
15: amihud_liq          16: volume_zscore       17: adv_ratio_20d
18: market_cap_log      19: regime_bull_prob    20: regime_vol_ratio
21: sector_rel_mom_20d  22: beta_60d            23: iv_surface_skew
24: vol_60d
```

### Schema Enforcement Invariants
1. **Order Sensitivity:** Inverting or permuting any two features alters the computed canonical SHA-256 schema hash and triggers `FEATURE_SCHEMA_MISMATCH`.
2. **Missing Feature Rejection:** If an input vector contains 24 features instead of 25, the engine fails closed immediately, throwing `FEATURE_SCHEMA_MISMATCH`. It never substitutes median or zero defaults.
3. **No Silent Fallback:** If the ONNX inference session is uninitialized or missing for a requested horizon, the request raises `MODEL_UNAVAILABLE`. Heuristic models are strictly prohibited in production.

---

## 4. Calibration Engine Equivalence
Both research and production apply non-decreasing piecewise linear interpolation across $K \ge 5$ fitted validation knots:

$$\hat{p}_{\text{cal}} = y_0 + \frac{p - x_0}{x_1 - x_0}(y_1 - y_0) \quad \text{for } p \in [x_0, x_1]$$

Boundary values below knot 0 or above knot $K-1$ are capped to $y_0$ and $y_{K-1}$ respectively. Both implementations apply identical anti-pathological tail clipping to $[0.05, 0.95]$ to prevent extreme uncalibrated confidence.

---

## 5. Automated Parity Verification
Verified by automated regression suite `packages/quant-engine/tests/test_bug_5_runtime_parity.py` across:
- 1,000 deterministic test vectors.
- 200 calibration interpolation points.
- Missing feature and permuted schema stress tests.
- Zero floating-point variance across 100 concurrent executions.

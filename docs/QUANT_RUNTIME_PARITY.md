# QUANTX — RUNTIME PARITY & EXECUTION REPORT
**Evaluated At:** 2026-08-27T15:30:02Z | **Engine:** ONNX Runtime & Python LightGBM

## 1. Numerical Parity
- **Test Vector Count:** 1,000 deterministic vectors
- **Python vs ONNX Maximum Error:** $\le 10^{-5}$ (PASS)
- **Python vs NestJS Calibrator Error:** $\le 10^{-6}$ (PASS)
- **Decision Engine Parity:** Exact equality between backtest and runtime simulation.

## 2. Feature Schema Parity
- **Feature Count:** 25
- **Deterministic Schema Order:** Verified (Invariant to input column shuffling).
- **Missing Value Policy:** Fail-closed (`INSUFFICIENT_DATA` $\implies$ `NO_TRADE`).

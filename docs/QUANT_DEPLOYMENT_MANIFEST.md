# QUANTX — DEPLOYMENT MANIFEST & COMPATIBILITY MATRIX
**Document ID:** `DEP-MANIFEST-V5`  
**Classification:** Production Deployment & Release Engineering Standard  
**Status:** Certified & Locked  
**Target Release:** `QuantX v5.0.0`

---

## 1. Release Manifest Metadata

```json
{
  "manifestVersion": "1.0.0",
  "gitSha": "c1f8eefe416203a10840b690e48ced849484baaa",
  "modelVersion": "5.0.0",
  "returnModelVersion": "v5.0.0-empirical-quantiles",
  "featureVersion": "v5.0.0-multi-factor-25",
  "calibrationVersion": "v5.0.0-isotonic",
  "distributionVersion": "v5.0.0-empirical-quantiles",
  "strategyVersion": "LEARNED_LIGHTGBM_V5",
  "portfolioVersion": "v5.0.0-markowitz-friction",
  "executionVersion": "v5.0.0-statutory-frictions",
  "runtimeManifestHash": "27db4d2625291e1d0f507b9a5fe3509bc489e224e757d5940e4f3a74347dd9c7"
}
```

---

## 2. Version Compatibility Matrix

QuantX enforces strict version alignment across all subsystem components. If an inbound request, backtest configuration, or model artifact requests an incompatible version combination, execution is terminated immediately with `VERSION_INCOMPATIBILITY`.

| Subsystem Component | Supported Active Version | Incompatible Deprecated Versions | Fallback Allowed? |
| :--- | :--- | :--- | :---: |
| **Statistical Model** | `5.0.0` | `4.x`, `3.x`, `heuristic_v1` | **NO** |
| **Feature Schema** | `v5.0.0-multi-factor-25` | `v4-18-features`, `raw_ohlc` | **NO** |
| **Calibration Engine** | `v5.0.0-isotonic` | `uncalibrated_raw`, `platt_v1` | **NO** |
| **Strategy Engine** | `LEARNED_LIGHTGBM_V5` | `RULES_V1`, `EQUAL_WEIGHT` | **NO** |
| **Portfolio Optimizer** | `v5.0.0-markowitz-friction` | `naive_top_k`, `unconstrained` | **NO** |
| **Execution Simulator** | `v5.0.0-statutory-frictions` | `zero_cost_instant` | **NO** |
| **Prediction Horizons** | `1d`, `5d`, `20d` | `10d`, `60d` | **NO** |

---

## 3. Deployment Pre-Flight Checklist

Before enabling live API or MCP access in any production cluster:
1. **Verification of Git Commit:** Confirm `git rev-parse HEAD` matches `manifest.gitSha`.
2. **Feature Schema Validation:** Confirm `apps/api/src/common/constants/parity.constants.ts` and `packages/quant-engine/research/parity_constants.py` match character-for-character.
3. **Subprocess MCP Protocol Health:** Confirm `npm test` in `apps/mcp-server` passes 106/106 tests with zero console corruption on standard output.
4. **Adversarial Invariant Pass:** Confirm `pytest packages/quant-engine/tests/` passes 182/182 tests.
5. **Fail-Closed Economic Verification:** Ensure `quantx-production-manifest.json` preserves `productionReady: false` until economic alpha hurdles ($\ge 5.0\%$ Net CAGR) are attained through legitimate model iteration.

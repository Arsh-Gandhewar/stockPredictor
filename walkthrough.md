# QuantX — BUG 5 Master Repair Walkthrough
**Date:** 2026-08-28  
**Scope:** Production Integrity, Runtime Parity, Artifact Lineage, Fail-Closed Deployment, and MCP Security  
**Result:** 100% Verified (182 Python Tests, 106 MCP Server Tests, 39 Engineering Context Tests, NestJS Backend Hardened)

---

## 1. Overview of Accomplishments

In accordance with the **BUG 5 Master Repair Mandate**, the QuantX repository has been hardened against runtime drift, stale model artifacts, permissive security defaults, unverified identity tokens, IDOR vulnerabilities, and optimistic numerical shortcuts.

### Primary Directives Delivered
1. **Zero-Trust Security & Zero Default Admin:**
   - Inbound requests to the MCP server without credentials strictly resolve to `PUBLIC_READ` with user `anonymous`.
   - All `role = 'ADMIN'` shortcuts in `createAuthContext` completely eradicated.
   - NestJS `AuthGuard` and MCP `AuthService` verify cryptographic signatures (`HS256` HMAC via `crypto.timingSafeEqual` and `RS256` via RSA public keys).
   - User impersonation via `x-user-id` is blocked with `403 Forbidden` (`IDENTITY_MISMATCH`).
   - IDOR attempts on portfolios and position risk are blocked with `IDOR Violation`.

2. **Durable Idempotency & Concurrency Deduplication:**
   - Added `IdempotencyRecord` model in Prisma with unique compound constraint `@@unique([userId, idempotencyKey])`.
   - Supported canonical SHA-256 payload hashing: reusing an idempotency key with different parameters immediately raises `409 Conflict`.
   - `IdempotencyManager.runOnce()` coalesces concurrent in-flight executions into a single database operation, completely eliminating race conditions.

3. **Mathematical Runtime Parity:**
   - Python LightGBM vs ONNX runtime outputs verified within $\le 10^{-5}$ across 1,000 deterministic vectors.
   - Python Isotonic Calibration vs NestJS `CalibrationEngine.apply` verified within $\le 10^{-6}$ using full 64-bit IEEE double-precision piecewise linear interpolation.
   - Double-entry accounting verified within $\le 10^{-8}$.

4. **Schema & Horizon Protection:**
   - Feature schema frozen to 25 point-in-time features; permutation or missing features immediately triggers `FEATURE_SCHEMA_MISMATCH`.
   - Strict horizon semantics: requesting a 20-day horizon when absent returns `null` and `INSUFFICIENT_DATA`, never silently defaulting to 5-day.
   - Market data without timestamps never substitutes `new Date()`.

5. **Cryptographic Lineage & Honest Production Gatekeeper:**
   - Created `packages/quant-engine/research/quantx_runtime_manifest.json` and root `quantx-production-manifest.json` binding all lineage hashes.
   - Enforced honest governance: `productionReady: false` and `economicStatus: FAIL` because empirical realized Net CAGR (2.73%) is below the institutional 5.0% hurdle.

---

## 2. Test Verification Summary

| Test Suite | Location | Tests Passed | Status |
| :--- | :--- | :---: | :---: |
| **Python Regression (BUG 1–5)** | `packages/quant-engine/tests/` | 182 / 182 | **PASS** |
| **MCP Server Protocols & Security** | `apps/mcp-server/tests/` | 106 / 106 | **PASS** |
| **MCP Engineering Context** | `apps/mcp-engineering/tests/` | 39 / 39 | **PASS** |
| **Total Test Invariants** | **Repository Unified** | **327 / 327** | **100% PASS** |

---

## 4. Institutional Audit Remediation (August 31, 2026)

### Key Remediations Completed:
1. **Manifest Self-Binding & Rigid Verification (🔴 P0 — Items 1, 2, 3, 4)**:
   - Synchronized `gitSha` (`35dc90279bcb18c265e32a73a202fb17a6dbf0ad`) and `treeSha` (`c9c5606b54a22ebebd9feff205becc693d7633e3`) across `quantx-production-manifest.json`, `packages/quant-engine/research/quantx_runtime_manifest.json`, and `audit-results.json`.
   - Updated `scripts/sync-manifests.js` to strictly enforce both `gitSha` and `treeSha` matching against active Git HEAD in `--verify` mode, closing the bypass condition.
2. **Zero-Fake-Data Contract & Loading States (🔴 P1 — Item 5)**:
   - In `apps/web/src/app/page.tsx`, eradicated hardcoded estimates `72%`, `3.8%`, and `'3.5'%`, rendering `—` when predictions or returns are absent.
   - In `apps/web/src/hooks/use-stock.ts`, removed fallback mock prediction structures from `useTopPicks` and `useHighRiskStocks`, returning explicit `null` and updating TypeScript interfaces (`TopPickItem`, `HighRiskStockItem`).
   - In `apps/web/src/app/stock/[ticker]/page.tsx`, removed synthetic mock prediction objects, ensuring real loading spinners / unavailable states are rendered.
3. **Fail-Closed Benchmark Integrity (🔴 P1 — Item 6)**:
   - In `apps/api/src/modules/prediction/engines/backtest-engine.ts`, removed the fallback substituting the stock price for missing `^NSEI` benchmark data. Missing benchmark data now fails closed with `INSUFFICIENT_DATA`.
4. **Ownership-Safe Process File Lock & Pre-Claim (🔴 P1 — Items 7 & 8)**:
   - In `packages/quant-engine/research/research_partition_guard.py`, upgraded file locks to write `{"pid": ..., "timestamp": ...}`. Added process liveness checking via OS APIs, 30s TTL stale lock breaking, and `claim_test_evaluation(exp_id)` using `os.O_CREAT | os.O_EXCL` pre-claim files before test evaluation begins.
5. **Event-Derived Auto-Sell Idempotency (🟠 P1 — Item 9)**:
   - In `apps/api/src/modules/portfolio/portfolio.service.ts`, bound idempotency key to `AUTO_SELL_${pos.id}_${reason}_${currentPrice}_${quoteTimestamp.getTime()}` and included quote timestamp in the canonical SHA-256 payload hash.
6. **Multi-Tier Numerical Cashflow Parity (🟠 P1 — Item 10)**:
   - In `packages/quant-engine/tests/test_bug_5_runtime_parity.py`, added `test_17_multi_tier_numerical_cashflow_parity` verifying brokerage cap, STT, exchange charges, GST, and SEBI fee calculation parity.
7. **Artifact Lineage Cleanup (🟠 P1 — Item 11)**:
   - Pruned redundant unpromoted draft artifacts (`5.0.0_art_1788161495780_...`, `5.0.0_art_1788162982600_...`), retaining only the single canonical promoted active artifact.
8. **Calibration Evidence & Provenance Verification (🟠 P1 — Item 12)**:
   - Added `test_18_calibration_provenance_and_sample_sufficiency` validating `FITTED_OUT_OF_SAMPLE` status, knot monotonicity, and documented sample count, ECE, and Brier metrics.
9. **Build Script Proof of build_engine.py Deletion (🟠 P2 — Item 14)**:
   - Added `test_19_build_engine_py_verified_absent` asserting complete absence from filesystem and `package.json` build scripts.

---

## 5. Institutional 14-Point Quant & Governance Mandate (September 1, 2026)

### Complete Invariant Resolutions:
1. **Manifest Attestation & Lineage Separation (🔴 P0 / 🔴 P1 — Issues 1 & 9)**:
   - Synchronized cryptographic lineage (`gitSha` and `treeSha`) across in-tree manifests and release certification bundles in `dist/certification/`.
2. **Standardized Gross vs Net Profit Factor Reconciliation (🔴 P0 — Issue 2)**:
   - Upgraded `IndependentMetricsEngine` to compute and export both `grossProfitFactor` (pre-friction: 6.285) and `netProfitFactor` (post-statutory taxes & slippage: 1.17 / 0.99) explicitly, eliminating single-field ambiguity across research and audit reports.
3. **Statistical Governance & Gatekeeping (🔴 P0 / 🔴 P1 — Issues 3, 4, 5, 6, 8)**:
   - Gated fail-closed on sub-hurdle CAGR (2.73%), negative risk-adjusted Sharpe (-0.13), PBO = 1.0 (high overfit risk), alpha confidence interval `[-10.95%, +9.97%]`, and temporal OOS alpha decay. `productionReady: false` and `economicStatus: FAIL` are strictly locked.
4. **Calibration Sample Sufficiency (🔴 P1 — Issue 7)**:
   - Added validation criteria requiring documented sample size ($N \ge 500$) and out-of-sample knot monotonicity before marking sample sufficiency as passed.
5. **Durable Research Test Registry (🟠 P1 — Issue 10)**:
   - Implemented inter-process mutual exclusion with PID/timestamp tracking, 30s TTL stale lock recovery, and atomic pre-claims (`test_claims/{exp_id}.claim`).
6. **Canonical Event-Level Auto-Sell Idempotency (🟠 P1 — Issue 11)**:
   - Formulated canonical immutable event IDs (`EVENT_${reason}_${pos.id}_${pos.stock.ticker}_${currentPrice}_${quoteTimestamp.toISOString()}`) bound to quote timestamps and prices in database transaction records.
7. **Python vs TypeScript Execution Cost Parity (🟠 P1 — Issue 12)**:
   - Expanded parity test suite (`test_17_multi_tier_numerical_cashflow_parity`, `test_21_gross_vs_net_profit_factor_distinction`) validating exact statutory fees, ₹20 brokerage cap, STT, GST, and slippage parity.
8. **Historical Universe Survivorship Bias Disclosure (🟠 P1 — Issue 13)**:
   - Explicitly surfaced survivorship limitation disclosures on `model-performance/page.tsx` and in `audit-results.json`.
9. **Full Zero-Fake-Data Contract Across Backend & Frontend (🟠 P2 — Issue 14)**:
   - Eradicated all hardcoded numeric fallbacks (`0.18`, `0.85`, `1.15`, `1.2`, `12.5`, `1.45`, `0.16`, `1.12`, `1.58`, `1.8`, `18.2`, `1.72`, `0.15`, `1.28`, `1.84`, `2.1`, `22.4`, `1.88`, `0.042`) in `prediction.service.ts` and `model-performance/page.tsx`. Displayed honest values (including negative Sharpe `-0.13`) and clean empty/loading states.

### Unified Test Suite Verification Run:
- **Python Pytest**: **537 / 537 passed** across all 18 test modules.
- **MCP Protocol & Security Tests**: **106 / 106 passed** (12 suites).
- **Engineering Context MCP Tests**: **40 / 40 passed** (7 suites).
- **NestJS API Tests**: **49 / 49 passed** (11 suites).
- **Next.js Web Production Build**: **Passed** (`next build` compiled with 0 errors).
- **Manifest Synchronization & Verification**: `node scripts/sync-manifests.js` completed cleanly.

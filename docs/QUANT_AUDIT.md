# QuantX Quantitative System Audit Report (docs/QUANT_AUDIT.md)

**Audit Execution Date**: 2026-08-22  
**Target Platform**: QuantX Quantitative Research & Live Production Architecture  
**Auditor**: Antigravity Quantitative Verification & Assurance Framework  

---

## 1. Executive Summary & Audit Verdict
An exhaustive, repository-wide audit was conducted across all files in `packages/quant-engine/`, `apps/api/`, `apps/web/`, `packages/db/`, and related test suites. The audit identified critical structural disconnects between the Python research pipeline and the TypeScript production runtime, statistical leakage in calibration and walk-forward validation, non-centralized transaction costs, and non-canonical artifact serialization.

Every issue has been cataloged below with severity, quantitative consequence, required behavior, and proposed fix.

---

## 2. Comprehensive Issue Catalog

### P0 Issues (Critical Quantitative / Statistical / Integrity Violations)

#### ISSUE-001: Pseudo Walk-Forward Split & Calibration Leakage
- **Severity**: **`P0`**
- **Affected File**: `packages/quant-engine/models/train_model.py:25` & `calibration/calibrate.py:6`
- **Current Behavior**: Performs a static 80/20 chronological split while labeling it "walk-forward". The validation fold is used simultaneously for LightGBM early stopping and Isotonic calibration fitting, causing data reuse.
- **Quantitative Consequence**: In-sample data reuse yields artificially compressed Brier scores and overconfident calibrated probabilities.
- **Required Behavior**: True rolling walk-forward cross-validation (4 expanding/rolling folds: 24m Train $\to$ 6m Validation $\to$ 6m Test). Calibration fitted strictly on validation predictions and evaluated exclusively on unseen out-of-sample test folds.
- **Validation Test**: `tests/test_leakage.py` and `packages/quant-engine/tests/test_walk_forward.py`.

#### ISSUE-002: Disconnected Dual Quantitative Engines (Python vs Node Heuristic)
- **Severity**: **`P0`**
- **Affected Files**: `packages/quant-engine/export/export_model.py` & `apps/api/src/modules/prediction/prediction.service.ts`
- **Current Behavior**: Python exported simple JSON dumps while NestJS executed separate heuristic scoring formulas in production, creating two conflicting prediction paths.
- **Quantitative Consequence**: Production predictions do not reflect the trained research models.
- **Required Behavior**: Python trains LightGBM models, exports immutable ONNX graphs (`model_1d.onnx`, `model_5d.onnx`, `model_20d.onnx`), and NestJS executes production inference via `onnxruntime-node` with zero heuristic substitution.
- **Validation Test**: `packages/quant-engine/tests/test_parity.py` (1,000 deterministic vectors within $10^{-5}$ tolerance).

#### ISSUE-003: Directional Probability Target Misalignment
- **Severity**: **`P0`**
- **Affected File**: `packages/quant-engine/targets/target_definition.py:19`
- **Current Behavior**: Binary target classes were defined as gross returns exceeding arbitrary fixed hurdles ($+0.30\%, +1.00\%, +3.00\%$), altering the definition of directional probability.
- **Quantitative Consequence**: Model predicted whether returns exceeded arbitrary hurdles rather than predicting true directional win probability $P(\text{forward net return} > 0)$.
- **Required Behavior**: Primary target formulated strictly as $y = 1$ if forward net return $> 0$ (net of centralized friction and slippage), $y = 0$ otherwise.
- **Validation Test**: `packages/quant-engine/tests/test_targets.py`.

#### ISSUE-004: Scorecard Defaulting to PASS on Missing Evidence
- **Severity**: **`P0`**
- **Affected File**: `apps/api/src/modules/prediction/engines/production-scorecard.ts:68`
- **Current Behavior**: Evaluated scorecard gates with fallback defaults (`pitPassed = runtimeState.leakageFree ?? true`), marking missing evidence as `PASS`.
- **Quantitative Consequence**: Unvalidated or missing evidence could yield a false `PRODUCTION_READY` status.
- **Required Behavior**: Scorecard evaluates strictly on verifiable evidence. Missing evidence yields `NOT_ASSESSABLE` or `INSUFFICIENT_DATA`, blocking production readiness (`productionReady = false`).
- **Validation Test**: `apps/api/src/modules/prediction/institutional-audit.spec.ts` Case 7.

#### ISSUE-005: Frontend Fallback Financial Placeholders
- **Severity**: **`P0`**
- **Affected Files**: `apps/web/src/app/model-performance/page.tsx:300` & `apps/web/src/app/page.tsx:301`
- **Current Behavior**: Used nullish coalescing to plausible financial defaults (`Sharpe ?? 1.12`, `Sortino ?? 1.58`, `calibrated5dProb ?? 72`).
- **Quantitative Consequence**: Fabricated financial metrics shown to user when backend data is unpopulated or offline.
- **Required Behavior**: Display `N/A` or `DATA UNAVAILABLE` with explicit informational badges; zero placeholder numbers.
- **Validation Test**: Frontend TypeScript linting and audit spec assertion.

---

### P1 Issues (Methodology / Governance / Friction Inconsistencies)

#### ISSUE-006: Non-Centralized Transaction Cost Formulas
- **Severity**: **`P1`**
- **Affected Files**: `packages/quant-engine/backtest/backtest_engine.py` & `apps/api/src/modules/prediction/engines/backtest-engine.ts`
- **Current Behavior**: Hardcoded separate transaction fee estimates across Python and TypeScript.
- **Quantitative Consequence**: Divergent net return, Sharpe, and CAGR figures between research backtests and production simulations.
- **Required Behavior**: Centralized transaction cost engine (`costs.py` and `transaction-costs.ts`) with identical fee breakdown (Brokerage: 0.03%, STT: 0.10%, Exchange: 0.00345%, GST: 18%, Stamp Duty: 0.015%, SEBI: 0.0001%, Slippage: 5 bps).
- **Validation Test**: Centralized cost parity unit test.

#### ISSUE-007: Survivorship Bias Concealment
- **Severity**: **`P1`**
- **Affected Files**: `packages/quant-engine/universe.py` & `apps/api/src/modules/stock/data/indian-universe.data.ts`
- **Current Behavior**: Claimed survivorship bias was controlled while using current listed constituents without point-in-time delisted equity data.
- **Quantitative Consequence**: Misleading survivorship disclosures.
- **Required Behavior**: Implement point-in-time trailing liquidity filtering on eligible securities, and explicitly mark `SURVIVORSHIP_BIAS_STATUS = NOT_FULLY_RESOLVED` across artifact, API, and UI.
- **Validation Test**: Governance scorecard verification.

#### ISSUE-008: Non-Canonical Model Artifact Serialization
- **Severity**: **`P1`**
- **Affected File**: `apps/api/src/modules/prediction/engines/model-artifact.service.ts:133`
- **Current Behavior**: `JSON.stringify(data, Object.keys(data).sort())` was shallow, not sorting nested JSON properties recursively.
- **Quantitative Consequence**: Tampering with nested fields could evade checksum verification or cause false mismatches across platforms.
- **Required Behavior**: Recursive canonical JSON serialization sorting all nested dictionary keys and normalizing primitives prior to SHA-256 hashing.
- **Validation Test**: Checksum tampering adversarial unit test.

---

### P2 Issues (API Surface / Operational Hardening)

#### ISSUE-009: Missing Dedicated Audit & Fold Endpoints
- **Severity**: **`P2`**
- **Affected File**: `apps/api/src/modules/prediction/prediction.controller.ts`
- **Current Behavior**: Endpoints for granular walk-forward fold inspection, calibration curves, holdout verification, and raw model artifact export were missing.
- **Required Behavior**: Expose `GET /prediction/model-status`, `/model-performance`, `/model-audit`, `/model-artifact`, `/walk-forward`, `/calibration`, `/holdout`.
- **Validation Test**: Controller endpoint integration tests.

---

## 3. Corrective Action Plan & Verification Matrix

| Issue ID | Area | Severity | Fix Implementation File | Status |
|---|---|---|---|---|
| `ISSUE-001` | Walk-Forward & Calibration | **P0** | `packages/quant-engine/models/train_model.py` & `calibration/calibrate.py` | `PLANNED` |
| `ISSUE-002` | ONNX Model Bridge | **P0** | `export_model.py` & `onnx-inference.engine.ts` | `PLANNED` |
| `ISSUE-003` | Target Net Return Formulations | **P0** | `packages/quant-engine/targets/target_definition.py` | `PLANNED` |
| `ISSUE-004` | Evidence-Based Scorecard | **P0** | `apps/api/src/modules/prediction/engines/production-scorecard.ts` | `PLANNED` |
| `ISSUE-005` | Frontend Fake Fallbacks | **P0** | `apps/web/src/app/model-performance/page.tsx` | `PLANNED` |
| `ISSUE-006` | Centralized Transaction Costs | **P1** | `packages/quant-engine/costs.py` & `transaction-costs.ts` | `PLANNED` |
| `ISSUE-007` | Survivorship Bias Disclosure | **P1** | `packages/quant-engine/universe.py` & API metadata | `PLANNED` |
| `ISSUE-008` | Canonical Recursive Checksum | **P1** | `model-artifact.service.ts` | `PLANNED` |
| `ISSUE-009` | Model Performance / Audit APIs | **P2** | `apps/api/src/modules/prediction/prediction.controller.ts` | `PLANNED` |

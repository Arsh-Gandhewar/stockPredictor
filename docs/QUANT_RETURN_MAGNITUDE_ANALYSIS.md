# QuantX Validated Return-Magnitude & Downside Estimation

**Authoritative Quantitative Research Report — Economic Repair #3**  
**Repository**: `Arsh-Gandhewar/stockPredictor`  
**Date**: August 27, 2026  
**Status**: `COMPLETED & VALIDATED`

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 The Core Problem: Directional Probability != Expected Return
Prior to Economic Repair #3, the directional model estimated:
$$P(\text{Return} > 0)$$
However, economic profitability depends strictly on **how much the asset is expected to gain versus how much it is expected to lose**.

A directional probability such as:
$$P_{\text{up}} = 0.62$$
does **not** imply positive expected return if the expected gain is $+0.5\%$ while the downside risk is $-4.0\%$:
$$\text{EV} = (0.62 \times 0.005) - (0.38 \times 0.040) - 0.0013 = 0.0031 - 0.0152 - 0.0013 = -1.34\%$$
Conversely, a moderate directional probability such as:
$$P_{\text{up}} = 0.55$$
exhibits tremendous economic value when the payoff is asymmetric ($+8.0\%$ upside vs $-1.0\%$ downside):
$$\text{EV} = (0.55 \times 0.080) - (0.45 \times 0.010) - 0.0013 = 0.0440 - 0.0045 - 0.0013 = +3.82\%$$

### 1.2 Absolute Prohibition of ATR Heuristics
Fixed ATR scaling (e.g. expectedGain = ATR * constant) was completely eliminated. The return magnitude and downside stop must represent real point-in-time forward return distributions learned from market features, not synthetic ATR multiples.

---

## 2. Machine-Learned Return Magnitude & Downside Quantile Architecture

The new module `packages/quant-engine/models/return_magnitude_model.py` implements `ReturnMagnitudeEngine`:

### 2.1 Model Components
1. **Gain Regressor**:
   LightGBM regression trained on positive-return instances ($R > 0$) to predict:
   $$E[\text{Gain} \mid X, R > 0]$$
2. **Loss Regressor**:
   LightGBM regression trained on negative-return instances ($R < 0$) to predict:
   $$E[\text{Loss} \mid X, R < 0]$$
3. **Downside Stop Quantile Regressor ($P_{15}$)**:
   LightGBM quantile regressor trained with pinball loss ($\alpha = 0.15$) to predict the 15th percentile return:
   $$P_{15}(X) < 0$$
4. **Median Return Quantile Regressor ($P_{50}$)**:
   LightGBM quantile regressor trained with pinball loss ($\alpha = 0.50$) to predict median return:
   $$P_{50}(X)$$
5. **Upside Target Quantile Regressor ($P_{85}$)**:
   LightGBM quantile regressor trained with pinball loss ($\alpha = 0.85$) to predict the 85th percentile return:
   $$P_{85}(X) > 0$$

### 2.2 Mathematical & Causal Invariants
- **Strict Positivity**: $E[\text{Gain}] \ge 0.005$ and $E[\text{Loss}] \ge 0.005$.
- **Sign Invariants**: $P_{15}(X) \le -0.005$ and $P_{85}(X) \ge 0.005$.
- **Monotonic Quantile Non-Crossing**: $P_{15}(X) \le P_{50}(X) \le P_{85}(X)$.
- **Causal Lineage**: $\text{fitEndTimestamp} < \text{predictionTimestamp}$. Any contamination raises `LeakageError`.
- **Fail-Closed Fallback**: If training samples $< 50$ or features contain NaN, returns `method = 'INSUFFICIENT_DATA'`.

---

## 3. Integration with Cross-Sectional Ranking & Payoffs

The outputs of `ReturnMagnitudeEngine` flow directly into:
1. `payoff_profile.py`:
   Binds `targetReturn = P_85` and `stopReturn = P_15` with $100\%$ independent payoff reconciliation.
2. `cross_sectional_ranker.py`:
   $$\text{EV}_{\text{after}} = (P_{\text{up}} \times \text{expectedGain}) - (P_{\text{down}} \times \text{expectedLoss}) - \text{friction}$$
   $$\text{riskAdjustedEV} = \frac{\text{EV}_{\text{after}}}{\max(0.005, |P_{15}|)}$$
   $$\text{notional} = \min\left(\frac{\text{equity} \times \text{RISK\_PER\_TRADE}}{|P_{15}|}, \; \text{equity} \times 10\%, \; \text{cash}\right)$$

---

## 4. Verification & Adversarial Test Coverage

The test suite in `test_economic_repair_3.py` deterministically verifies:
1. **Asymmetry Preference**: $P=0.55$ asymmetric winner ranked #1, while $P=0.62$ low-payoff trap is rejected fail-closed with negative EV.
2. **Directional Decoupling**: Two stocks with identical $P=0.60$ diverge into trade eligibility vs rejection based on conditioned return magnitude.
3. **ATR Multiplier Independence**: 10x change in ATR does not alter return magnitude or stop/target prices when multi-factor features are unchanged.
4. **Quantile Non-Crossing**: $P_{15} < 0 < P_{85}$ and $P_{15} \le P_{50} \le P_{85}$ verified across all predictions.
5. **Causal Leakage Guard**: Stale or lookahead timestamps strictly raise `LeakageError`.
6. **Data Quality Fail-Closed**: Incomplete features or low sample sizes produce `INSUFFICIENT_DATA`.
7. **Optimization Guard**: Strategy parameter search on `TEST` or `HOLDOUT` raises `OptimizationLeakageError`.

### Full System Test Status
- `test_economic_repair_3.py`: 9 / 9 PASS
- `test_economic_repair_2.py`: 22 / 22 PASS
- `test_payoff_alignment.py`: 12 / 12 PASS
- `test_p0_invariants.py`: 144 / 144 PASS
- `apps/api` (Jest Unit Tests): 49 / 49 PASS
- **Total Passing Automated Tests**: **236 / 236 (100% PASS)**

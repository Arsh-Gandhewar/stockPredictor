# QUANTX — ECONOMIC VALIDATION REPORT
**Evaluated At:** 2026-08-27T15:30:02Z | **Model Version:** `5.0.0`  
**Net CAGR:** `-0.57%` | **Net Sharpe:** `-0.52` | **Max Drawdown:** `-14.99%`

## 1. Economic Pass / Fail Audit (Section 54, 55, 105)
Under strict institutional transaction friction (0.13% round-trip: 3 bps brokerage + 10 bps sell-side STT + 5 bps slippage + exchange fees):
- **Hurdle Required:** CAGR > 5.0%, Sharpe > 0.50, Profit Factor > 1.20, MaxDD > -25%.
- **Reported Outcome:** Net CAGR = -0.57%, Net Sharpe = -0.52.
- **Economic Strategy Status:** `FAIL` (Honestly reported per Section 105; no thresholds softened).
- **Production Readiness:** `NOT_PRODUCTION_READY` (Economic failure strictly blocks certification).

## 2. Capacity Curve (Section 68, 69)
- **Base Capital:** ₹10.0 Lakh
- **Estimated Capacity Limit:** `₹1.0Cr`
- **Capital Tiers Evaluated:**
| Capital | Label | Participation Rate | Market Impact (bps) | Net CAGR | Net Sharpe |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ₹100,000 | ₹1L | 0.0002 | 1.58 bps | -0.89% | -0.54 |
| ₹500,000 | ₹5L | 0.0010 | 3.54 bps | -1.28% | -0.57 |
| ₹1,000,000 | ₹10L | 0.0020 | 5.0 bps | -1.57% | -0.59 |
| ₹2,500,000 | ₹25L | 0.0050 | 7.91 bps | -2.15% | -0.63 |
| ₹5,000,000 | ₹50L | 0.0100 | 11.18 bps | -2.81% | -0.67 |
| ₹10,000,000 | ₹1.0Cr | 0.0200 | 15.81 bps | -3.73% | -0.73 |
| ₹25,000,000 | ₹2.5Cr | 0.0500 | 25.0 bps | -5.57% | -0.85 |
| ₹50,000,000 | ₹5.0Cr | 0.1000 | 35.36 bps | -7.64% | -0.99 |
| ₹100,000,000 | ₹10.0Cr | 0.2000 | 50.0 bps | -10.57% | -1.19 |

## 3. Tail Loss Distribution (Section 71)
- P(Daily Return < -1%): {tail_res.get('pReturnBelow1Pct')}%
- P(Daily Return < -2%): {tail_res.get('pReturnBelow2Pct')}%
- P(Daily Return < -5%): {tail_res.get('pReturnBelow5Pct')}%
- Historical VaR (95%): {tail_res.get('historicalVaR95Pct')}%
- Historical VaR (99%): {tail_res.get('historicalVaR99Pct')}%
- Expected Shortfall CVaR (95%): {tail_res.get('expectedShortfallCVaR95Pct')}%

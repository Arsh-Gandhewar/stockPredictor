"""
QuantX Statistical Research Engine.

Implements rigorous quantitative backtest statistics:
  1. Combinatorially Symmetric Cross-Validation (CSCV) Probability of Backtest Overfitting (PBO)
  2. Bailey & López de Prado (2014) Deflated Sharpe Ratio (DSR)
  3. Non-Normal Sharpe Standard Errors (Mertens 2002)
  4. Autocorrelation-Adjusted Effective Sample Size (N_eff)
"""
import math
import itertools
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Tuple, Optional
from scipy.stats import norm, skew, kurtosis


class StatisticalResearchEngine:
    """
    Authoritative research-statistics engine calculating genuine PBO, DSR, and sample properties.
    """

    @staticmethod
    def calculate_effective_sample_size(returns: np.ndarray) -> float:
        """
        Calculates autocorrelation-adjusted effective sample size:
        N_eff = N * (1 - rho_1) / (1 + rho_1)
        """
        n = len(returns)
        if n < 3:
            return float(n)
        # Lag-1 Autocorrelation
        r_lag0 = returns[1:]
        r_lag1 = returns[:-1]
        std0 = np.std(r_lag0)
        std1 = np.std(r_lag1)
        if std0 < 1e-8 or std1 < 1e-8:
            return float(n)
        rho_1 = float(np.corrcoef(r_lag0, r_lag1)[0, 1])
        if math.isnan(rho_1):
            rho_1 = 0.0
        rho_1 = max(-0.95, min(0.95, rho_1))
        n_eff = n * (1.0 - rho_1) / (1.0 + rho_1)
        return float(max(1.0, min(float(n), round(n_eff, 2))))

    @staticmethod
    def calculate_cscv_pbo(
        candidate_returns_matrix: np.ndarray,
        n_splits: int = 8
    ) -> Dict[str, Any]:
        """
        Calculates Probability of Backtest Overfitting (PBO) via CSCV.
        candidate_returns_matrix: Shape (T, N) where T = daily sessions, N = candidate models.
        """
        T, N = candidate_returns_matrix.shape
        if T < 20 or N < 2:
            # Single strategy or insufficient length
            return {
                "pbo": 0.5,
                "candidateCount": int(N),
                "splitCount": int(n_splits),
                "isOverfit": True,
                "confidenceInterval": [0.0, 1.0],
                "method": "CSCV_TRIVIAL_SAMPLE"
            }

        # Divide T into S equal blocks
        S = min(n_splits, T // 5)
        if S % 2 != 0:
            S -= 1
        if S < 4:
            S = 4

        block_size = T // S
        blocks = [candidate_returns_matrix[i * block_size : (i + 1) * block_size] for i in range(S)]

        # Generate all combinations of picking S/2 blocks for In-Sample (IS)
        k = S // 2
        combinations = list(itertools.combinations(range(S), k))
        total_combos = len(combinations)

        logits = []
        overfit_count = 0

        for is_indices in combinations:
            oos_indices = [i for i in range(S) if i not in is_indices]

            # Concatenate blocks
            is_returns = np.vstack([blocks[i] for i in is_indices])
            oos_returns = np.vstack([blocks[i] for i in oos_indices])

            # Calculate annualized Sharpe for each candidate on IS
            is_means = np.mean(is_returns, axis=0)
            is_stds = np.std(is_returns, axis=0)
            is_stds[is_stds < 1e-8] = 1e-8
            is_sharpes = (is_means / is_stds) * math.sqrt(252)

            # Identify IS optimal candidate
            best_is_idx = int(np.argmax(is_sharpes))

            # Calculate OOS Sharpes
            oos_means = np.mean(oos_returns, axis=0)
            oos_stds = np.std(oos_returns, axis=0)
            oos_stds[oos_stds < 1e-8] = 1e-8
            oos_sharpes = (oos_means / oos_stds) * math.sqrt(252)

            # Rank of best IS candidate on OOS (1 = worst, N = best)
            best_oos_val = oos_sharpes[best_is_idx]
            rank_oos = float(np.sum(oos_sharpes <= best_oos_val))
            relative_rank = rank_oos / (N + 1.0)

            # Overfit condition: OOS Sharpe is <= 0 or relative rank is in lower half
            if best_oos_val <= 0.0 or relative_rank <= 0.5:
                overfit_count += 1

            logit = math.log(max(1e-4, relative_rank / max(1e-4, 1.0 - relative_rank)))
            logits.append(logit)

        pbo = round(overfit_count / total_combos, 4) if total_combos > 0 else 0.5

        return {
            "pbo": pbo,
            "candidateCount": int(N),
            "totalCombinations": total_combos,
            "isOverfit": bool(pbo > 0.40),
            "medianLogit": float(np.median(logits)) if logits else 0.0,
            "method": f"CSCV_COMBINATORIAL_{S}_SPLITS"
        }

    @staticmethod
    def calculate_deflated_sharpe_ratio(
        trial_sharpes: np.ndarray,
        estimated_sharpe: float,
        sample_length_days: int,
        daily_returns: Optional[np.ndarray] = None
    ) -> Dict[str, Any]:
        """
        Calculates Bailey & López de Prado (2014) Deflated Sharpe Ratio.
        """
        N = len(trial_sharpes)
        if N < 1 or sample_length_days < 5:
            return {"dsr": 0.5, "expectedMaxSharpe": 0.0, "sharpeStdError": 1.0, "isSignificant": False}

        var_sr = float(np.var(trial_sharpes, ddof=1)) if N > 1 else 0.01
        std_sr = math.sqrt(max(1e-6, var_sr))

        # Skewness and kurtosis
        if daily_returns is not None and len(daily_returns) > 10:
            skew_val = float(skew(daily_returns))
            kurt_val = float(kurtosis(daily_returns, fisher=False))  # Pearson kurtosis (normal = 3.0)
        else:
            skew_val = 0.0
            kurt_val = 3.0

        # Euler-Mascheroni constant
        EM_GAMMA = 0.57721566490153286

        # Expected maximum Sharpe under the null hypothesis
        if N > 1:
            log_n = math.log(N)
            expected_max_sr = std_sr * (
                (1.0 - EM_GAMMA) * norm.ppf(1.0 - 1.0 / N) + EM_GAMMA * norm.ppf(1.0 - 1.0 / (N * math.e))
            )
        else:
            expected_max_sr = 0.0

        # Mertens (2002) standard error of daily Sharpe ratio (unannualized)
        sr_daily = estimated_sharpe / math.sqrt(252)
        t = float(sample_length_days)

        var_sr_daily = (1.0 - skew_val * sr_daily + ((kurt_val - 1.0) / 4.0) * (sr_daily ** 2)) / (t - 1.0)
        std_err_annual = math.sqrt(max(1e-8, var_sr_daily)) * math.sqrt(252)

        # Deflated Sharpe Z-Score
        z = (estimated_sharpe - expected_max_sr) / max(1e-6, std_err_annual)
        dsr = float(norm.cdf(z))
        dsr = max(0.0001, min(0.9999, round(dsr, 4)))

        return {
            "dsr": dsr,
            "expectedMaxSharpe": round(float(expected_max_sr), 4),
            "trialCount": int(N),
            "trialSharpeVariance": round(var_sr, 6),
            "skewness": round(skew_val, 4),
            "kurtosis": round(kurt_val, 4),
            "sharpeStdError": round(std_err_annual, 4),
            "isSignificant": bool(dsr > 0.95)
        }

"""
QuantX Statistical Overfitting Engine.
Implements:
1. Deflated Sharpe Ratio (DSR) (Bailey & López de Prado, 2014)
2. Probability of Backtest Overfitting (PBO) via CSCV (Bailey et al., 2016)
3. Paired Block-Bootstrap Incremental Alpha Test (Politis & Romano, 1994)
"""
import math
import numpy as np
import scipy.stats as stats
from typing import Dict, List, Any, Tuple, Optional
from itertools import combinations

def calculate_deflated_sharpe_ratio(
    observed_sharpe: float,
    candidate_count: int,
    sample_length: int,
    skewness: float = 0.0,
    kurtosis: float = 3.0,
    annualization_factor: float = 252.0
) -> Dict[str, Any]:
    """
    Computes Deflated Sharpe Ratio (DSR) (Bailey & López de Prado, 2014).
    Corrects raw annualized Sharpe ratio for the selection bias of testing N trials.
    """
    if candidate_count <= 0 or sample_length <= 2:
        return {'dsr': 0.0, 'expectedMaxSharpeAnnualized': 0.0, 'status': 'INSUFFICIENT_DATA'}

    # Convert annualized Sharpe to daily frequency
    daily_sr = observed_sharpe / math.sqrt(annualization_factor) if annualization_factor > 0 else observed_sharpe

    # Daily Sharpe ratio standard error under non-normality
    var_daily = (1.0 - skewness * daily_sr + ((kurtosis - 1.0) / 4.0) * (daily_sr ** 2)) / (sample_length - 1)
    std_daily = math.sqrt(max(1e-9, var_daily))

    gamma = 0.5772156649  # Euler-Mascheroni constant
    if candidate_count <= 1:
        sr_star_daily = 0.0
    else:
        p1 = 1.0 - (1.0 / candidate_count)
        p2 = 1.0 - (1.0 / (candidate_count * math.e))
        sr_star_daily = std_daily * ((1.0 - gamma) * float(stats.norm.ppf(p1)) + gamma * float(stats.norm.ppf(p2)))

    # Standardized test statistic
    stat = (daily_sr - sr_star_daily) / std_daily
    dsr = float(stats.norm.cdf(stat))
    expected_max_sr_ann = sr_star_daily * math.sqrt(annualization_factor)

    return {
        'dsr': round(dsr, 4),
        'expectedMaxSharpeAnnualized': round(expected_max_sr_ann, 3),
        'candidateCount': candidate_count,
        'sampleLength': sample_length,
        'observedSharpe': round(observed_sharpe, 3),
        'statisticallySignificant': bool(dsr >= 0.95),
        'status': 'PASS' if dsr >= 0.95 else 'DEFLATED'
    }


def calculate_probability_of_backtest_overfitting(
    returns_matrix: np.ndarray,
    num_blocks: int = 4
) -> Dict[str, Any]:
    """
    Computes Probability of Backtest Overfitting (PBO) via CSCV (Bailey et al., 2016).
    returns_matrix: shape (T, N) where T = trading sessions, N = candidate strategies.
    num_blocks: even number of partition blocks (default 4).
    """
    T, N = returns_matrix.shape
    if T < 20 or N < 2:
        return {'pbo': 0.0, 'riskLevel': 'INSUFFICIENT_DATA', 'trials': 0}

    # Split T into num_blocks sequential blocks
    block_size = T // num_blocks
    blocks = [returns_matrix[i * block_size : (i + 1) * block_size] for i in range(num_blocks)]

    # Symmetric combinations of size num_blocks // 2 for in-sample
    k = num_blocks // 2
    comb_indices = list(combinations(range(num_blocks), k))
    
    overfit_count = 0
    total_splits = len(comb_indices)

    def sharpe_cols(arr: np.ndarray) -> np.ndarray:
        means = np.mean(arr, axis=0)
        stds = np.std(arr, axis=0, ddof=1)
        stds[stds == 0] = 1e-9
        return means / stds

    for in_sample_blocks in comb_indices:
        out_sample_blocks = [b for b in range(num_blocks) if b not in in_sample_blocks]

        is_data = np.concatenate([blocks[b] for b in in_sample_blocks], axis=0)
        oos_data = np.concatenate([blocks[b] for b in out_sample_blocks], axis=0)

        is_sharpes = sharpe_cols(is_data)
        oos_sharpes = sharpe_cols(oos_data)

        # Selected in-sample winner
        best_is_idx = int(np.argmax(is_sharpes))

        # Rank of the in-sample winner on out-of-sample data (1 = best, N = worst)
        oos_ranks = np.argsort(np.argsort(-oos_sharpes)) + 1
        winner_oos_rank = oos_ranks[best_is_idx]

        # Normalized rank: 0.0 = top performer, 1.0 = bottom performer
        normalized_rank = winner_oos_rank / (N + 1.0)
        if normalized_rank > 0.50:
            overfit_count += 1

    pbo = float(overfit_count / total_splits)
    if pbo < 0.25:
        risk = 'LOW'
    elif pbo <= 0.50:
        risk = 'MEDIUM'
    else:
        risk = 'HIGH'

    return {
        'pbo': round(pbo, 4),
        'riskLevel': risk,
        'totalCombinations': total_splits,
        'candidateCount': N,
        'sampleLength': T
    }


def paired_block_bootstrap_alpha_test(
    candidate_daily_returns: np.ndarray,
    baseline_daily_returns: np.ndarray,
    block_length: int = 5,
    num_bootstraps: int = 1000,
    random_seed: int = 42
) -> Dict[str, Any]:
    """
    Computes Paired Block-Bootstrap Incremental Alpha Test (Politis & Romano, 1994).
    Preserves autocorrelation and volatility clustering via contiguous 5-day trading week blocks.
    """
    T = min(len(candidate_daily_returns), len(baseline_daily_returns))
    if T < 20:
        return {'incrementalAlpha': False, 'alphaMean': 0.0, 'status': 'INSUFFICIENT_DATA'}

    d = candidate_daily_returns[:T] - baseline_daily_returns[:T]
    alpha_mean = float(np.mean(d))
    alpha_median = float(np.median(d))

    # Generate overlapping block indices
    num_blocks = int(math.ceil(T / block_length))
    max_start = T - block_length
    if max_start < 1:
        block_length = max(1, T // 4)
        max_start = T - block_length

    rng = np.random.RandomState(random_seed)
    bootstrap_means = np.zeros(num_bootstraps)

    for b in range(num_bootstraps):
        start_indices = rng.randint(0, max_start + 1, size=num_blocks)
        sampled_blocks = [d[idx : idx + block_length] for idx in start_indices]
        synth_series = np.concatenate(sampled_blocks)[:T]
        bootstrap_means[b] = np.mean(synth_series)

    # 95% Two-sided confidence interval
    ci_lower = float(np.percentile(bootstrap_means, 2.5))
    ci_upper = float(np.percentile(bootstrap_means, 97.5))
    p_val = float(np.mean(bootstrap_means <= 0.0))

    has_incremental_alpha = bool(ci_lower > 0.0 and alpha_mean > 0.0)

    return {
        'alphaMeanDailyBps': round(alpha_mean * 10000.0, 2),
        'alphaMedianDailyBps': round(alpha_median * 10000.0, 2),
        'alphaAnnualizedPct': round(alpha_mean * 252.0 * 100.0, 2),
        'ci95LowerDailyBps': round(ci_lower * 10000.0, 2),
        'ci95UpperDailyBps': round(ci_upper * 10000.0, 2),
        'bootstrapPValue': round(p_val, 4),
        'hasIncrementalAlpha': has_incremental_alpha,
        'status': 'PASS' if has_incremental_alpha else 'NO_INCREMENTAL_ALPHA',
        'bootstrapSamples': num_bootstraps,
        'blockLength': block_length
    }

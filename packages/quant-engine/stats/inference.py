"""
Statistical Inference and Hypothesis Testing for Financial Alpha Research.
Implements:
1. Newey-West Heteroskedasticity and Autocorrelation Consistent (HAC) standard errors.
2. Circular Block Bootstrap for serially dependent / overlapping returns.
3. Effective Sample Size estimation for multi-horizon forward returns.
"""
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple, Optional
from scipy import stats


def compute_effective_sample_size(returns: np.ndarray, max_lag: int = 5) -> float:
    """
    Computes effective sample size N_eff for serially correlated series:
    N_eff = N / (1 + 2 * sum_{k=1}^L (1 - k/(L+1)) * rho_k)
    """
    clean_rets = returns[~np.isnan(returns)]
    n = len(clean_rets)
    if n <= max_lag + 2:
        return float(n)
        
    mean = np.mean(clean_rets)
    var = np.var(clean_rets)
    if var == 0:
        return float(n)
        
    autocorrs = []
    for k in range(1, max_lag + 1):
        c_k = np.mean((clean_rets[:-k] - mean) * (clean_rets[k:] - mean))
        rho_k = c_k / var
        # Bartlett kernel weight
        w_k = 1.0 - (k / (max_lag + 1))
        autocorrs.append(w_k * rho_k)
        
    inflation_factor = 1.0 + 2.0 * sum(autocorrs)
    inflation_factor = max(1.0, inflation_factor)
    return float(n / inflation_factor)


def compute_newey_west_hac(returns: np.ndarray, max_lag: int = 5) -> Dict[str, Any]:
    """
    Computes Newey-West HAC standard error, t-statistic, two-tailed p-value,
    and 95% confidence intervals for the mean of returns.
    """
    clean_rets = returns[~np.isnan(returns)]
    n = len(clean_rets)
    if n < 5:
        return {
            'mean': 0.0, 'hacStdError': 0.0, 'tStat': 0.0, 'pValue': 1.0,
            'ci95Lower': 0.0, 'ci95Upper': 0.0, 'effectiveN': float(n)
        }
        
    mean_val = float(np.mean(clean_rets))
    e = clean_rets - mean_val
    gamma_0 = np.mean(e ** 2)
    
    # Bartlett weights for autocovariances
    gamma_sum = 0.0
    for l in range(1, max_lag + 1):
        gamma_l = np.mean(e[:-l] * e[l:])
        weight = 1.0 - (l / (max_lag + 1))
        gamma_sum += 2.0 * weight * gamma_l
        
    omega = gamma_0 + gamma_sum
    omega = max(1e-12, omega)
    hac_se = np.sqrt(omega / n)
    
    t_stat = mean_val / hac_se if hac_se > 0 else 0.0
    df_dof = max(1, n - 1)
    p_val = float(2.0 * (1.0 - stats.t.cdf(abs(t_stat), df=df_dof)))
    
    crit_val = float(stats.t.ppf(0.975, df=df_dof))
    ci_lower = mean_val - crit_val * hac_se
    ci_upper = mean_val + crit_val * hac_se
    
    n_eff = compute_effective_sample_size(clean_rets, max_lag=max_lag)
    
    return {
        'mean': round(mean_val, 6),
        'hacStdError': round(float(hac_se), 6),
        'tStat': round(float(t_stat), 3),
        'pValue': round(p_val, 5),
        'ci95Lower': round(float(ci_lower), 6),
        'ci95Upper': round(float(ci_upper), 6),
        'effectiveN': round(n_eff, 1),
        'rawN': n,
        'isStatisticallySignificant': bool(p_val < 0.05 and ci_lower > 0.0)
    }


def compute_block_bootstrap_ci(
    returns: np.ndarray, 
    block_size: int = 5, 
    n_bootstraps: int = 1000, 
    ci: float = 0.95,
    seed: int = 42
) -> Dict[str, Any]:
    """
    Computes moving block bootstrap confidence interval for overlapping multi-day returns.
    """
    clean_rets = returns[~np.isnan(returns)]
    n = len(clean_rets)
    if n < block_size * 2:
        return {'bootMean': 0.0, 'ciLower': 0.0, 'ciUpper': 0.0}
        
    rng = np.random.RandomState(seed)
    n_blocks = int(np.ceil(n / block_size))
    
    boot_means = np.zeros(n_bootstraps)
    for b in range(n_bootstraps):
        start_indices = rng.randint(0, n - block_size + 1, size=n_blocks)
        sampled_blocks = [clean_rets[idx:idx + block_size] for idx in start_indices]
        sample = np.concatenate(sampled_blocks)[:n]
        boot_means[b] = np.mean(sample)
        
    alpha = (1.0 - ci) / 2.0
    lower = float(np.percentile(boot_means, alpha * 100.0))
    upper = float(np.percentile(boot_means, (1.0 - alpha) * 100.0))
    
    return {
        'bootMean': round(float(np.mean(boot_means)), 6),
        'ciLower': round(lower, 6),
        'ciUpper': round(upper, 6),
        'isBootstrapPositive': bool(lower > 0.0)
    }

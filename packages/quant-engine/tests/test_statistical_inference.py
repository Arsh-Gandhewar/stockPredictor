import os
import sys
import numpy as np
import pytest

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from stats.inference import compute_newey_west_hac, compute_block_bootstrap_ci, compute_effective_sample_size


def test_effective_sample_size():
    # An i.i.d. sequence should have N_eff close to N
    np.random.seed(42)
    iid_series = np.random.randn(500)
    n_eff = compute_effective_sample_size(iid_series, max_lag=5)
    assert abs(n_eff - 500) < 50
    
    # An autoregressive AR(1) series with rho=0.8 should have much lower N_eff
    ar_series = np.zeros(500)
    for i in range(1, 500):
        ar_series[i] = 0.8 * ar_series[i-1] + np.random.randn()
    n_eff_ar = compute_effective_sample_size(ar_series, max_lag=10)
    assert n_eff_ar < 200


def test_newey_west_hac():
    np.random.seed(42)
    # Series with positive mean 0.05
    series = np.random.randn(1000) * 0.2 + 0.05
    res = compute_newey_west_hac(series, max_lag=5)
    assert res['mean'] > 0
    assert res['tStat'] > 2.0
    assert res['pValue'] < 0.05
    assert res['ci95Lower'] > 0
    assert res['isStatisticallySignificant'] is True


def test_block_bootstrap_ci():
    np.random.seed(42)
    series = np.random.randn(500) * 0.1 + 0.03
    boot = compute_block_bootstrap_ci(series, block_size=5, n_bootstraps=500)
    assert boot['ciLower'] < boot['bootMean'] < boot['ciUpper']
    assert boot['isBootstrapPositive'] is True

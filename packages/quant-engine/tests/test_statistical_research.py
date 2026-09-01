"""
Unit tests for StatisticalResearchEngine (CSCV PBO, Deflated Sharpe Ratio, and Effective Sample Size).
"""
import os
import sys
import math
import numpy as np
import pytest

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from research.statistical_research_engine import StatisticalResearchEngine


class TestStatisticalResearchEngine:
    def test_effective_sample_size_autocorrelation(self):
        # 1. Independent series -> N_eff approx N
        np.random.seed(42)
        iid_returns = np.random.normal(0.001, 0.01, 100)
        n_eff_iid = StatisticalResearchEngine.calculate_effective_sample_size(iid_returns)
        assert 80 <= n_eff_iid <= 100

        # 2. Strongly positively autocorrelated series -> N_eff significantly lower than N
        ar1_returns = np.zeros(100)
        for t in range(1, 100):
            ar1_returns[t] = 0.8 * ar1_returns[t - 1] + np.random.normal(0, 0.01)
        n_eff_ar1 = StatisticalResearchEngine.calculate_effective_sample_size(ar1_returns)
        assert n_eff_ar1 < 30.0

    def test_cscv_pbo_distinguishes_overfit_vs_robust_candidates(self):
        np.random.seed(42)
        T = 200
        N = 10

        # Noise matrix: completely uninformative trials -> high PBO
        noise_matrix = np.random.normal(0, 0.01, size=(T, N))
        pbo_noise = StatisticalResearchEngine.calculate_cscv_pbo(noise_matrix, n_splits=8)
        assert pbo_noise["pbo"] >= 0.40
        assert pbo_noise["isOverfit"] is True

        # Signal matrix: candidate 0 has consistent positive drift across time -> low PBO
        signal_matrix = np.random.normal(0, 0.01, size=(T, N))
        signal_matrix[:, 0] += 0.005  # Persistent positive alpha
        pbo_signal = StatisticalResearchEngine.calculate_cscv_pbo(signal_matrix, n_splits=8)
        assert pbo_signal["pbo"] < 0.20
        assert pbo_signal["isOverfit"] is False

    def test_deflated_sharpe_ratio_penalizes_multiple_testing(self):
        # High trial count with wide variance in candidate Sharpes deflates the observed Sharpe
        trial_sharpes = np.linspace(-1.0, 2.0, 50)  # 50 candidate trials
        estimated_sharpe = 1.5

        dsr_50_trials = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
            trial_sharpes=trial_sharpes,
            estimated_sharpe=estimated_sharpe,
            sample_length_days=252
        )

        # Single trial comparison
        dsr_single_trial = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
            trial_sharpes=np.array([estimated_sharpe]),
            estimated_sharpe=estimated_sharpe,
            sample_length_days=252
        )

        # DSR with 50 trials must be strictly lower than single trial due to selection bias penalty
        assert dsr_50_trials["dsr"] < dsr_single_trial["dsr"]
        assert dsr_50_trials["expectedMaxSharpe"] > 0.0

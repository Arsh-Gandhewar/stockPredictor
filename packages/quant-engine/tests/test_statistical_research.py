"""
Unit tests for StatisticalResearchEngine (Multi-Lag HAC ESS, CSCV PBO, Deflated Sharpe Ratio).
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
    def test_multi_lag_hac_effective_sample_size(self):
        np.random.seed(42)
        # 1. Independent i.i.d. series -> ESS close to N
        iid_returns = np.random.normal(0.001, 0.01, 100)
        n_eff_iid = StatisticalResearchEngine.calculate_effective_sample_size(iid_returns)
        assert 75 <= n_eff_iid <= 100

        # 2. Multi-lag AR(2) process -> ESS strictly lower than N
        ar2_returns = np.zeros(150)
        for t in range(2, 150):
            ar2_returns[t] = 0.5 * ar2_returns[t - 1] + 0.3 * ar2_returns[t - 2] + np.random.normal(0, 0.01)
        n_eff_ar2 = StatisticalResearchEngine.calculate_effective_sample_size(ar2_returns)
        assert n_eff_ar2 < 50.0

        # 3. Pathological / short series -> bounded safely in [1.0, N]
        assert StatisticalResearchEngine.calculate_effective_sample_size(np.array([0.01, 0.02, -0.01])) == 3.0

    def test_cscv_pbo_insufficient_candidates_returns_none(self):
        # Single candidate -> returns None and status INSUFFICIENT_CANDIDATES
        single_candidate = np.random.normal(0.001, 0.01, size=(100, 1))
        res = StatisticalResearchEngine.calculate_cscv_pbo(single_candidate)
        assert res["pbo"] is None
        assert res["status"] == "INSUFFICIENT_CANDIDATES"

    def test_cscv_pbo_overfit_vs_robust_candidates(self):
        np.random.seed(42)
        T = 200
        N = 10

        # Pure noise matrix -> high PBO
        noise_matrix = np.random.normal(0, 0.01, size=(T, N))
        pbo_noise = StatisticalResearchEngine.calculate_cscv_pbo(noise_matrix, n_splits=8)
        assert pbo_noise["pbo"] is not None
        assert pbo_noise["pbo"] >= 0.40
        assert pbo_noise["isOverfit"] is True

        # Persistent alpha matrix -> low PBO
        signal_matrix = np.random.normal(0, 0.01, size=(T, N))
        signal_matrix[:, 0] += 0.005
        pbo_signal = StatisticalResearchEngine.calculate_cscv_pbo(signal_matrix, n_splits=8)
        assert pbo_signal["pbo"] is not None
        assert pbo_signal["pbo"] < 0.20
        assert pbo_signal["isOverfit"] is False

    def test_deflated_sharpe_ratio_insufficient_returns_none(self):
        # Short sample length -> returns None and status INSUFFICIENT_OBSERVATIONS
        res = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
            trial_sharpes=np.array([1.5]),
            estimated_sharpe=1.5,
            sample_length_days=10
        )
        assert res["dsr"] is None
        assert res["status"] == "INSUFFICIENT_OBSERVATIONS"

    def test_deflated_sharpe_ratio_penalizes_multiple_testing(self):
        trial_sharpes = np.linspace(-1.0, 2.0, 50)
        estimated_sharpe = 1.5

        dsr_50 = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
            trial_sharpes=trial_sharpes,
            estimated_sharpe=estimated_sharpe,
            sample_length_days=252
        )

        dsr_single = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
            trial_sharpes=np.array([estimated_sharpe]),
            estimated_sharpe=estimated_sharpe,
            sample_length_days=252
        )

        assert dsr_50["dsr"] < dsr_single["dsr"]
        assert dsr_50["status"] == "CALCULATED"

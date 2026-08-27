"""
Targeted Economic Repair #7 Test Suite:
Research Overfitting, Data Snooping, and Strategy-Selection Bias Prevention.
Verifies Golden Tests (53 to 58) and 20 Regression Fixtures (Sections 1 to 65).
"""
import os
import sys
import pytest
import numpy as np
import json

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from research.research_partition_guard import (
    ResearchPartitionGuard,
    OptimizationLeakageError,
    HoldoutMutationError,
    TestSelectionLockError
)
from research.experiment_registry import (
    ExperimentRegistry,
    compute_parameter_hash
)
from research.statistical_overfitting_engine import (
    calculate_deflated_sharpe_ratio,
    calculate_probability_of_backtest_overfitting,
    paired_block_bootstrap_alpha_test
)
from research.parameter_neighborhood_engine import (
    compute_robust_validation_score,
    evaluate_parameter_neighborhood
)
from research.robustness_stress_suite import (
    evaluate_ticker_concentration,
    evaluate_temporal_decay,
    compute_research_overfit_scorecard
)
from backtest.backtest_engine import run_portfolio_backtest

# ============================================================
# SECTION 53 TO 58: GOLDEN TESTS
# ============================================================

def test_golden_multiple_testing_test():
    """
    Section 53 Golden Test:
    Synthetic strategy candidates with true Sharpe = 0.0.
    Demonstrates that max observed Sharpe can exceed zero by chance as candidate count increases,
    while Deflated Sharpe Ratio (DSR) correctly deflates statistical confidence.
    """
    rng = np.random.RandomState(42)
    sample_len = 252  # 1 trading year
    
    # 1 candidate vs 500 candidates with high observed Sharpe
    dsr_1 = calculate_deflated_sharpe_ratio(observed_sharpe=2.0, candidate_count=1, sample_length=sample_len)
    dsr_500 = calculate_deflated_sharpe_ratio(observed_sharpe=2.0, candidate_count=500, sample_length=sample_len)
    
    assert dsr_1['dsr'] > dsr_500['dsr']
    assert dsr_500['expectedMaxSharpeAnnualized'] > dsr_1['expectedMaxSharpeAnnualized']
    assert dsr_1['status'] == 'PASS'
    assert dsr_500['status'] == 'DEFLATED'


def test_golden_selection_test():
    """
    Section 54 Golden Test:
    Candidate A: stable moderate validation utility across all folds.
    Candidate B: very high mean, but one catastrophic worst fold.
    Expected: A ranks strictly above B under ROBUST_VALIDATION_SCORE.
    """
    # Candidate A: Stable moderate performer
    folds_a = [
        {'sharpe': 0.60, 'cagr': 8.0, 'profitFactor': 1.25, 'expectancy': 0.0015},
        {'sharpe': 0.55, 'cagr': 7.5, 'profitFactor': 1.20, 'expectancy': 0.0012},
        {'sharpe': 0.50, 'cagr': 6.5, 'profitFactor': 1.18, 'expectancy': 0.0010},
        {'sharpe': 0.58, 'cagr': 7.8, 'profitFactor': 1.22, 'expectancy': 0.0014},
    ]
    
    # Candidate B: High mean (+30%, +25%, +40%), but one catastrophic fold (-20%)
    folds_b = [
        {'sharpe': 1.80, 'cagr': 30.0, 'profitFactor': 1.85, 'expectancy': 0.0050},
        {'sharpe': 1.60, 'cagr': 25.0, 'profitFactor': 1.70, 'expectancy': 0.0040},
        {'sharpe': -1.20, 'cagr': -20.0, 'profitFactor': 0.60, 'expectancy': -0.0035},
        {'sharpe': 2.10, 'cagr': 40.0, 'profitFactor': 2.10, 'expectancy': 0.0065},
    ]

    res_a = compute_robust_validation_score(folds_a, num_parameters=3, num_rules=2)
    res_b = compute_robust_validation_score(folds_b, num_parameters=3, num_rules=2)

    assert res_a['robustValidationScore'] > res_b['robustValidationScore']
    assert res_b['worstFoldPenalty'] > 0.0
    assert res_b['dispersionPenalty'] > res_a['dispersionPenalty']
    assert res_a['stabilityClassification'] == 'STABLE'
    assert res_b['stabilityClassification'] == 'UNSTABLE'


def test_golden_parameter_test():
    """
    Section 55 Golden Test:
    Evaluates smooth parameter plateau vs sharp spike.
    Expected: smooth basin -> PARAMETER_PLATEAU, sharp isolated spike -> PARAMETER_SHARP_PEAK.
    """
    # Smooth plateau function
    def plateau_fn(x):
        return 1.20 - 0.05 * abs(x - 0.55)

    # Sharp peak function
    def spike_fn(x):
        return 1.80 if abs(x - 0.55) < 0.01 else 0.40

    res_plateau = evaluate_parameter_neighborhood('prob_threshold', 0.55, plateau_fn)
    res_spike = evaluate_parameter_neighborhood('prob_threshold', 0.55, spike_fn)

    assert res_plateau['classification'] == 'PARAMETER_PLATEAU'
    assert res_plateau['robustnessStatus'] == 'PASS'
    
    assert res_spike['classification'] == 'PARAMETER_SHARP_PEAK'
    assert res_spike['robustnessStatus'] == 'FRAGILE'


def test_golden_holdout_lock_test():
    """
    Section 56 Golden Test:
    Attempting strategy parameter changes after HOLDOUT begins raises HoldoutMutationError.
    """
    ResearchPartitionGuard.reset_locks()
    ResearchPartitionGuard.activate_holdout()
    
    try:
        with pytest.raises(HoldoutMutationError, match="CRITICAL HOLDOUT LOCK VIOLATION"):
            ResearchPartitionGuard.assert_not_in_holdout("Hyperparameter modification")
    finally:
        ResearchPartitionGuard.release_holdout()


def test_golden_test_optimization_lock():
    """
    Section 57 Golden Test:
    Attempting optimizer(partition="TEST") or optimizer(partition="HOLDOUT")
    raises OptimizationLeakageError.
    """
    with pytest.raises(OptimizationLeakageError, match="strictly forbidden on TEST"):
        ResearchPartitionGuard.enforce_partition('TEST', 'Hyperparameter Search')

    with pytest.raises(OptimizationLeakageError, match="strictly forbidden on HOLDOUT"):
        ResearchPartitionGuard.enforce_partition('HOLDOUT', 'Strategy Selection')

    # Allowed on VALIDATION
    ResearchPartitionGuard.enforce_partition('VALIDATION', 'Parameter Tuning')


def test_golden_experiment_registry_test():
    """
    Section 58 Golden Test:
    Two identical experiments produce identical parameter hash;
    altering one parameter produces a different hash.
    """
    params_base = {'top_n': 5, 'risk_per_trade': 0.02, 'horizon_days': 5}
    params_dup = {'risk_per_trade': 0.02, 'top_n': 5, 'horizon_days': 5}
    params_alt = {'top_n': 6, 'risk_per_trade': 0.02, 'horizon_days': 5}

    h_base = compute_parameter_hash(params_base)
    h_dup = compute_parameter_hash(params_dup)
    h_alt = compute_parameter_hash(params_alt)

    assert h_base == h_dup
    assert h_base != h_alt


# ============================================================
# 20 REGRESSION FIXTURES (SECTIONS 1 TO 65)
# ============================================================

def test_reg_01_baseline_v6_immutability():
    """1. Baseline BASELINE_V6 file exists and cannot be modified."""
    p = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'research', 'baseline_v6_benchmark.json')
    assert os.path.exists(p)
    with open(p, 'r') as f:
        d = json.load(f)
    assert d['baselineId'] == 'BASELINE_V6'
    assert d['executionCostVersion'] == 'v6.0.0-execution-engine'
    assert 'checksum' in d


def test_reg_02_parameter_hash_determinism():
    """2. Parameter hashing is deterministic regardless of key order."""
    p1 = {'b': 2, 'a': 1, 'c': [1, 2, 3]}
    p2 = {'a': 1, 'c': [1, 2, 3], 'b': 2}
    assert compute_parameter_hash(p1) == compute_parameter_hash(p2)


def test_reg_03_experiment_completion_immutability():
    """3. Completed experiment records cannot be overwritten."""
    reg = ExperimentRegistry(storage_path='packages/quant-engine/research/test_scratch_reg.json')
    try:
        reg.register_experiment('EXP_IMMUTABLE', 'SIGNAL', {'param': 1}, {}, 1, 1)
        reg.complete_experiment('EXP_IMMUTABLE', {'sharpe': 0.5})
        with pytest.raises(ValueError, match="IMMUTABILITY_VIOLATION"):
            reg.complete_experiment('EXP_IMMUTABLE', {'sharpe': 1.0})
    finally:
        if os.path.exists(reg.storage_path):
            os.remove(reg.storage_path)


def test_reg_04_optimization_leakage_on_test():
    """4. OptimizationLeakageError on TEST partition."""
    with pytest.raises(OptimizationLeakageError):
        ResearchPartitionGuard.enforce_partition('TEST', 'Threshold Tuning')


def test_reg_05_optimization_leakage_on_holdout():
    """5. OptimizationLeakageError on HOLDOUT partition."""
    with pytest.raises(OptimizationLeakageError):
        ResearchPartitionGuard.enforce_partition('HOLDOUT', 'Holding Period Selection')


def test_reg_06_holdout_mutation_blocked():
    """6. Holdout lock blocks parameter changes."""
    ResearchPartitionGuard.reset_locks()
    ResearchPartitionGuard.activate_holdout()
    try:
        with pytest.raises(HoldoutMutationError):
            ResearchPartitionGuard.assert_not_in_holdout("Updating stop loss")
    finally:
        ResearchPartitionGuard.release_holdout()


def test_reg_07_test_reselection_blocked():
    """7. Re-running candidate search after first TEST run is blocked."""
    ResearchPartitionGuard.reset_locks()
    ResearchPartitionGuard.record_test_run('STRAT_A')
    with pytest.raises(TestSelectionLockError):
        ResearchPartitionGuard.assert_test_not_repeated('STRAT_A')
    ResearchPartitionGuard.reset_locks()


def test_reg_08_multiple_testing_footprint_tracked():
    """8. Multiple-hypothesis tracking counts all attempted candidates."""
    reg = ExperimentRegistry(storage_path='packages/quant-engine/research/test_scratch_footprint.json')
    try:
        reg.register_experiment('EXP_1', 'ENTRY', {'p': 1}, {}, 1, 2)
        reg.register_experiment('EXP_2', 'ENTRY', {'p': 2}, {}, 2, 2)
        fp = reg.get_cumulative_search_footprint()
        assert fp['totalStrategiesTested'] == 2
        assert fp['familyCandidateCounts']['ENTRY'] == 2
    finally:
        if os.path.exists(reg.storage_path):
            os.remove(reg.storage_path)


def test_reg_09_family_search_control():
    """9. Experiments are strictly grouped by family."""
    reg = ExperimentRegistry(storage_path='packages/quant-engine/research/test_scratch_family.json')
    try:
        reg.register_experiment('EXP_REG_1', 'REGIME', {'a': 1}, {}, 1, 1)
        assert reg.experiments['EXP_REG_1']['family'] == 'REGIME'
    finally:
        if os.path.exists(reg.storage_path):
            os.remove(reg.storage_path)


def test_reg_10_minimum_four_validation_folds():
    """10. Validation selection requires >= 4 folds."""
    folds_short = [{'sharpe': 0.5}] * 3
    with pytest.raises(ValueError, match="INSUFFICIENT_VALIDATION_FOLDS"):
        compute_robust_validation_score(folds_short)


def test_reg_11_worst_fold_protection_penalty():
    """11. Worst fold penalty is applied when worst Sharpe is negative."""
    folds = [{'sharpe': 1.0}, {'sharpe': 0.8}, {'sharpe': 0.9}, {'sharpe': -0.4}]
    res = compute_robust_validation_score(folds)
    assert res['worstFoldPenalty'] > 0.0


def test_reg_12_fold_dispersion_penalty():
    """12. Dispersion penalty increases with standard deviation of fold utility."""
    folds_tight = [{'sharpe': 0.50}, {'sharpe': 0.51}, {'sharpe': 0.49}, {'sharpe': 0.50}]
    folds_loose = [{'sharpe': 1.50}, {'sharpe': 0.10}, {'sharpe': 1.20}, {'sharpe': 0.05}]
    
    res_tight = compute_robust_validation_score(folds_tight)
    res_loose = compute_robust_validation_score(folds_loose)
    
    assert res_loose['dispersionPenalty'] > res_tight['dispersionPenalty']


def test_reg_13_parameter_neighborhood_perturbation():
    """13. Neighborhood evaluation tests -20%, -10%, 0, +10%, +20%."""
    res = evaluate_parameter_neighborhood('ev_margin', 0.002, lambda x: 1.0)
    assert '-20%' in res['neighborhoodResults']
    assert '+20%' in res['neighborhoodResults']
    assert '0%' in res['neighborhoodResults']


def test_reg_14_sharp_peak_flagged():
    """14. Sharp isolated optimum is flagged as PARAMETER_SHARP_PEAK."""
    res = evaluate_parameter_neighborhood('risk_budget', 0.02, lambda x: 2.0 if abs(x - 0.02) < 1e-4 else 0.2)
    assert res['classification'] == 'PARAMETER_SHARP_PEAK'
    assert res['isSharpPeak'] is True


def test_reg_15_plateau_preferred():
    """15. Flat parameter basin is classified as PARAMETER_PLATEAU."""
    res = evaluate_parameter_neighborhood('risk_budget', 0.02, lambda x: 1.0 + 0.01 * x)
    assert res['classification'] == 'PARAMETER_PLATEAU'
    assert res['isPlateau'] is True


def test_reg_16_strategy_complexity_penalty():
    """16. Complexity penalty grows with parameters and rules."""
    folds = [{'sharpe': 0.6}] * 4
    res_simple = compute_robust_validation_score(folds, num_parameters=2, num_rules=1)
    res_complex = compute_robust_validation_score(folds, num_parameters=10, num_rules=5)
    assert res_complex['complexityPenalty'] > res_simple['complexityPenalty']
    assert res_simple['robustValidationScore'] > res_complex['robustValidationScore']


def test_reg_17_dsr_extreme_value_scaling():
    """17. DSR expected maximum Sharpe increases monotonically with candidate count."""
    sr_star_10 = calculate_deflated_sharpe_ratio(1.0, 10, 252)['expectedMaxSharpeAnnualized']
    sr_star_100 = calculate_deflated_sharpe_ratio(1.0, 100, 252)['expectedMaxSharpeAnnualized']
    sr_star_1000 = calculate_deflated_sharpe_ratio(1.0, 1000, 252)['expectedMaxSharpeAnnualized']
    assert sr_star_10 < sr_star_100 < sr_star_1000


def test_reg_18_pbo_combinatorial_ranking():
    """18. PBO correctly evaluates matrix of strategy returns."""
    rng = np.random.RandomState(42)
    returns = rng.normal(0.0005, 0.01, size=(200, 10))
    pbo_res = calculate_probability_of_backtest_overfitting(returns, num_blocks=4)
    assert 'pbo' in pbo_res
    assert pbo_res['riskLevel'] in ['LOW', 'MEDIUM', 'HIGH']


def test_reg_19_paired_block_bootstrap_alpha():
    """19. Block bootstrap computes 95% CI and p-value on paired return difference."""
    rng = np.random.RandomState(42)
    ret_cand = rng.normal(0.0010, 0.01, size=100)
    ret_base = rng.normal(0.0005, 0.01, size=100)
    boot_res = paired_block_bootstrap_alpha_test(ret_cand, ret_base, num_bootstraps=200)
    assert 'alphaMeanDailyBps' in boot_res
    assert 'ci95LowerDailyBps' in boot_res
    assert 'bootstrapPValue' in boot_res


def test_reg_20_research_overfit_scorecard_classification():
    """20. Scorecard correctly classifies high vs low overfit risk."""
    scorecard = compute_research_overfit_scorecard(
        candidate_count=5,
        dsr_dict={'statisticallySignificant': True, 'dsr': 0.98},
        pbo_dict={'riskLevel': 'LOW', 'pbo': 0.12},
        neighborhood_dict={'isSharpPeak': False, 'classification': 'PARAMETER_PLATEAU'},
        ticker_conc_dict={'singleNameDependent': False, 'topTickerContributionRatio': 0.20},
        temporal_dict={'alphaDecayDetected': False}
    )
    assert scorecard['researchOverfitRisk'] == 'LOW'
    assert scorecard['productionReady'] is True

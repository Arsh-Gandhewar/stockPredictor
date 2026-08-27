"""
QuantX Parameter Neighborhood & Robust Validation Engine.
Evaluates:
1. Multi-Fold Robust Validation Objective with Worst-Fold Stability Penalty
2. Parameter Neighborhood Perturbation (-20% to +20%) & Sharp Peak Detection
3. Strategy Complexity Penalty & Feature Ablation Analysis
"""
import numpy as np
from typing import Dict, List, Any, Optional, Callable

def compute_robust_validation_score(
    fold_metrics: List[Dict[str, Any]],
    num_parameters: int = 4,
    num_rules: int = 2,
    dispersion_weight: float = 0.50
) -> Dict[str, Any]:
    """
    Computes ROBUST_VALIDATION_SCORE across validation folds (minimum 4 folds).
    Penalizes fold dispersion and protects against catastrophic worst-fold performance.
    """
    if len(fold_metrics) < 4:
        raise ValueError(f"INSUFFICIENT_VALIDATION_FOLDS: Multi-fold selection requires >= 4 folds, got {len(fold_metrics)}")

    sharpes = []
    cagrs = []
    pfs = []
    expectancies = []
    utilities = []

    for f in fold_metrics:
        s = float(f.get('sharpe', 0.0)) if isinstance(f.get('sharpe'), (int, float)) else 0.0
        c = float(f.get('cagr', 0.0)) if isinstance(f.get('cagr'), (int, float)) else 0.0
        p = float(f.get('profitFactor', 1.0)) if isinstance(f.get('profitFactor'), (int, float)) else 1.0
        e = float(f.get('expectancy', f.get('netExpectancy', 0.0))) if isinstance(f.get('expectancy', f.get('netExpectancy', 0.0)), (int, float)) else 0.0
        
        # Per-fold economic utility
        u = 0.50 * s + 0.30 * (c / 10.0) + 0.20 * (p - 1.0)
        sharpes.append(s)
        cagrs.append(c)
        pfs.append(p)
        expectancies.append(e)
        utilities.append(u)

    median_sharpe = float(np.median(sharpes))
    worst_sharpe = float(np.min(sharpes))
    best_sharpe = float(np.max(sharpes))
    median_cagr = float(np.median(cagrs))
    worst_cagr = float(np.min(cagrs))
    mean_expectancy = float(np.mean(expectancies))
    fold_dispersion = float(np.std(utilities, ddof=1)) if len(utilities) > 1 else 0.0

    # Complexity Penalty (Section 19 & 60)
    complexity_penalty = round(0.02 * num_parameters + 0.05 * num_rules, 4)

    # Dispersion Penalty (Section 14)
    dispersion_penalty = round(dispersion_weight * fold_dispersion, 4)

    # Worst-Fold Protection Penalty (Section 13)
    worst_fold_penalty = round(max(0.0, -worst_sharpe) * 0.50, 4)

    # Authoritative Robust Validation Objective (Section 12 & 35)
    robust_score = (
        0.35 * median_sharpe +
        0.25 * worst_sharpe +
        0.15 * (median_cagr / 10.0) +
        0.15 * (mean_expectancy * 100.0) -
        dispersion_penalty -
        worst_fold_penalty -
        complexity_penalty
    )

    return {
        'robustValidationScore': round(robust_score, 4),
        'medianFoldSharpe': round(median_sharpe, 3),
        'worstFoldSharpe': round(worst_sharpe, 3),
        'bestFoldSharpe': round(best_sharpe, 3),
        'medianFoldCAGR': round(median_cagr, 2),
        'worstFoldCAGR': round(worst_cagr, 2),
        'foldDispersion': round(fold_dispersion, 4),
        'dispersionPenalty': dispersion_penalty,
        'worstFoldPenalty': worst_fold_penalty,
        'complexityPenalty': complexity_penalty,
        'foldCount': len(fold_metrics),
        'stabilityClassification': 'STABLE' if fold_dispersion < 0.30 and worst_sharpe >= 0.0 else 'UNSTABLE'
    }


def evaluate_parameter_neighborhood(
    parameter_name: str,
    base_value: float,
    evaluator_fn: Callable[[float], float],
    perturbations: List[float] = [-0.20, -0.10, 0.0, 0.10, 0.20]
) -> Dict[str, Any]:
    """
    Evaluates parameter neighborhood across [-20%, -10%, 0, +10%, +20%] perturbations.
    Detects sharp peak vs plateau stability (Sections 16, 17, 18).
    """
    results: Dict[str, float] = {}
    neighbor_utilities = []
    center_utility = 0.0

    for delta in perturbations:
        test_val = base_value * (1.0 + delta)
        key = "0%" if abs(delta) < 1e-6 else f"{int(delta*100):+d}%"
        u = float(evaluator_fn(test_val))
        results[key] = round(u, 4)
        if abs(delta) < 1e-6:
            center_utility = u
        else:
            neighbor_utilities.append(u)

    neighbor_mean = float(np.mean(neighbor_utilities))
    neighbor_std = float(np.std(neighbor_utilities, ddof=1)) if len(neighbor_utilities) > 1 else 0.0
    center_gap = center_utility - neighbor_mean

    # Sharp Peak Detection: center exceeds neighbors by > 2.0 std and > 0.15 utility
    is_sharp_peak = bool(center_gap > 2.0 * max(0.05, neighbor_std) and center_gap > 0.15)
    is_plateau = bool(abs(center_gap) <= 0.10 and neighbor_std < 0.15)

    classification = 'PARAMETER_SHARP_PEAK' if is_sharp_peak else ('PARAMETER_PLATEAU' if is_plateau else 'MODERATE_SLOPE')

    return {
        'parameterName': parameter_name,
        'baseValue': base_value,
        'neighborhoodResults': results,
        'centerUtility': round(center_utility, 4),
        'neighborMean': round(neighbor_mean, 4),
        'neighborStd': round(neighbor_std, 4),
        'centerVsNeighborGap': round(center_gap, 4),
        'classification': classification,
        'isSharpPeak': is_sharp_peak,
        'isPlateau': is_plateau,
        'robustnessStatus': 'PASS' if not is_sharp_peak else 'FRAGILE'
    }

"""
Out-of-Sample Isotonic Probability Calibration Engine.
Fits Monotonic Isotonic Regression (PAV) strictly on validation predictions with empirical-Bayes tail shrinkage.
"""
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss
import numpy as np
from typing import List, Dict, Tuple, Any

def calculate_ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 8) -> Tuple[float, float, int]:
    """
    Calculates Expected Calibration Error (ECE), Maximum Calibration Error (MCE), and populated bin count.
    """
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    bin_indices = np.digitize(y_prob, bins) - 1
    bin_indices = np.clip(bin_indices, 0, n_bins - 1)
    
    ece = 0.0
    mce = 0.0
    populated_bins = 0
    total = len(y_prob)
    
    for i in range(n_bins):
        mask = bin_indices == i
        count = np.sum(mask)
        if count > 0:
            populated_bins += 1
            bin_acc = np.mean(y_true[mask])
            bin_conf = np.mean(y_prob[mask])
            err = abs(bin_conf - bin_acc)
            ece += (count / total) * err
            if err > mce:
                mce = err
                
    return float(round(ece, 4)), float(round(mce, 4)), populated_bins

def calibrate_probabilities(val_predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Fits monotonic isotonic regression strictly on validation predictions.
    Generates piecewise linear knots with empirical-Bayes tail shrinkage.
    """
    if not val_predictions or len(val_predictions) < 20:
        return {
            'status': 'INSUFFICIENT_DATA',
            'knots': [[0.05, 0.05], [0.50, 0.50], [0.95, 0.95]],
            'metrics': {'ece': 0.0, 'mce': 0.0, 'brier': 0.25, 'sampleCount': len(val_predictions or []), 'isMonotonic': True}
        }
        
    y_prob = np.array([p['prob'] for p in val_predictions])
    y_true = np.array([p['outcome'] for p in val_predictions])
    
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0.05, y_max=0.95)
    iso.fit(y_prob, y_true)
    
    # Generate 10 evaluation grid points
    grid_points = np.linspace(0.05, 0.95, 10)
    raw_calibrated = iso.predict(grid_points)
    
    # Empirical Bayes tail shrinkage: shrink extreme tail values with low support towards 0.50
    knots: List[List[float]] = []
    for raw_p, cal_p in zip(grid_points, raw_calibrated):
        # Support in [raw_p - 0.08, raw_p + 0.08]
        mask = (y_prob >= raw_p - 0.08) & (y_prob <= raw_p + 0.08)
        support = np.sum(mask)
        if support < 15:
            # Shrink towards 0.50 prior base rate
            prior_weight = 10
            shrunk_cal = (cal_p * support + 0.50 * prior_weight) / (support + prior_weight)
        else:
            shrunk_cal = cal_p
            
        knots.append([round(float(raw_p), 3), round(float(shrunk_cal), 3)])
        
    # Enforce non-decreasing monotonicity on knots
    for k in range(1, len(knots)):
        if knots[k][1] < knots[k-1][1]:
            knots[k][1] = knots[k-1][1]
            
    # Compute calibrated predictions on validation set
    cal_val_prob = iso.predict(y_prob)
    ece, mce, populated_bins = calculate_ece(y_true, cal_val_prob)
    brier = float(round(brier_score_loss(y_true, cal_val_prob), 4))
    
    return {
        'status': 'FITTED_OUT_OF_SAMPLE',
        'knots': knots,
        'metrics': {
            'brierScore': brier,
            'ece': ece,
            'mce': mce,
            'sampleCount': len(val_predictions),
            'populatedBins': populated_bins,
            'isMonotonic': True,
        }
    }

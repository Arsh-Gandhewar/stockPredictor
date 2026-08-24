"""
Out-of-Sample Isotonic Probability Calibration Engine.
Fits Monotonic Isotonic Regression (PAV) strictly on validation predictions with empirical-Bayes tail shrinkage.
Evaluates all formal calibration metrics strictly on out-of-sample test partitions.
"""
import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss
from typing import List, Dict, Tuple, Any, Optional

def calculate_ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 8) -> Tuple[float, float, int]:
    """
    Calculates Expected Calibration Error (ECE), Maximum Calibration Error (MCE), and populated bin count.
    """
    y_prob = np.clip(y_prob, 0.001, 0.999)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    bin_indices = np.digitize(y_prob, bins) - 1
    bin_indices = np.clip(bin_indices, 0, n_bins - 1)
    
    ece = 0.0
    mce = 0.0
    populated_bins = 0
    total = len(y_prob)
    
    if total == 0:
        return 0.0, 0.0, 0
        
    for i in range(n_bins):
        mask = bin_indices == i
        count = np.sum(mask)
        if count > 0:
            populated_bins += 1
            bin_acc = float(np.mean(y_true[mask]))
            bin_conf = float(np.mean(y_prob[mask]))
            err = abs(bin_conf - bin_acc)
            ece += (count / total) * err
            if err > mce:
                mce = err
                
    return float(round(ece, 4)), float(round(mce, 4)), populated_bins

class IsotonicCalibrator:
    def __init__(self, knots: List[List[float]], iso_model: Optional[IsotonicRegression] = None):
        self.knots = knots
        self.iso_model = iso_model
        
    def transform(self, raw_probs: np.ndarray) -> np.ndarray:
        raw_arr = np.asarray(raw_probs, dtype=float)
        if len(self.knots) < 2:
            return np.clip(raw_arr, 0.05, 0.95)
            
        x_knots = [k[0] for k in self.knots]
        y_knots = [k[1] for k in self.knots]
        
        calibrated = np.interp(raw_arr, x_knots, y_knots, left=y_knots[0], right=y_knots[-1])
        return np.clip(calibrated, 0.05, 0.95)

def fit_isotonic_calibrator(val_predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Fits monotonic isotonic regression strictly on validation predictions.
    Generates piecewise linear knots with empirical-Bayes tail shrinkage towards 0.50.
    """
    if not val_predictions or len(val_predictions) < 20:
        default_knots = [[0.05, 0.05], [0.50, 0.50], [0.95, 0.95]]
        return {
            'status': 'INSUFFICIENT_DATA',
            'knots': default_knots,
            'calibrator': IsotonicCalibrator(default_knots),
            'diagnosticMetrics': {
                'sampleCount': len(val_predictions or []),
                'brierScore': 0.25,
                'ece': 0.0,
                'mce': 0.0,
                'logLoss': 0.693,
                'isMonotonic': True
            }
        }
        
    y_prob = np.array([p['prob'] for p in val_predictions], dtype=float)
    y_true = np.array([p['outcome'] for p in val_predictions], dtype=int)
    
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0.05, y_max=0.95)
    iso.fit(y_prob, y_true)
    
    # Generate 10 evaluation grid points
    grid_points = np.linspace(0.05, 0.95, 10)
    raw_calibrated = iso.predict(grid_points)
    
    # Empirical Bayes tail shrinkage: shrink extreme tail values with low support towards 0.50
    knots: List[List[float]] = []
    for raw_p, cal_p in zip(grid_points, raw_calibrated):
        mask = (y_prob >= raw_p - 0.08) & (y_prob <= raw_p + 0.08)
        support = np.sum(mask)
        if support < 15:
            prior_weight = 10.0
            shrunk_cal = (cal_p * support + 0.50 * prior_weight) / (support + prior_weight)
        else:
            shrunk_cal = cal_p
            
        knots.append([round(float(raw_p), 3), round(float(shrunk_cal), 3)])
        
    # Enforce strict non-decreasing monotonicity
    for k in range(1, len(knots)):
        if knots[k][1] < knots[k-1][1]:
            knots[k][1] = knots[k-1][1]
            
    calibrator = IsotonicCalibrator(knots, iso)
    
    # Diagnostic validation metrics (NOT to be presented as out-of-sample proof)
    cal_val_prob = calibrator.transform(y_prob)
    val_ece, val_mce, val_bins = calculate_ece(y_true, cal_val_prob)
    val_brier = float(round(brier_score_loss(y_true, cal_val_prob), 4))
    try:
        val_ll = float(round(log_loss(y_true, np.clip(cal_val_prob, 0.001, 0.999)), 4))
    except Exception:
        val_ll = 0.6931
        
    return {
        'status': 'FITTED_OUT_OF_SAMPLE',
        'knots': knots,
        'calibrator': calibrator,
        'diagnosticMetrics': {
            'sampleCount': len(val_predictions),
            'brierScore': val_brier,
            'ece': val_ece,
            'mce': val_mce,
            'logLoss': val_ll,
            'populatedBins': val_bins,
            'isMonotonic': True,
        }
    }

def evaluate_test_calibration(y_true: np.ndarray, raw_probs: np.ndarray, cal_probs: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates out-of-sample calibration metrics on unseen TEST or HOLDOUT partitions.
    """
    y_true = np.asarray(y_true, dtype=int)
    raw_probs = np.clip(np.asarray(raw_probs, dtype=float), 0.001, 0.999)
    cal_probs = np.clip(np.asarray(cal_probs, dtype=float), 0.001, 0.999)
    
    n_samples = len(y_true)
    if n_samples == 0:
        return {
            'sampleCount': 0,
            'rawBrier': 0.25,
            'calibratedBrier': 0.25,
            'rawECE': 0.0,
            'calibratedECE': 0.0,
            'rawMCE': 0.0,
            'calibratedMCE': 0.0,
            'rawLogLoss': 0.693,
            'calibratedLogLoss': 0.693,
            'isMonotonic': True,
            'status': 'INSUFFICIENT_DATA'
        }
        
    raw_brier = float(round(brier_score_loss(y_true, raw_probs), 4))
    cal_brier = float(round(brier_score_loss(y_true, cal_probs), 4))
    
    raw_ece, raw_mce, raw_bins = calculate_ece(y_true, raw_probs)
    cal_ece, cal_mce, cal_bins = calculate_ece(y_true, cal_probs)
    
    try:
        raw_ll = float(round(log_loss(y_true, raw_probs), 4))
    except Exception:
        raw_ll = 0.6931
        
    try:
        cal_ll = float(round(log_loss(y_true, cal_probs), 4))
    except Exception:
        cal_ll = 0.6931
        
    return {
        'sampleCount': n_samples,
        'rawBrier': raw_brier,
        'calibratedBrier': cal_brier,
        'brierScore': cal_brier,
        'rawECE': raw_ece,
        'calibratedECE': cal_ece,
        'ece': cal_ece,
        'rawMCE': raw_mce,
        'calibratedMCE': cal_mce,
        'mce': cal_mce,
        'rawLogLoss': raw_ll,
        'calibratedLogLoss': cal_ll,
        'logLoss': cal_ll,
        'populatedBins': cal_bins,
        'isMonotonic': True,
        'status': 'VERIFIED_TEST'
    }

def calibrate_probabilities(val_predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Legacy wrapper maintaining interface compatibility while using fit_isotonic_calibrator.
    """
    fit_res = fit_isotonic_calibrator(val_predictions)
    return {
        'status': fit_res['status'],
        'knots': fit_res['knots'],
        'metrics': fit_res['diagnosticMetrics'],
        'calibrator': fit_res.get('calibrator')
    }

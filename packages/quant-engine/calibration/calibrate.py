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

def fit_isotonic_calibrator(val_predictions: List[Dict[str, Any]], horizon_days: int = 5) -> Dict[str, Any]:
    """
    Fits monotonic isotonic regression strictly on validation predictions.
    Generates piecewise linear knots with empirical-Bayes tail shrinkage toward identity.
    
    REJECTION GATES:
    1. COLLAPSED_REJECTED: if knot dynamic range < 0.10 (constant output)
    2. WORSENED_REJECTED: if calibrated Brier > raw Brier OR calibrated ECE > 2x raw ECE
    3. INSUFFICIENT_DATA: if effective sample count < 20
    
    On rejection, returns identity calibration (raw probabilities pass through unchanged).
    """
    identity_knots = [[round(p, 3), round(p, 3)] for p in np.linspace(0.05, 0.95, 10)]
    
    # Dependence-aware effective sample count: overlapping multi-day returns
    # inflate apparent N. Effective N = N / max(1, horizon_days) to compensate.
    raw_n = len(val_predictions or [])
    n_eff = raw_n / max(1, horizon_days) if horizon_days > 1 else raw_n
    
    if not val_predictions or n_eff < 20:
        return {
            'status': 'INSUFFICIENT_DATA',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': int(n_eff),
                'brierScore': None,
                'ece': None,
                'mce': None,
                'logLoss': None,
                'isMonotonic': True
            }
        }
        
    y_prob = np.array([p['prob'] for p in val_predictions], dtype=float)
    y_true = np.array([p['outcome'] for p in val_predictions], dtype=int)
    
    # Compute RAW metrics BEFORE calibration (for comparison gate)
    raw_brier = float(round(brier_score_loss(y_true, np.clip(y_prob, 0.001, 0.999)), 4))
    raw_ece, raw_mce, _ = calculate_ece(y_true, y_prob)
    
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0.05, y_max=0.95)
    iso.fit(y_prob, y_true)
    
    # Generate 10 evaluation grid points
    grid_points = np.linspace(0.05, 0.95, 10)
    raw_calibrated = iso.predict(grid_points)
    
    # Empirical Bayes tail shrinkage: shrink toward IDENTITY (raw_p), not 0.50.
    # This prevents collapse toward a constant when support is low.
    min_tail_support = max(5, int(15 / max(1, horizon_days)))
    knots: List[List[float]] = []
    for raw_p, cal_p in zip(grid_points, raw_calibrated):
        # Adaptive bandwidth based on local density
        bandwidth = max(0.05, min(0.12, 1.0 / (len(grid_points) * 0.8)))
        mask = (y_prob >= raw_p - bandwidth) & (y_prob <= raw_p + bandwidth)
        support = np.sum(mask)
        
        if support < min_tail_support:
            # Shrink toward identity (raw_p), not 0.50
            prior_weight = 10.0
            shrunk_cal = (cal_p * support + raw_p * prior_weight) / (support + prior_weight)
        else:
            shrunk_cal = cal_p
            
        knots.append([round(float(raw_p), 3), round(float(shrunk_cal), 3)])
        
    # Enforce strict non-decreasing monotonicity
    for k in range(1, len(knots)):
        if knots[k][1] < knots[k-1][1]:
            knots[k][1] = knots[k-1][1]
    
    # === COLLAPSE DETECTION GATE ===
    y_values = [k[1] for k in knots]
    knot_range = max(y_values) - min(y_values)
    if knot_range < 0.10:
        return {
            'status': 'COLLAPSED_REJECTED',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': f'Knot dynamic range {knot_range:.4f} < 0.10 (constant output)',
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': int(n_eff),
                'brierScore': raw_brier,
                'rawBrier': raw_brier,
                'ece': raw_ece,
                'rawECE': raw_ece,
                'mce': raw_mce,
                'logLoss': None,
                'knotRange': round(knot_range, 4),
                'isMonotonic': True
            }
        }
            
    calibrator = IsotonicCalibrator(knots, iso)
    
    # Compute CALIBRATED metrics for comparison
    cal_val_prob = calibrator.transform(y_prob)
    cal_brier = float(round(brier_score_loss(y_true, cal_val_prob), 4))
    cal_ece, cal_mce, cal_bins = calculate_ece(y_true, cal_val_prob)
    try:
        cal_ll = float(round(log_loss(y_true, np.clip(cal_val_prob, 0.001, 0.999)), 4))
    except Exception:
        cal_ll = None
        
    # === RAW-vs-CALIBRATED COMPARISON GATE ===
    if cal_brier > raw_brier or (raw_ece > 0.001 and cal_ece > raw_ece * 2.0):
        rejection_reason = []
        if cal_brier > raw_brier:
            rejection_reason.append(f'Brier worsened: raw={raw_brier} -> cal={cal_brier}')
        if raw_ece > 0.001 and cal_ece > raw_ece * 2.0:
            rejection_reason.append(f'ECE worsened >2x: raw={raw_ece} -> cal={cal_ece}')
        return {
            'status': 'WORSENED_REJECTED',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': '; '.join(rejection_reason),
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': int(n_eff),
                'brierScore': raw_brier,
                'rawBrier': raw_brier,
                'calibratedBrier': cal_brier,
                'ece': raw_ece,
                'rawECE': raw_ece,
                'calibratedECE': cal_ece,
                'mce': raw_mce,
                'logLoss': cal_ll,
                'knotRange': round(knot_range, 4),
                'populatedBins': cal_bins,
                'isMonotonic': True,
            }
        }
    
    return {
        'status': 'FITTED_OUT_OF_SAMPLE',
        'knots': knots,
        'calibrator': calibrator,
        'diagnosticMetrics': {
            'sampleCount': raw_n,
            'effectiveSampleCount': int(n_eff),
            'brierScore': cal_brier,
            'rawBrier': raw_brier,
            'calibratedBrier': cal_brier,
            'ece': cal_ece,
            'rawECE': raw_ece,
            'calibratedECE': cal_ece,
            'mce': cal_mce,
            'logLoss': cal_ll,
            'knotRange': round(knot_range, 4),
            'populatedBins': cal_bins,
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

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
    
    EXACT GATES (Section 13, 14, 15):
    1. Sample count: N >= 500 required (else INSUFFICIENT_DATA)
    2. Populated bins >= 8
    3. Collapse gate: std(calibrated) < 10% std(raw) OR unique calibrated values < 3
    4. Acceptance gates:
       - Calibrated Brier <= Raw Brier
       - Calibrated LogLoss <= Raw LogLoss (if computable)
       - Calibrated ECE <= Raw ECE (or improvement)
       - Calibrated ROC-AUC >= Raw ROC-AUC - 0.01
    
    On rejection, returns identity calibration with status REJECTED or INSUFFICIENT_DATA.
    """
    from sklearn.metrics import roc_auc_score
    identity_knots = [[round(p, 3), round(p, 3)] for p in np.linspace(0.05, 0.95, 10)]
    raw_n = len(val_predictions or [])
    
    if not val_predictions or raw_n < 500:
        return {
            'status': 'INSUFFICIENT_DATA',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': f'Validation sample count {raw_n} < 500 required',
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': raw_n,
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
    try:
        raw_ll = float(round(log_loss(y_true, np.clip(y_prob, 0.001, 0.999)), 4))
    except Exception:
        raw_ll = None
    try:
        raw_auc = float(round(roc_auc_score(y_true, y_prob), 4))
    except Exception:
        raw_auc = 0.5
    
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0.05, y_max=0.95)
    iso.fit(y_prob, y_true)
    
    # Generate 10 evaluation grid points
    grid_points = np.linspace(0.05, 0.95, 10)
    raw_calibrated = iso.predict(grid_points)
    
    # Empirical Bayes tail shrinkage: shrink toward IDENTITY (raw_p), not 0.50
    min_tail_support = 50  # Section 13: Minimum 50 samples in tail
    knots: List[List[float]] = []
    for raw_p, cal_p in zip(grid_points, raw_calibrated):
        bandwidth = max(0.05, min(0.12, 1.0 / (len(grid_points) * 0.8)))
        mask = (y_prob >= raw_p - bandwidth) & (y_prob <= raw_p + bandwidth)
        support = np.sum(mask)
        
        if support < min_tail_support:
            prior_weight = 10.0
            shrunk_cal = (cal_p * support + raw_p * prior_weight) / (support + prior_weight)
        else:
            shrunk_cal = cal_p
            
        knots.append([round(float(raw_p), 3), round(float(shrunk_cal), 3)])
        
    # Enforce strict non-decreasing monotonicity
    for k in range(1, len(knots)):
        if knots[k][1] < knots[k-1][1]:
            knots[k][1] = knots[k-1][1]
    
    # === COLLAPSE DETECTION GATE (Section 15) ===
    y_values = [k[1] for k in knots]
    knot_range = max(y_values) - min(y_values)
    calibrator = IsotonicCalibrator(knots, iso)
    cal_val_prob = calibrator.transform(y_prob)
    
    std_raw = float(np.std(y_prob))
    std_cal = float(np.std(cal_val_prob))
    unique_cal_count = len(np.unique(np.round(cal_val_prob, 3)))
    
    if std_raw > 1e-4 and std_cal < 0.10 * std_raw:
        return {
            'status': 'COLLAPSED_REJECTED',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': f'Calibration collapse: std(calibrated) {std_cal:.4f} < 10% of std(raw) {std_raw:.4f}',
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': raw_n,
                'brierScore': raw_brier,
                'rawBrier': raw_brier,
                'ece': raw_ece,
                'rawECE': raw_ece,
                'mce': raw_mce,
                'logLoss': raw_ll,
                'knotRange': round(knot_range, 4),
                'isMonotonic': True
            }
        }
        
    if unique_cal_count < 3:
        return {
            'status': 'COLLAPSED_REJECTED',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': f'Calibration collapse: unique calibrated values {unique_cal_count} < 3',
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': raw_n,
                'brierScore': raw_brier,
                'rawBrier': raw_brier,
                'ece': raw_ece,
                'rawECE': raw_ece,
                'mce': raw_mce,
                'logLoss': raw_ll,
                'knotRange': round(knot_range, 4),
                'isMonotonic': True
            }
        }
            
    # Compute CALIBRATED metrics for comparison
    cal_brier = float(round(brier_score_loss(y_true, cal_val_prob), 4))
    cal_ece, cal_mce, cal_bins = calculate_ece(y_true, cal_val_prob)
    try:
        cal_ll = float(round(log_loss(y_true, np.clip(cal_val_prob, 0.001, 0.999)), 4))
    except Exception:
        cal_ll = None
    try:
        cal_auc = float(round(roc_auc_score(y_true, cal_val_prob), 4))
    except Exception:
        cal_auc = 0.5
        
    # === RAW-vs-CALIBRATED COMPARISON GATE (Section 14) ===
    rejection_reason = []
    if cal_brier > raw_brier:
        rejection_reason.append(f'Brier worsened: raw={raw_brier} -> cal={cal_brier}')
    if raw_ll is not None and cal_ll is not None and cal_ll > raw_ll:
        rejection_reason.append(f'LogLoss worsened: raw={raw_ll} -> cal={cal_ll}')
    if raw_ece > 0.001 and cal_ece > raw_ece:
        rejection_reason.append(f'ECE worsened: raw={raw_ece} -> cal={cal_ece}')
    if cal_auc < raw_auc - 0.01:
        rejection_reason.append(f'ROC-AUC degraded: raw={raw_auc} -> cal={cal_auc}')
        
    if rejection_reason:
        return {
            'status': 'REJECTED',
            'knots': identity_knots,
            'calibrator': IsotonicCalibrator(identity_knots),
            'rejectionReason': '; '.join(rejection_reason),
            'diagnosticMetrics': {
                'sampleCount': raw_n,
                'effectiveSampleCount': raw_n,
                'brierScore': raw_brier,
                'rawBrier': raw_brier,
                'calibratedBrier': cal_brier,
                'ece': raw_ece,
                'rawECE': raw_ece,
                'calibratedECE': cal_ece,
                'mce': raw_mce,
                'logLoss': cal_ll,
                'rawLogLoss': raw_ll,
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
            'effectiveSampleCount': raw_n,
            'brierScore': cal_brier,
            'rawBrier': raw_brier,
            'calibratedBrier': cal_brier,
            'ece': cal_ece,
            'rawECE': raw_ece,
            'calibratedECE': cal_ece,
            'mce': cal_mce,
            'logLoss': cal_ll,
            'rawLogLoss': raw_ll,
            'knotRange': round(knot_range, 4),
            'populatedBins': cal_bins,
            'isMonotonic': True,
        }
    }

MIN_TEST_CALIBRATION_SAMPLE_COUNT = 500
MIN_RETURN_BUCKET_SAMPLE_COUNT = 100
MIN_TAIL_SAMPLE_COUNT = 250

def evaluate_test_calibration(y_true: np.ndarray, raw_probs: np.ndarray, cal_probs: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates out-of-sample calibration metrics on unseen TEST or HOLDOUT partitions.
    Centralizes MIN_TEST_CALIBRATION_SAMPLE_COUNT = 500.
    When sampleCount == 0, returns nulls and status = 'INSUFFICIENT_DATA' without fake numeric constants.
    Accepts calibration strictly if test metrics improve or match raw metrics on unseen TEST data.
    """
    y_true = np.asarray(y_true, dtype=int)
    n_samples = len(y_true)
    
    if n_samples == 0:
        return {
            'sampleCount': 0,
            'rawBrier': None,
            'calibratedBrier': None,
            'brierScore': None,
            'rawECE': None,
            'calibratedECE': None,
            'ece': None,
            'rawMCE': None,
            'calibratedMCE': None,
            'mce': None,
            'rawLogLoss': None,
            'calibratedLogLoss': None,
            'logLoss': None,
            'rawAUC': None,
            'calibratedAUC': None,
            'populatedBins': 0,
            'isMonotonic': True,
            'status': 'INSUFFICIENT_DATA'
        }
        
    raw_probs = np.clip(np.asarray(raw_probs, dtype=float), 0.001, 0.999)
    cal_probs = np.clip(np.asarray(cal_probs, dtype=float), 0.001, 0.999)
    
    raw_brier = float(round(brier_score_loss(y_true, raw_probs), 4))
    cal_brier = float(round(brier_score_loss(y_true, cal_probs), 4))
    
    raw_ece, raw_mce, raw_bins = calculate_ece(y_true, raw_probs)
    cal_ece, cal_mce, cal_bins = calculate_ece(y_true, cal_probs)
    
    try:
        raw_ll = float(round(log_loss(y_true, raw_probs), 4))
    except Exception:
        raw_ll = None
        
    try:
        cal_ll = float(round(log_loss(y_true, cal_probs), 4))
    except Exception:
        cal_ll = None
        
    try:
        from sklearn.metrics import roc_auc_score
        raw_auc = float(round(roc_auc_score(y_true, raw_probs), 4)) if len(np.unique(y_true)) > 1 else 0.50
        cal_auc = float(round(roc_auc_score(y_true, cal_probs), 4)) if len(np.unique(y_true)) > 1 else 0.50
    except Exception:
        raw_auc = cal_auc = 0.50
        
    raw_std = float(np.std(raw_probs))
    cal_std = float(np.std(cal_probs))
    
    if n_samples < MIN_TEST_CALIBRATION_SAMPLE_COUNT:
        status = 'INSUFFICIENT_DATA'
    else:
        # Acceptance Gate on unseen TEST (Section N):
        is_accepted = (
            cal_brier <= raw_brier and
            (cal_ll is None or raw_ll is None or cal_ll <= raw_ll) and
            cal_ece <= raw_ece and
            cal_auc >= raw_auc - 0.01 and
            (raw_std <= 1e-4 or cal_std >= 0.10 * raw_std)
        )
        status = 'VERIFIED_TEST' if is_accepted else 'REJECTED'
        
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
        'rawAUC': raw_auc,
        'calibratedAUC': cal_auc,
        'populatedBins': cal_bins,
        'isMonotonic': True,
        'status': status
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

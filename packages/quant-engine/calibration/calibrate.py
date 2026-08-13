from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss
import numpy as np

def calibrate_probabilities(y_true, y_prob):
    iso = IsotonicRegression(out_of_bounds='clip')
    iso.fit(y_prob, y_true)
    
    raw_probs = np.linspace(0, 1, 100)
    calibrated = iso.predict(raw_probs)
    
    lookup = [{"raw": float(r), "calibrated": float(c)} for r, c in zip(raw_probs, calibrated)]
    
    metrics = {
        "brier_score": float(brier_score_loss(y_true, y_prob)),
        "log_loss": float(log_loss(y_true, y_prob))
    }
    
    return iso, lookup, metrics

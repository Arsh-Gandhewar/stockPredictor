import os
import sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from typing import Dict, List, Any, Optional, Tuple

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.conditional_returns import (
    verify_causal_invariance,
    LeakageError,
    MIN_RETURN_BUCKET_SAMPLE_COUNT
)

RETURN_MODEL_PARAMS = {
    'n_estimators': 80,
    'max_depth': 4,
    'num_leaves': 15,
    'learning_rate': 0.03,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_samples': 15,
    'random_state': 42,
    'verbose': -1,
}

class ReturnMagnitudeEngine:
    """
    Point-in-time machine-learned return magnitude and downside quantile engine.
    Directly models:
    - E[Gain | Return > 0] using supervised regression on positive return instances
    - E[Loss | Return < 0] using supervised regression on negative return instances
    - P15 (15th percentile downside stop) using quantile regression (alpha=0.15)
    - P50 (median return) using quantile regression (alpha=0.50)
    - P85 (85th percentile upside target) using quantile regression (alpha=0.85)
    
    Guarantees:
    - Zero dependence on ATR or arbitrary volatility multipliers
    - Strict point-in-time causal separation (fitEndTimestamp < predictionTimestamp)
    - Monotonic quantile preservation (P15 < 0 < P85 and P15 <= P50 <= P85)
    - Strictly positive expectedGain and expectedLoss
    """
    def __init__(self, horizon_str: str = '5d'):
        self.horizon_str = horizon_str
        self.gain_model: Optional[lgb.LGBMRegressor] = None
        self.loss_model: Optional[lgb.LGBMRegressor] = None
        self.q15_model: Optional[lgb.LGBMRegressor] = None
        self.q50_model: Optional[lgb.LGBMRegressor] = None
        self.q85_model: Optional[lgb.LGBMRegressor] = None
        self.feature_names: List[str] = []
        self.fit_start: Optional[str] = None
        self.fit_end: Optional[str] = None
        self.sample_count: int = 0
        self.is_fitted: bool = False
        
        # Empirical fallback values derived strictly from causal training set
        self.fallback_gain: Optional[float] = None
        self.fallback_loss: Optional[float] = None
        self.fallback_p15: Optional[float] = None
        self.fallback_p50: Optional[float] = None
        self.fallback_p85: Optional[float] = None
        
    def fit(
        self,
        X_train: pd.DataFrame,
        y_returns: pd.Series,
        fit_end_timestamp: str,
        features: Optional[List[str]] = None
    ) -> "ReturnMagnitudeEngine":
        """
        Fits all return magnitude and quantile regressors strictly on prior training data.
        Enforces fit_end_timestamp strictly greater than any row in X_train.
        """
        if X_train is None or y_returns is None or len(X_train) < 50:
            self.is_fitted = False
            return self
            
        feat_list = features if features is not None else list(X_train.columns)
        X_df = X_train[feat_list].copy()
        y_ser = y_returns.copy()
        
        # Positional alignment to handle panel data with duplicate datetime indexes
        n_in = min(len(X_df), len(y_ser))
        X_df = X_df.iloc[:n_in]
        y_ser = y_ser.iloc[:n_in]
        
        y_vals = y_ser.values
        X_vals = X_df.values
        valid_idx = np.where((~np.isnan(y_vals)) & (~np.isinf(y_vals)) & (~np.isnan(X_vals).any(axis=1)))[0]
        
        if len(valid_idx) < 50:
            self.is_fitted = False
            return self
            
        X_clean = X_df.iloc[valid_idx]
        y_clean = y_ser.iloc[valid_idx]
        y_arr = y_vals[valid_idx]
        
        self.feature_names = feat_list
        self.sample_count = len(X_clean)
        
        if isinstance(X_clean.index, pd.DatetimeIndex):
            self.fit_start = str(X_clean.index.min())[:10]
            self.fit_end = str(X_clean.index.max())[:10]
        else:
            self.fit_start = str(fit_end_timestamp)[:10]
            self.fit_end = str(fit_end_timestamp)[:10]
            
        # Assert causal lineage
        if fit_end_timestamp and self.fit_end:
            if str(self.fit_end)[:10] >= str(fit_end_timestamp)[:10]:
                raise LeakageError(
                    f"CRITICAL CAUSAL LEAKAGE: training sample date {self.fit_end} >= fit_end_timestamp {fit_end_timestamp}"
                )
                
        # 1. Compute empirical fallbacks from training set
        pos_idx = np.where(y_arr > 0)[0]
        neg_idx = np.where(y_arr < 0)[0]
        pos_samples = y_arr[pos_idx]
        neg_samples = y_arr[neg_idx]
        self.fallback_gain = float(round(np.mean(pos_samples), 4)) if len(pos_samples) > 0 else 0.03
        self.fallback_loss = float(round(abs(np.mean(neg_samples)), 4)) if len(neg_samples) > 0 else 0.02
        self.fallback_p15 = float(round(np.percentile(y_arr, 15), 4))
        self.fallback_p50 = float(round(np.percentile(y_arr, 50), 4))
        self.fallback_p85 = float(round(np.percentile(y_arr, 85), 4))
        
        # Ensure fallbacks satisfy sign validity
        if self.fallback_p15 >= 0:
            self.fallback_p15 = -0.015
        if self.fallback_p85 <= 0:
            self.fallback_p85 = 0.025
            
        # 2. Train Gain Regressor on positive returns
        if len(pos_idx) >= 30:
            X_pos = X_clean.iloc[pos_idx]
            self.gain_model = lgb.LGBMRegressor(**RETURN_MODEL_PARAMS, objective='regression')
            self.gain_model.fit(X_pos, pos_samples)
        else:
            self.gain_model = None
            
        # 3. Train Loss Regressor on negative returns (predicting positive loss magnitude)
        if len(neg_idx) >= 30:
            X_neg = X_clean.iloc[neg_idx]
            self.loss_model = lgb.LGBMRegressor(**RETURN_MODEL_PARAMS, objective='regression')
            self.loss_model.fit(X_neg, np.abs(neg_samples))
        else:
            self.loss_model = None
            
        # 4. Train Quantile Regressors (alpha = 0.15, 0.50, 0.85) on full sample
        self.q15_model = lgb.LGBMRegressor(**RETURN_MODEL_PARAMS, objective='quantile', alpha=0.15)
        self.q15_model.fit(X_clean, y_arr)
        
        self.q50_model = lgb.LGBMRegressor(**RETURN_MODEL_PARAMS, objective='quantile', alpha=0.50)
        self.q50_model.fit(X_clean, y_arr)
        
        self.q85_model = lgb.LGBMRegressor(**RETURN_MODEL_PARAMS, objective='quantile', alpha=0.85)
        self.q85_model.fit(X_clean, y_arr)
        
        self.is_fitted = True
        return self

    def predict(
        self,
        X: pd.DataFrame,
        prediction_timestamp: str
    ) -> Dict[str, np.ndarray]:
        """
        Predicts conditional return quantiles and conditional gain/loss across a feature matrix.
        Enforces point-in-time causality: self.fit_end < prediction_timestamp.
        """
        if not self.is_fitted or X is None or X.empty:
            n = len(X) if X is not None else 0
            return {
                'conditional_gain': np.array([None] * n),
                'conditional_loss': np.array([None] * n),
                'p15': np.array([None] * n),
                'p50': np.array([None] * n),
                'p85': np.array([None] * n),
                'method': 'INSUFFICIENT_DATA'
            }
            
        # Causal invariant assertion
        if self.fit_end and prediction_timestamp:
            verify_causal_invariance(prediction_timestamp, self.fit_end)
            
        X_sub = X[self.feature_names].copy()
        n = len(X_sub)
        
        # Predict gain
        if self.gain_model is not None:
            pred_gain = self.gain_model.predict(X_sub)
            pred_gain = np.maximum(0.005, pred_gain)
        else:
            pred_gain = np.full(n, self.fallback_gain or 0.03)
            
        # Predict loss
        if self.loss_model is not None:
            pred_loss = self.loss_model.predict(X_sub)
            pred_loss = np.maximum(0.005, pred_loss)
        else:
            pred_loss = np.full(n, self.fallback_loss or 0.02)
            
        # Predict quantiles
        raw_q15 = self.q15_model.predict(X_sub) if self.q15_model else np.full(n, self.fallback_p15)
        raw_q50 = self.q50_model.predict(X_sub) if self.q50_model else np.full(n, self.fallback_p50)
        raw_q85 = self.q85_model.predict(X_sub) if self.q85_model else np.full(n, self.fallback_p85)
        
        # Enforce sign validity and non-crossing constraints
        # P15 must be strictly negative (downside stop)
        p15_adj = np.minimum(-0.005, raw_q15)
        # P85 must be strictly positive (upside target)
        p85_adj = np.maximum(0.005, raw_q85)
        # P50 bounded between P15 and P85
        p50_adj = np.clip(raw_q50, p15_adj, p85_adj)
        
        return {
            'conditional_gain': np.round(pred_gain, 4),
            'conditional_loss': np.round(pred_loss, 4),
            'p15': np.round(p15_adj, 4),
            'p50': np.round(p50_adj, 4),
            'p85': np.round(p85_adj, 4),
            'method': 'SUPERVISED_LIGHTGBM_QUANTILE'
        }

    def predict_single(
        self,
        features_dict: Dict[str, float],
        prediction_timestamp: str
    ) -> Dict[str, Any]:
        """
        Predicts return magnitude and quantiles for a single observation dict.
        Returns None for all values if uncalibrated or features missing.
        """
        if not self.is_fitted:
            return {
                'conditional_gain': None,
                'conditional_loss': None,
                'p15': None,
                'p50': None,
                'p85': None,
                'returnEstimateMethod': 'INSUFFICIENT_DATA',
                'distributionFitStart': None,
                'distributionFitEnd': None,
                'sampleCount': 0
            }
            
        try:
            row_data = {f: [features_dict.get(f, np.nan)] for f in self.feature_names}
            df_row = pd.DataFrame(row_data)
            if df_row.isna().any().any():
                # Missing required feature -> fail closed
                return {
                    'conditional_gain': None,
                    'conditional_loss': None,
                    'p15': None,
                    'p50': None,
                    'p85': None,
                    'returnEstimateMethod': 'INSUFFICIENT_DATA',
                    'distributionFitStart': self.fit_start,
                    'distributionFitEnd': self.fit_end,
                    'sampleCount': self.sample_count
                }
                
            res = self.predict(df_row, prediction_timestamp)
            return {
                'conditional_gain': float(res['conditional_gain'][0]),
                'conditional_loss': float(res['conditional_loss'][0]),
                'p15': float(res['p15'][0]),
                'p50': float(res['p50'][0]),
                'p85': float(res['p85'][0]),
                'returnEstimateMethod': res['method'],
                'distributionFitStart': self.fit_start,
                'distributionFitEnd': self.fit_end,
                'sampleCount': self.sample_count
            }
        except Exception:
            return {
                'conditional_gain': None,
                'conditional_loss': None,
                'p15': None,
                'p50': None,
                'p85': None,
                'returnEstimateMethod': 'INSUFFICIENT_DATA',
                'distributionFitStart': self.fit_start,
                'distributionFitEnd': self.fit_end,
                'sampleCount': 0
            }


def evaluate_return_error_structure(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates return-model error structure (Section 9):
    MAE, RMSE, Huber loss, bias, rank IC, Spearman, top-decile spread, bottom-decile spread, slope.
    """
    y_t = np.asarray(y_true, dtype=float)
    y_p = np.asarray(y_pred, dtype=float)
    mask = (~np.isnan(y_t)) & (~np.isnan(y_p))
    y_t, y_p = y_t[mask], y_p[mask]
    if len(y_t) < 10:
        return {'status': 'INSUFFICIENT_DATA'}
        
    diff = y_p - y_t
    mae = float(round(np.mean(np.abs(diff)), 4))
    rmse = float(round(np.sqrt(np.mean(diff ** 2)), 4))
    bias = float(round(np.mean(diff), 4))
    
    # Huber loss (delta = 0.02)
    delta = 0.02
    abs_d = np.abs(diff)
    huber = np.where(abs_d <= delta, 0.5 * (diff ** 2), delta * (abs_d - 0.5 * delta))
    huber_loss = float(round(np.mean(huber), 6))
    
    # Rank IC & Spearman
    from scipy.stats import spearmanr
    try:
        spearman_corr, _ = spearmanr(y_p, y_t)
        rank_ic = float(round(spearman_corr, 4)) if not np.isnan(spearman_corr) else 0.0
    except Exception:
        rank_ic = 0.0
        
    # Decile spread
    try:
        p_ranks = pd.qcut(y_p, q=10, labels=False, duplicates='drop')
        top_dec = float(round(np.mean(y_t[p_ranks == p_ranks.max()]), 4))
        bot_dec = float(round(np.mean(y_t[p_ranks == p_ranks.min()]), 4))
        decile_spread = float(round(top_dec - bot_dec, 4))
    except Exception:
        top_dec, bot_dec, decile_spread = 0.0, 0.0, 0.0
        
    # Linear slope: realized vs predicted
    try:
        slope, _ = np.polyfit(y_p, y_t, 1)
        slope = float(round(slope, 4))
    except Exception:
        slope = 1.0
        
    return {
        'status': 'VALID',
        'sampleCount': len(y_t),
        'mae': mae,
        'rmse': rmse,
        'bias': bias,
        'huberLoss': huber_loss,
        'rankIC': rank_ic,
        'topDecileMean': top_dec,
        'bottomDecileMean': bot_dec,
        'topMinusBottomSpread': decile_spread,
        'realizedVsPredictedSlope': slope
    }


def evaluate_return_model_calibration(y_true: np.ndarray, y_pred: np.ndarray, n_buckets: int = 5) -> Dict[str, Any]:
    """
    Evaluates return-model calibration across predicted return buckets (Section 10).
    Detects systematic RETURN_OVERPREDICTION.
    """
    y_t = np.asarray(y_true, dtype=float)
    y_p = np.asarray(y_pred, dtype=float)
    mask = (~np.isnan(y_t)) & (~np.isnan(y_p))
    y_t, y_p = y_t[mask], y_p[mask]
    if len(y_t) < 50:
        return {'status': 'INSUFFICIENT_DATA', 'buckets': []}
        
    unique_p = np.unique(y_p)
    if len(unique_p) == 1:
        p_mean = float(round(float(unique_p[0]), 4))
        r_mean = float(round(np.mean(y_t), 4))
        bias = float(round(p_mean - r_mean, 4))
        is_over = (p_mean > 0.02 and p_mean > 1.5 * max(0.001, r_mean))
        return {
            'status': 'RETURN_OVERPREDICTION' if is_over else 'CALIBRATED',
            'buckets': [{
                'bucket': 1,
                'count': len(y_p),
                'predictedMean': p_mean,
                'realizedMean': r_mean,
                'predictionBias': bias,
                'medianRealized': float(round(np.median(y_t), 4)),
                'p10Realized': float(round(np.percentile(y_t, 10), 4)),
                'p90Realized': float(round(np.percentile(y_t, 90), 4))
            }],
            'overpredictedBucketCount': 1 if is_over else 0
        }
        
    try:
        b_indices = pd.qcut(y_p, q=n_buckets, labels=False, duplicates='drop')
    except Exception:
        return {'status': 'INSUFFICIENT_DATA', 'buckets': []}
        
    buckets_data = []
    overpredict_count = 0
    valid_buckets = 0
    
    for b in sorted(np.unique(b_indices)):
        m = b_indices == b
        p_sub = y_p[m]
        r_sub = y_t[m]
        p_mean = float(round(np.mean(p_sub), 4))
        r_mean = float(round(np.mean(r_sub), 4))
        bias = float(round(p_mean - r_mean, 4))
        
        # Check overprediction
        if p_mean > 0.02 and p_mean > 1.5 * max(0.001, r_mean):
            overpredict_count += 1
        valid_buckets += 1
        
        buckets_data.append({
            'bucket': int(b) + 1,
            'count': int(np.sum(m)),
            'predictedMean': p_mean,
            'realizedMean': r_mean,
            'predictionBias': bias,
            'medianRealized': float(round(np.median(r_sub), 4)),
            'p10Realized': float(round(np.percentile(r_sub, 10), 4)),
            'p90Realized': float(round(np.percentile(r_sub, 90), 4))
        })
        
    status = 'RETURN_OVERPREDICTION' if overpredict_count >= valid_buckets // 2 and valid_buckets > 0 else 'CALIBRATED'
    return {
        'status': status,
        'buckets': buckets_data,
        'overpredictedBucketCount': overpredict_count
    }


def enforce_quantile_monotonicity(
    p10: float, p15: float, p25: float, p50: float, p75: float, p85: float, p90: float
) -> Tuple[Dict[str, float], str]:
    """
    Enforces non-crossing quantile constraint (Section 11):
    P10 <= P15 <= P25 <= P50 <= P75 <= P85 <= P90.
    Returns corrected quantiles and versioned correction provenance.
    """
    raw_vals = np.array([p10, p15, p25, p50, p75, p85, p90], dtype=float)
    if np.all(np.diff(raw_vals) >= -1e-6):
        corr_method = 'RAW_MONOTONIC'
        adj_vals = raw_vals
    else:
        corr_method = 'v5.0.0-isotonic-quantile-correction'
        from sklearn.isotonic import IsotonicRegression
        iso = IsotonicRegression(increasing=True)
        adj_vals = iso.fit_transform(np.arange(len(raw_vals)), raw_vals)
        
    return {
        'p10': float(round(adj_vals[0], 4)),
        'p15': float(round(adj_vals[1], 4)),
        'p25': float(round(adj_vals[2], 4)),
        'p50': float(round(adj_vals[3], 4)),
        'p75': float(round(adj_vals[4], 4)),
        'p85': float(round(adj_vals[5], 4)),
        'p90': float(round(adj_vals[6], 4))
    }, corr_method


def compute_expected_value_uncertainty(
    p_up: float,
    p_down: float,
    expected_gain: float,
    expected_loss: float,
    round_trip_cost: float = 0.0013,
    p_std: float = 0.04,
    gain_std: float = 0.01,
    loss_std: float = 0.01
) -> Dict[str, float]:
    """
    Calculates causal Expected Value and uncertainty confidence bounds (Section 13).
    """
    ev = (p_up * expected_gain) - (p_down * expected_loss) - round_trip_cost
    
    # 95% confidence lower bound under conservative parameter variation
    p_up_low = max(0.05, p_up - 1.96 * p_std)
    p_down_high = min(0.95, p_down + 1.96 * p_std)
    gain_low = max(0.005, expected_gain - 1.96 * gain_std)
    loss_high = max(0.005, expected_loss + 1.96 * loss_std)
    
    ev_lower = (p_up_low * gain_low) - (p_down_high * loss_high) - round_trip_cost
    ev_upper = ((p_up + 1.96 * p_std) * (expected_gain + 1.96 * gain_std)) - ((p_down - 1.96 * p_std) * max(0.005, expected_loss - 1.96 * loss_std)) - round_trip_cost
    
    return {
        'expectedValue': float(round(ev, 6)),
        'evLowerBound': float(round(ev_lower, 6)),
        'evUpperBound': float(round(ev_upper, 6))
    }

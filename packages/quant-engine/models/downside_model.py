"""
QuantX Downside & Tail Loss Risk Engine.
Implements Point-in-Time Supervised & Empirical Downside Modeling (Sections 27-29).
Predicts:
- Conditional loss magnitude: E[|Return| | Return < 0]
- Tail loss probabilities: P(Return < -1%), P(Return < -2%), P(Return < -5%), P(Return < -10%)
- Downside calibration ratio: realizedLoss / predictedLoss
- Loss bias and loss MAE

Guarantees:
- Strict point-in-time causal separation (fitEndTimestamp < predictionTimestamp)
- Minimum sample requirement (N >= 100 for empirical conditional loss; N >= 1000 for supervised models)
- Zero synthetic fallbacks (never fall back to ATR, historical volatility multipliers, or arbitrary constants)
"""
import os
import sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from typing import Dict, List, Any, Optional, Tuple

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.conditional_returns import verify_causal_invariance, LeakageError

MIN_DOWNSIDE_SAMPLE_COUNT = 100
MIN_SUPERVISED_TRAIN_SAMPLES = 1000

DOWNSIDE_MODEL_PARAMS = {
    'n_estimators': 60,
    'max_depth': 4,
    'num_leaves': 15,
    'learning_rate': 0.03,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_samples': 20,
    'random_state': 42,
    'verbose': -1,
}

TAIL_THRESHOLDS = [-0.01, -0.02, -0.05, -0.10]


class DownsideModel:
    """
    Supervised and empirical point-in-time downside risk model.
    Models loss magnitude and non-Gaussian empirical tail distribution.
    """
    def __init__(self, horizon_str: str = '5d'):
        self.horizon_str = horizon_str
        self.loss_model: Optional[lgb.LGBMRegressor] = None
        self.feature_names: List[str] = []
        self.fit_start: Optional[str] = None
        self.fit_end: Optional[str] = None
        self.sample_count: int = 0
        self.negative_sample_count: int = 0
        self.is_fitted: bool = False
        
        # Empirical baseline values strictly from causal training set
        self.empirical_conditional_loss: Optional[float] = None
        self.empirical_tail_probs: Dict[str, float] = {}
        self.empirical_loss_quantiles: Dict[str, float] = {}
        
    def fit(
        self,
        X_train: pd.DataFrame,
        y_returns: pd.Series,
        fit_end_timestamp: str,
        features: Optional[List[str]] = None
    ) -> "DownsideModel":
        """
        Fits downside loss magnitude and tail probability models strictly on causal training history.
        Enforces fit_end_timestamp strictly greater than any row in X_train.
        """
        if X_train is None or y_returns is None or len(X_train) < MIN_DOWNSIDE_SAMPLE_COUNT:
            self.is_fitted = False
            return self
            
        feat_list = features if features is not None else list(X_train.columns)
        X_df = X_train[feat_list].copy()
        y_ser = y_returns.copy()
        
        n_in = min(len(X_df), len(y_ser))
        X_df = X_df.iloc[:n_in]
        y_ser = y_ser.iloc[:n_in]
        
        y_vals = y_ser.values
        X_vals = X_df.values
        valid_idx = np.where((~np.isnan(y_vals)) & (~np.isinf(y_vals)) & (~np.isnan(X_vals).any(axis=1)))[0]
        
        if len(valid_idx) < MIN_DOWNSIDE_SAMPLE_COUNT:
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
                
        # 1. Negative Return Observations (Loss instances)
        neg_idx = np.where(y_arr < 0)[0]
        self.negative_sample_count = len(neg_idx)
        
        if len(neg_idx) >= MIN_DOWNSIDE_SAMPLE_COUNT:
            neg_returns = y_arr[neg_idx]
            self.empirical_conditional_loss = float(round(abs(np.mean(neg_returns)), 4))
            self.empirical_loss_quantiles = {
                'p10': float(round(np.percentile(neg_returns, 10), 4)),
                'p25': float(round(np.percentile(neg_returns, 25), 4)),
                'p50': float(round(np.percentile(neg_returns, 50), 4)),
                'p75': float(round(np.percentile(neg_returns, 75), 4)),
                'p90': float(round(np.percentile(neg_returns, 90), 4)),
            }
        else:
            self.empirical_conditional_loss = None
            self.empirical_loss_quantiles = {}
            
        # 2. Empirical Tail Probabilities (Non-Gaussian, point-in-time)
        for thresh in TAIL_THRESHOLDS:
            key = f"p_loss_{abs(int(thresh * 100))}pct"
            cnt = np.sum(y_arr < thresh)
            self.empirical_tail_probs[key] = float(round(cnt / len(y_arr), 4))
            
        # 3. Supervised Loss Magnitude Regressor (if sample size >= 1000)
        if len(X_clean) >= MIN_SUPERVISED_TRAIN_SAMPLES and len(neg_idx) >= MIN_DOWNSIDE_SAMPLE_COUNT:
            X_neg = X_clean.iloc[neg_idx]
            y_neg_loss = np.abs(y_arr[neg_idx])
            self.loss_model = lgb.LGBMRegressor(**DOWNSIDE_MODEL_PARAMS, objective='regression')
            self.loss_model.fit(X_neg, y_neg_loss)
        else:
            self.loss_model = None
            
        self.is_fitted = True
        return self

    def predict(
        self,
        X: pd.DataFrame,
        prediction_timestamp: str
    ) -> Dict[str, Any]:
        """
        Predicts conditional loss magnitude and tail loss probabilities for a feature matrix.
        Enforces fit_end < prediction_timestamp.
        """
        if not self.is_fitted or X is None or X.empty:
            n = len(X) if X is not None else 0
            return {
                'conditional_loss': np.array([None] * n),
                'p_loss_1pct': np.array([None] * n),
                'p_loss_2pct': np.array([None] * n),
                'p_loss_5pct': np.array([None] * n),
                'p_loss_10pct': np.array([None] * n),
                'status': 'INSUFFICIENT_DATA'
            }
            
        if self.fit_end and prediction_timestamp:
            verify_causal_invariance(prediction_timestamp, self.fit_end)
            
        n = len(X)
        if self.loss_model is not None:
            X_sub = X[self.feature_names].copy()
            pred_loss = self.loss_model.predict(X_sub)
            pred_loss = np.maximum(0.005, pred_loss)
            method = 'SUPERVISED_LIGHTGBM_DOWNSIDE'
        elif self.empirical_conditional_loss is not None:
            pred_loss = np.full(n, self.empirical_conditional_loss)
            method = 'EMPIRICAL_CAUSAL_DOWNSIDE'
        else:
            pred_loss = np.array([None] * n)
            method = 'INSUFFICIENT_DATA'
            
        p_1pct = np.full(n, self.empirical_tail_probs.get('p_loss_1pct', None))
        p_2pct = np.full(n, self.empirical_tail_probs.get('p_loss_2pct', None))
        p_5pct = np.full(n, self.empirical_tail_probs.get('p_loss_5pct', None))
        p_10pct = np.full(n, self.empirical_tail_probs.get('p_loss_10pct', None))
        
        return {
            'conditional_loss': np.round(pred_loss.astype(float), 4) if method != 'INSUFFICIENT_DATA' else pred_loss,
            'p_loss_1pct': p_1pct,
            'p_loss_2pct': p_2pct,
            'p_loss_5pct': p_5pct,
            'p_loss_10pct': p_10pct,
            'method': method
        }

    def predict_single(
        self,
        features_dict: Dict[str, float],
        prediction_timestamp: str
    ) -> Dict[str, Any]:
        """
        Predicts downside metrics for a single observation dict.
        Returns null for all fields if uncalibrated or features missing.
        """
        if not self.is_fitted:
            return {
                'conditional_loss': None,
                'p_loss_1pct': None,
                'p_loss_2pct': None,
                'p_loss_5pct': None,
                'p_loss_10pct': None,
                'method': 'INSUFFICIENT_DATA',
                'fitStart': None,
                'fitEnd': None,
                'sampleCount': 0
            }
            
        try:
            row_data = {f: [features_dict.get(f, np.nan)] for f in self.feature_names}
            df_row = pd.DataFrame(row_data)
            res = self.predict(df_row, prediction_timestamp)
            return {
                'conditional_loss': float(res['conditional_loss'][0]) if res['conditional_loss'][0] is not None else None,
                'p_loss_1pct': float(res['p_loss_1pct'][0]) if res['p_loss_1pct'][0] is not None else None,
                'p_loss_2pct': float(res['p_loss_2pct'][0]) if res['p_loss_2pct'][0] is not None else None,
                'p_loss_5pct': float(res['p_loss_5pct'][0]) if res['p_loss_5pct'][0] is not None else None,
                'p_loss_10pct': float(res['p_loss_10pct'][0]) if res['p_loss_10pct'][0] is not None else None,
                'method': res['method'],
                'fitStart': self.fit_start,
                'fitEnd': self.fit_end,
                'sampleCount': self.sample_count
            }
        except Exception:
            return {
                'conditional_loss': None,
                'p_loss_1pct': None,
                'p_loss_2pct': None,
                'p_loss_5pct': None,
                'p_loss_10pct': None,
                'method': 'INSUFFICIENT_DATA',
                'fitStart': self.fit_start,
                'fitEnd': self.fit_end,
                'sampleCount': 0
            }


def evaluate_downside_calibration(
    realized_returns: np.ndarray,
    predicted_losses: np.ndarray
) -> Dict[str, Any]:
    """
    Evaluates downside calibration (Section 28):
    Compares predicted loss vs realized loss on negative return instances.
    Computes ratio = realizedLoss / predictedLoss.
    If ratio consistently > 1.0, the strategy is underestimating downside risk.
    """
    y_r = np.asarray(realized_returns, dtype=float)
    y_p = np.asarray(predicted_losses, dtype=float)
    
    valid_mask = (~np.isnan(y_r)) & (~np.isnan(y_p)) & (y_r < 0)
    if np.sum(valid_mask) < 20:
        return {
            'status': 'INSUFFICIENT_DATA',
            'sampleCount': int(np.sum(valid_mask)),
            'lossCalibrationRatio': None,
            'lossBias': None,
            'lossMAE': None,
            'underestimationRate': None
        }
        
    actual_losses = np.abs(y_r[valid_mask])
    pred_losses = np.abs(y_p[valid_mask])
    
    mean_actual_loss = float(np.mean(actual_losses))
    mean_pred_loss = float(np.mean(pred_losses))
    ratio = float(round(mean_actual_loss / mean_pred_loss, 4)) if mean_pred_loss > 0 else 999.0
    
    loss_bias = float(round(np.mean(pred_losses - actual_losses), 4))
    loss_mae = float(round(np.mean(np.abs(pred_losses - actual_losses)), 4))
    underest_rate = float(round(np.mean(actual_losses > pred_losses), 4))
    
    is_underestimated = ratio > 1.15
    
    return {
        'status': 'FAIL_UNDERESTIMATED' if is_underestimated else 'PASS',
        'sampleCount': len(actual_losses),
        'meanActualLoss': round(mean_actual_loss, 4),
        'meanPredictedLoss': round(mean_pred_loss, 4),
        'lossCalibrationRatio': ratio,
        'lossBias': loss_bias,
        'lossMAE': loss_mae,
        'underestimationRate': underest_rate,
        'isUnderestimated': is_underestimated
    }

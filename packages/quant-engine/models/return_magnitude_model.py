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

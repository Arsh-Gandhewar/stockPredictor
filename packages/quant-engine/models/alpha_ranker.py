"""
Cross-Sectional Alpha Ranker Engine for QuantX.
================================================
Implements LambdaMART pairwise ranking and Huber magnitude regression:
- Groups observations into daily cross-sectional query groups G_t.
- Trains LightGBM Ranker with NDCG@3 focus directly optimizing Top-3 selection.
- Trains secondary Huber regressor to estimate expected excess return magnitude.
- Generates authenticated out-of-sample prediction ledgers across walk-forward folds.
"""

import os
import sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from typing import Dict, List, Any, Optional, Tuple

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from targets.target_definition import compute_targets, assign_cross_sectional_relevance_grades
from models.train_model import generate_walk_forward_folds


class CrossSectionalAlphaRanker:
    """
    Dual-Engine Cross-Sectional Alpha Model:
    1. LambdaMART Ranker for relative permutation accuracy (NDCG@3).
    2. Huber Regressor for calibrated expected excess return magnitude.
    """
    def __init__(self, horizon_str: str = '5d'):
        self.horizon_str = horizon_str
        self.h_days = 5 if horizon_str == '5d' else (20 if horizon_str == '20d' else 1)
        self.ranker: Optional[lgb.LGBMRanker] = None
        self.magnitude_model: Optional[lgb.LGBMRegressor] = None
        self.is_fitted = False

    def fit(
        self,
        train_df: pd.DataFrame,
        features: List[str],
        tune_df: Optional[pd.DataFrame] = None
    ) -> 'CrossSectionalAlphaRanker':
        """
        Fits LambdaMART ranker and Huber magnitude model on train_df grouped by date.
        """
        h = self.h_days
        grade_col = f'target_rank_grade_{self.horizon_str}'
        excess_col = f'target_vol_std_excess_{self.horizon_str}'
        
        req_cols = features + [grade_col, excess_col]
        clean_train = train_df.dropna(subset=req_cols).copy()
        clean_train.sort_index(inplace=True)
        
        if 'date_group' not in clean_train.columns:
            if 'predictionTimestamp' in clean_train.columns:
                clean_train['date_group'] = pd.to_datetime(clean_train['predictionTimestamp']).dt.strftime('%Y-%m-%d')
            else:
                clean_train['date_group'] = clean_train.index.strftime('%Y-%m-%d')
                
        # Group sizes for LightGBM ranking
        group_counts = clean_train.groupby('date_group', sort=False).size().values
        
        X_train = clean_train[features]
        y_grade = clean_train[grade_col].astype(int)
        y_excess = clean_train[excess_col]
        
        # 1. Fit LambdaMART Ranker
        ranker_params = {
            'objective': 'lambdarank',
            'boosting_type': 'gbdt',
            'n_estimators': 80 if self.horizon_str == '5d' else 70,
            'learning_rate': 0.03,
            'num_leaves': 15,
            'max_depth': 4,
            'eval_at': [1, 3, 5],
            'label_gain': [0, 1, 3, 7, 15],
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_samples': 15,
            'random_state': 42,
            'verbose': -1
        }
        self.ranker = lgb.LGBMRanker(**ranker_params)
        self.ranker.fit(X_train, y_grade, group=group_counts)
        
        # 2. Fit Huber Magnitude Regressor
        huber_params = {
            'objective': 'huber',
            'alpha': 0.9,
            'boosting_type': 'gbdt',
            'n_estimators': 60,
            'learning_rate': 0.025,
            'num_leaves': 12,
            'max_depth': 3,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_samples': 20,
            'random_state': 42,
            'verbose': -1
        }
        self.magnitude_model = lgb.LGBMRegressor(**huber_params)
        self.magnitude_model.fit(X_train, y_excess)
        
        self.is_fitted = True
        return self

    def predict(self, test_df: pd.DataFrame, features: List[str]) -> pd.DataFrame:
        """
        Outputs continuous ranking scores, expected excess returns, and calibrated AlphaScores.
        """
        if not self.is_fitted:
            raise RuntimeError("AlphaRanker must be fitted before predict.")
            
        df = test_df.copy()
        X = df[features]
        
        raw_rank_score = self.ranker.predict(X)
        pred_std_excess = self.magnitude_model.predict(X)
        
        df['rank_score'] = raw_rank_score
        df['pred_std_excess'] = pred_std_excess
        
        # De-standardize expected excess return: std_excess * (daily_vol * sqrt(h))
        daily_vol = df['atr_percent'] if 'atr_percent' in df.columns else df['vol_20d'] / np.sqrt(252)
        h_vol = daily_vol * np.sqrt(self.h_days)
        h_vol = h_vol.clip(lower=0.005)
        
        df['expectedExcessReturn'] = pred_std_excess * h_vol
        df['expectedReturn'] = df['expectedExcessReturn']  # Excess is primary alpha return
        
        # Synthetic calibrated prob: logistic mapping of standardized excess
        df['calibratedProbability'] = 1.0 / (1.0 + np.exp(-1.5 * pred_std_excess))
        df['pred_prob'] = df['calibratedProbability']
        
        # Opportunity score incorporates rank score + excess margin over friction
        margin = (df['expectedExcessReturn'] - 0.0026).clip(lower=0.0)
        risk = h_vol.clip(lower=0.005)
        df['netEV'] = df['expectedExcessReturn'] - 0.0013
        df['expectedRisk'] = risk
        df['grossEV'] = df['expectedExcessReturn']
        df['opportunityScore'] = raw_rank_score + 10.0 * (margin / risk)
        
        return df


def train_walk_forward_alpha_ranker(
    panel_df: pd.DataFrame,
    features: List[str],
    horizon_str: str = '5d',
    n_folds: int = 4
) -> Dict[str, Any]:
    """
    Executes walk-forward evaluation using the CrossSectionalAlphaRanker.
    """
    h_days = 5 if horizon_str == '5d' else (20 if horizon_str == '20d' else 1)
    dynamic_purge_days = max(20, int(h_days * 1.5) + 5)
    
    # Assign cross-sectional relevance grades across all trading days
    df_graded = assign_cross_sectional_relevance_grades(panel_df, horizons=[h_days])
    
    dates = df_graded.index if isinstance(df_graded.index, pd.DatetimeIndex) else pd.to_datetime(df_graded['predictionTimestamp'])
    folds_config, holdout_bounds = generate_walk_forward_folds(dates, n_folds=n_folds, purge_days=dynamic_purge_days)
    
    oos_records = []
    
    for fold in folds_config:
        train_mask = (df_graded.index >= fold['train_start']) & (df_graded.index < fold['train_end'])
        tune_mask = (df_graded.index >= fold['tune_start']) & (df_graded.index < fold['tune_end'])
        test_mask = (df_graded.index >= fold['test_start']) & (df_graded.index < fold['test_end'])
        
        train_df = df_graded[train_mask]
        tune_df = df_graded[tune_mask]
        test_df = df_graded[test_mask]
        
        if len(train_df) < 100 or len(test_df) < 20:
            continue
            
        ranker_engine = CrossSectionalAlphaRanker(horizon_str=horizon_str)
        ranker_engine.fit(train_df, features=features, tune_df=tune_df)
        
        pred_test = ranker_engine.predict(test_df, features=features)
        pred_test['foldId'] = fold['fold']
        oos_records.append(pred_test)
        
    oos_df = pd.concat(oos_records, axis=0) if oos_records else pd.DataFrame()
    if not oos_df.empty:
        oos_df.sort_index(inplace=True)
        
    # Fit final production ranker on full pre-holdout data
    final_calib_end = holdout_bounds['start'] - pd.Timedelta(days=dynamic_purge_days)
    prod_train_mask = (df_graded.index >= dates.min()) & (df_graded.index < final_calib_end)
    prod_train_df = df_graded[prod_train_mask]
    
    prod_ranker = CrossSectionalAlphaRanker(horizon_str=horizon_str)
    prod_ranker.fit(prod_train_df, features=features)
    
    return {
        'horizon': horizon_str,
        'prod_ranker': prod_ranker,
        'oos_predictions_df': oos_df,
        'holdout_bounds': holdout_bounds
    }

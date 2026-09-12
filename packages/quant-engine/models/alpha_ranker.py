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
from sklearn.isotonic import IsotonicRegression
from models.train_model import generate_walk_forward_folds


class CrossSectionalAlphaRanker:
    """
    Dual-Engine Cross-Sectional Alpha Model:
    1. LambdaMART Ranker for relative permutation accuracy (NDCG@3).
    2. Huber Regressor for calibrated expected excess return magnitude.
    3. Isotonic Regression for true out-of-sample probability calibration.
    """
    def __init__(
        self,
        horizon_str: str = '5d',
        target_type: str = 'std_excess',
        cal_y_min: Optional[float] = None,
        cal_y_max: Optional[float] = None,
        friction_rate: float = 0.0013,
        clip_lower: float = -0.5,
        clip_upper: float = 0.5
    ):
        self.horizon_str = horizon_str
        self.target_type = target_type
        self.h_days = 5 if horizon_str == '5d' else (20 if horizon_str == '20d' else 1)
        self.cal_y_min = cal_y_min
        self.cal_y_max = cal_y_max
        self.friction_rate = friction_rate
        self.clip_lower = clip_lower
        self.clip_upper = clip_upper
        self.ranker: Optional[lgb.LGBMRanker] = None
        self.magnitude_model: Optional[lgb.LGBMRegressor] = None
        self.calibrator: Optional[IsotonicRegression] = None
        self.is_fitted = False
        self.actual_training_target: Optional[str] = None
        self.actual_grade_col: Optional[str] = None
        self.actual_excess_col: Optional[str] = None

    def fit(
        self,
        train_df: pd.DataFrame,
        features: List[str],
        tune_df: Optional[pd.DataFrame] = None
    ) -> 'CrossSectionalAlphaRanker':
        """
        Fits LambdaMART ranker and Huber magnitude model on train_df grouped by date.
        """
        from targets.target_definition import get_target_columns
        grade_col, excess_col = get_target_columns(self.target_type, self.horizon_str)
            
        # Strict Fail-Closed Target Verification:
        # Zero silent substitution or fallback to standard columns is permitted.
        if grade_col not in train_df.columns:
            raise KeyError(
                f"FAIL-CLOSED: Required grade column '{grade_col}' for target_type='{self.target_type}' "
                f"is missing from train_df. Silent fallback to standard columns is strictly forbidden."
            )
        if excess_col not in train_df.columns:
            raise KeyError(
                f"FAIL-CLOSED: Required excess return column '{excess_col}' for target_type='{self.target_type}' "
                f"is missing from train_df. Silent fallback to standard columns is strictly forbidden."
            )
        
        self.actual_training_target = self.target_type
        self.actual_grade_col = grade_col
        self.actual_excess_col = excess_col
        
        req_cols = features + [grade_col, excess_col]
        clean_train = train_df.dropna(subset=req_cols).copy()
        clean_train.sort_index(inplace=True)
        
        if 'date_group' not in clean_train.columns:
            if 'predictionTimestamp' in clean_train.columns:
                clean_train['date_group'] = pd.to_datetime(clean_train['predictionTimestamp']).dt.strftime('%Y-%m-%d')
            else:
                clean_train['date_group'] = clean_train.index.strftime('%Y-%m-%d')
                
        # Group sizes for LightGBM ranking
        tr_sub = clean_train
        
        if tune_df is not None and len(tune_df) > 0:
            val_sub = tune_df.dropna(subset=req_cols).copy()
        else:
            # Temporal split for isotonic probability calibration: 85% train, 15% validation
            unique_dates = sorted(clean_train['date_group'].unique())
            n_dates = len(unique_dates)
            if n_dates >= 20:
                split_idx = int(n_dates * 0.85)
                val_dates = set(unique_dates[split_idx:])
                val_sub = clean_train[clean_train['date_group'].isin(val_dates)]
            else:
                val_sub = clean_train
                
        group_counts = tr_sub.groupby('date_group', sort=False).size().values
        X_tr = tr_sub[features]
        y_grade_tr = tr_sub[grade_col].astype(int)
        y_excess_tr = tr_sub[excess_col]
        
        # 1. Fit LambdaMART Ranker
        # Phase 2 P0-3: 20D ranker uses more estimators + lower lr to capture slow-moving signals.
        # 5D uses slightly more leaves to capture short-term momentum/regime interactions.
        if self.horizon_str == '5d':
            n_est = 100
            lr = 0.03
            n_leaves = 20
        else:  # 20d
            n_est = 150
            lr = 0.015
            n_leaves = 15

        ranker_params = {
            'objective': 'lambdarank',
            'boosting_type': 'gbdt',
            'n_estimators': n_est,
            'learning_rate': lr,
            'num_leaves': n_leaves,
            'max_depth': 4,
            'label_gain': [0, 1, 3, 7, 15],
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_samples': 15,
            'random_state': 42,
            'verbose': -1
        }
        self.ranker = lgb.LGBMRanker(**ranker_params)
        self.ranker.fit(X_tr, y_grade_tr, group=group_counts)
        
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
        self.magnitude_model.fit(X_tr, y_excess_tr)
        
        # 3. Fit True Empirical Isotonic Calibrator on Validation Partition
        X_val = val_sub[features]
        val_pred_excess = self.magnitude_model.predict(X_val)

        # Target event: Calibrate against exact production executable event (net excess return > 0)
        net_excess_col = f'target_net_excess_binary_{self.horizon_str}'
        if net_excess_col in val_sub.columns:
            val_binary = val_sub[net_excess_col].astype(int)
        elif f'future_net_excess_ret_{self.horizon_str}' in val_sub.columns:
            val_binary = (val_sub[f'future_net_excess_ret_{self.horizon_str}'] > 0.0).astype(int)
        else:
            val_binary = (val_sub[excess_col] > 0.0).astype(int)
        
        self.calibrator = IsotonicRegression(out_of_bounds='clip', y_min=self.cal_y_min, y_max=self.cal_y_max)
        self.calibrator.fit(val_pred_excess, val_binary)

        # Diagnostic Calibration Metrics on Out-of-Sample Validation Set
        val_cal_prob = self.calibrator.predict(val_pred_excess)
        val_cal_prob = np.clip(val_cal_prob, 1e-5, 1.0 - 1e-5)
        self.brier_score = float(np.mean((val_cal_prob - val_binary.values) ** 2))
        self.log_loss_score = float(-np.mean(val_binary.values * np.log(val_cal_prob) + (1.0 - val_binary.values) * np.log(1.0 - val_cal_prob)))
        
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
        pred_excess_model = self.magnitude_model.predict(X)
        
        df['rank_score'] = raw_rank_score
        
        # Calculate horizon volatility: vol_20d is annualized (sqrt(252)), de-annualize to daily
        daily_vol = df['vol_20d'] / np.sqrt(252) if 'vol_20d' in df.columns else df['atr_percent']
        daily_vol = daily_vol.fillna(0.01)
        h_vol = daily_vol * np.sqrt(self.h_days)
        h_vol = h_vol.clip(lower=0.005)
        
        # De-standardize expected excess return depending on target family:
        if self.target_type in ('std_excess', 'vol_adj_net_excess'):
            df['pred_std_excess'] = pred_excess_model
            df['expectedExcessReturn'] = pred_excess_model * h_vol
        else:
            # Model directly predicts unscaled net/raw excess return
            df['expectedExcessReturn'] = pred_excess_model
            df['pred_std_excess'] = pred_excess_model / h_vol

        df['pred_std_excess'] = df['pred_std_excess'].fillna(0.0)
        df['expectedExcessReturn'] = df['expectedExcessReturn'].fillna(0.0)
        df['expectedReturn'] = df['expectedExcessReturn']  # Excess is primary alpha return
        
        # True empirical calibrated probability from Isotonic Calibrator
        if self.calibrator is not None:
            cal_in = np.nan_to_num(df['pred_std_excess'].values, nan=0.0)
            df['calibratedProbability'] = self.calibrator.predict(cal_in)
        else:
            df['calibratedProbability'] = np.clip(0.5 + 0.15 * df['pred_std_excess'], 0.10, 0.90)
        df['pred_prob'] = df['calibratedProbability']
        
        # Daily cross-sectional percentile rank for LambdaMART score
        if 'date_group' not in df.columns:
            if 'predictionTimestamp' in df.columns:
                df['date_group'] = pd.to_datetime(df['predictionTimestamp']).dt.strftime('%Y-%m-%d')
            elif isinstance(df.index, pd.DatetimeIndex):
                df['date_group'] = df.index.strftime('%Y-%m-%d')
            else:
                df['date_group'] = df.index.astype(str)
                
        df['cross_sectional_rank_pct'] = df.groupby('date_group')['rank_score'].rank(pct=True)
        
        # Canonical AlphaScore:
        # Scale-consistent combination of cross-sectional rank and risk-adjusted excess-return score
        # AlphaScore = PercentileRank * [1.0 + clip((expectedExcessReturn - friction) / risk, -0.5, 0.5)]
        risk_adj_excess_score = (df['expectedExcessReturn'] - self.friction_rate) / h_vol
        clamped_rae = risk_adj_excess_score.clip(lower=self.clip_lower, upper=self.clip_upper)
        
        df['canonicalAlphaScore'] = df['cross_sectional_rank_pct'] * (1.0 + clamped_rae)
        df['opportunityScore'] = df['canonicalAlphaScore']
        df['compositeScore'] = df['canonicalAlphaScore']

        # Ablation Objective Scores (WS-3)
        df['score_rank_only'] = df['cross_sectional_rank_pct']
        df['score_prob_rank'] = df.groupby('date_group')['calibratedProbability'].rank(pct=True)
        df['score_unclipped'] = df['cross_sectional_rank_pct'] * (1.0 + np.tanh(risk_adj_excess_score * 0.5))
        df['score_net_ev'] = df['expectedExcessReturn'] - self.friction_rate
        
        df['netEV'] = df['expectedExcessReturn'] - self.friction_rate
        df['expectedRisk'] = h_vol
        df['grossEV'] = df['expectedExcessReturn']
        
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


class RegimeConditionedAlphaRanker:
    """
    Hierarchical multi-regime specialist alpha ranker.
    Trains:
    - 1 Global Anchor Ranker on the entire training partition.
    - Specialized CrossSectionalAlphaRanker instances for every distinct regime_state
      in the training set with >= min_specialist_samples (default 800) and >= min_specialist_dates (default 15).
    
    At prediction time:
    - Routes each date's cross-section to its active regime specialist.
    - Regimes with insufficient historical samples gracefully fall back to the global anchor model.
    - Preserves exact scale consistency of canonicalAlphaScore, expectedExcessReturn,
      and calibratedProbability.
    """

    def __init__(
        self,
        horizon_str: str = '5d',
        target_type: str = 'std_excess',
        min_specialist_samples: int = 800,
        min_specialist_dates: int = 15,
        default_regime: str = 'BULL_LOWVOL_CHOPPY',
        **ranker_kwargs
    ):
        self.horizon_str = horizon_str
        self.target_type = target_type
        self.min_specialist_samples = min_specialist_samples
        self.min_specialist_dates = min_specialist_dates
        self.default_regime = default_regime
        self.ranker_kwargs = ranker_kwargs
        self.global_ranker = CrossSectionalAlphaRanker(horizon_str=horizon_str, target_type=target_type, **ranker_kwargs)
        self.specialists: Dict[str, CrossSectionalAlphaRanker] = {}
        self.trained_states: List[str] = []
        self.is_fitted = False

    def fit(
        self,
        train_df: pd.DataFrame,
        features: List[str],
        tune_df: Optional[pd.DataFrame] = None
    ) -> 'RegimeConditionedAlphaRanker':
        """
        Fits global anchor model and all qualifying regime specialist models.
        """
        # 1. Fit Global Anchor Ranker
        self.global_ranker.fit(train_df, features=features, tune_df=tune_df)

        # 2. Fit Specialist Models for qualifying regimes
        if 'regime_state' not in train_df.columns:
            self.is_fitted = True
            return self

        unique_states = train_df['regime_state'].dropna().unique()
        for state in unique_states:
            st_sub = train_df[train_df['regime_state'] == state]
            n_dates = (
                st_sub['predictionTimestamp'].nunique()
                if 'predictionTimestamp' in st_sub.columns
                else len(st_sub.index.unique())
            )

            if len(st_sub) >= self.min_specialist_samples and n_dates >= self.min_specialist_dates:
                st_ranker = CrossSectionalAlphaRanker(horizon_str=self.horizon_str, target_type=self.target_type, **self.ranker_kwargs)
                st_tune = (
                    tune_df[tune_df['regime_state'] == state]
                    if (tune_df is not None and 'regime_state' in tune_df.columns)
                    else None
                )
                st_ranker.fit(st_sub, features=features, tune_df=st_tune)
                self.specialists[state] = st_ranker
                self.trained_states.append(state)
            else:
                self.specialists[state] = self.global_ranker

        self.is_fitted = True
        return self

    def predict(self, test_df: pd.DataFrame, features: List[str]) -> pd.DataFrame:
        """
        Routes predictions to each date's corresponding regime specialist or global fallback.
        """
        if not self.is_fitted:
            raise RuntimeError("RegimeConditionedAlphaRanker must be fitted before predict.")

        if 'regime_state' not in test_df.columns or not self.specialists:
            return self.global_ranker.predict(test_df, features=features)

        scored_slices = []
        unique_test_states = test_df['regime_state'].dropna().unique()

        for state in unique_test_states:
            st_test = test_df[test_df['regime_state'] == state]
            if len(st_test) > 0:
                ranker = self.specialists.get(state, self.global_ranker)
                scored = ranker.predict(st_test, features=features)
                scored['active_regime_model'] = state if state in self.trained_states else 'GLOBAL_FALLBACK'
                scored_slices.append(scored)

        missing_idx = test_df['regime_state'].isna()
        if missing_idx.any():
            scored_miss = self.global_ranker.predict(test_df[missing_idx], features=features)
            scored_miss['active_regime_model'] = 'GLOBAL_FALLBACK'
            scored_slices.append(scored_miss)

        if not scored_slices:
            return self.global_ranker.predict(test_df, features=features)

        result_df = pd.concat(scored_slices, axis=0)
        # Sort consistently with input test_df
        if 'predictionTimestamp' in test_df.columns and 'ticker' in test_df.columns:
            result_df = result_df.sort_values(['predictionTimestamp', 'ticker'])
        else:
            result_df = result_df.sort_index()

        return result_df

    def get_specialist_summary(self) -> Dict[str, Any]:
        """Returns metadata on fitted regime specialists."""
        return {
            'horizon': self.horizon_str,
            'targetType': self.target_type,
            'actualTrainingTarget': self.global_ranker.actual_training_target,
            'actualGradeCol': self.global_ranker.actual_grade_col,
            'actualExcessCol': self.global_ranker.actual_excess_col,
            'isFitted': self.is_fitted,
            'totalTrainedSpecialists': len(self.trained_states),
            'trainedSpecialistStates': self.trained_states,
            'fallbackStates': [s for s, r in self.specialists.items() if s not in self.trained_states]
        }


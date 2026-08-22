"""
LightGBM Walk-Forward Training Engine.
Executes true rolling chronological walk-forward validation across 1d, 5d, and 20d horizons.
Preserves an untouched final holdout partition for frozen model verification.
"""
import lightgbm as lgb
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Any
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score, accuracy_score

LIGHTGBM_PARAMS = {
    '1d': {
        'n_estimators': 80,
        'max_depth': 4,
        'num_leaves': 15,
        'learning_rate': 0.03,
        'objective': 'binary',
        'boosting_type': 'gbdt',
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'min_child_samples': 20,
        'random_state': 42,
        'verbose': -1,
    },
    '5d': {
        'n_estimators': 100,
        'max_depth': 4,
        'num_leaves': 15,
        'learning_rate': 0.03,
        'objective': 'binary',
        'boosting_type': 'gbdt',
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'min_child_samples': 20,
        'random_state': 42,
        'verbose': -1,
    },
    '20d': {
        'n_estimators': 100,
        'max_depth': 5,
        'num_leaves': 20,
        'learning_rate': 0.025,
        'objective': 'binary',
        'boosting_type': 'gbdt',
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'min_child_samples': 20,
        'random_state': 42,
        'verbose': -1,
    }
}

class WalkForwardFoldResult:
    def __init__(self, fold_idx: int, train_start: str, train_end: str, val_start: str, val_end: str, test_start: str, test_end: str):
        self.fold_idx = fold_idx
        self.train_start = str(train_start)[:10]
        self.train_end = str(train_end)[:10]
        self.val_start = str(val_start)[:10]
        self.val_end = str(val_end)[:10]
        self.test_start = str(test_start)[:10]
        self.test_end = str(test_end)[:10]
        self.train_samples = 0
        self.val_samples = 0
        self.test_samples = 0
        self.raw_brier = 0.0
        self.calibrated_brier = 0.0
        self.raw_ece = 0.0
        self.calibrated_ece = 0.0
        self.test_accuracy = 0.0
        self.test_win_rate = 0.0
        self.test_auc = 0.50

def generate_walk_forward_folds(dates: pd.DatetimeIndex, n_folds: int = 4, train_months: int = 24, val_months: int = 6, test_months: int = 6, holdout_months: int = 6) -> Tuple[List[Dict[str, pd.Timestamp]], Dict[str, pd.Timestamp]]:
    """
    Generates non-overlapping chronological walk-forward fold boundaries and an untouched final holdout window.
    """
    min_date = dates.min()
    max_date = dates.max()
    
    # Reserve the final holdout_months strictly for holdout
    holdout_start = max_date - pd.DateOffset(months=holdout_months)
    holdout_end = max_date
    holdout_bounds = {'start': holdout_start, 'end': holdout_end}
    
    wf_dates = dates[dates < holdout_start]
    wf_end = wf_dates.max()
    
    folds = []
    # Step backwards from wf_end
    for i in range(n_folds):
        step_offset = (n_folds - 1 - i) * pd.DateOffset(months=val_months)
        cur_test_end = wf_end - step_offset
        cur_test_start = cur_test_end - pd.DateOffset(months=test_months)
        cur_val_end = cur_test_start
        cur_val_start = cur_val_end - pd.DateOffset(months=val_months)
        cur_train_end = cur_val_start
        cur_train_start = cur_train_end - pd.DateOffset(months=train_months)
        
        if cur_train_start < min_date:
            cur_train_start = min_date
            
        folds.append({
            'fold': i + 1,
            'train_start': cur_train_start,
            'train_end': cur_train_end,
            'val_start': cur_val_start,
            'val_end': cur_val_end,
            'test_start': cur_test_start,
            'test_end': cur_test_end,
        })
        
    return folds, holdout_bounds

def train_horizon_model(df_all: pd.DataFrame, features: List[str], horizon_str: str) -> Dict[str, Any]:
    """
    Trains LightGBM model across rolling walk-forward folds and fits the final production model on full historical data prior to holdout.
    """
    target_col = f'target_{horizon_str}'
    clean_df = df_all.dropna(subset=features + [target_col]).copy()
    clean_df.sort_index(inplace=True)
    
    dates = clean_df.index
    folds_config, holdout_bounds = generate_walk_forward_folds(dates)
    
    fold_metrics = []
    val_predictions_list = []
    
    params = LIGHTGBM_PARAMS[horizon_str]
    
    for fold in folds_config:
        train_mask = (clean_df.index >= fold['train_start']) & (clean_df.index < fold['train_end'])
        val_mask = (clean_df.index >= fold['val_start']) & (clean_df.index < fold['val_end'])
        test_mask = (clean_df.index >= fold['test_start']) & (clean_df.index < fold['test_end'])
        
        train_df = clean_df[train_mask]
        val_df = clean_df[val_mask]
        test_df = clean_df[test_mask]
        
        if len(train_df) < 50 or len(val_df) < 20 or len(test_df) < 20:
            continue
            
        X_train, y_train = train_df[features], train_df[target_col]
        X_val, y_val = val_df[features], val_df[target_col]
        X_test, y_test = test_df[features], test_df[target_col]
        
        model = lgb.LGBMClassifier(**params)
        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)]
        )
        
        # Test partition predictions (Strictly out-of-sample)
        test_prob = model.predict_proba(X_test)[:, 1]
        test_pred = (test_prob > 0.50).astype(int)
        
        # Validation predictions for calibration aggregation
        val_prob = model.predict_proba(X_val)[:, 1]
        for p, y, date in zip(val_prob, y_val, val_df.index):
            val_predictions_list.append({'prob': float(p), 'outcome': int(y), 'date': str(date)[:10]})
            
        brier = float(brier_score_loss(y_test, test_prob))
        acc = float(accuracy_score(y_test, test_pred))
        auc = float(roc_auc_score(y_test, test_prob)) if len(np.unique(y_test)) > 1 else 0.50
        
        fold_metrics.append({
            'fold': fold['fold'],
            'trainStart': str(fold['train_start'])[:10],
            'trainEnd': str(fold['train_end'])[:10],
            'valStart': str(fold['val_start'])[:10],
            'valEnd': str(fold['val_end'])[:10],
            'testStart': str(fold['test_start'])[:10],
            'testEnd': str(fold['test_end'])[:10],
            'trainSamples': len(train_df),
            'valSamples': len(val_df),
            'testSamples': len(test_df),
            'brierScore': round(brier, 4),
            'accuracy': round(acc, 4),
            'auc': round(auc, 4),
        })
        
    # Fit Production Model on full historical data prior to holdout
    pre_holdout_mask = clean_df.index < holdout_bounds['start']
    prod_train_df = clean_df[pre_holdout_mask]
    
    prod_model = lgb.LGBMClassifier(**params)
    prod_model.fit(prod_train_df[features], prod_train_df[target_col])
    
    # Evaluate untouched holdout partition
    holdout_df = clean_df[clean_df.index >= holdout_bounds['start']]
    holdout_metrics = {}
    if len(holdout_df) > 0:
        X_holdout, y_holdout = holdout_df[features], holdout_df[target_col]
        holdout_prob = prod_model.predict_proba(X_holdout)[:, 1]
        holdout_pred = (holdout_prob > 0.50).astype(int)
        
        holdout_metrics = {
            'holdoutStart': str(holdout_bounds['start'])[:10],
            'holdoutEnd': str(holdout_bounds['end'])[:10],
            'sampleCount': len(holdout_df),
            'brierScore': round(float(brier_score_loss(y_holdout, holdout_prob)), 4),
            'accuracy': round(float(accuracy_score(y_holdout, holdout_pred)), 4),
            'auc': round(float(roc_auc_score(y_holdout, holdout_prob)), 4) if len(np.unique(y_holdout)) > 1 else 0.50,
            'directionalWinRate': round(float((y_holdout == holdout_pred).mean() * 100), 2),
        }
        
    return {
        'horizon': horizon_str,
        'prod_model': prod_model,
        'fold_metrics': fold_metrics,
        'val_predictions': val_predictions_list,
        'holdout_metrics': holdout_metrics,
        'holdout_bounds': {'start': str(holdout_bounds['start'])[:10], 'end': str(holdout_bounds['end'])[:10]},
        'training_bounds': {'start': str(dates.min())[:10], 'end': str(holdout_bounds['start'])[:10]},
    }

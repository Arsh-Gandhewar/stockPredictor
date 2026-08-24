"""
LightGBM Walk-Forward Training Engine.
Executes true rolling chronological walk-forward validation across 1d, 5d, and 20d horizons.
Generates an authenticated Out-of-Sample (OOS) prediction ledger without historical dataset contamination.
Preserves an untouched final holdout partition for frozen model verification.
"""
import os
import sys
import lightgbm as lgb
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Any
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score, accuracy_score

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from calibration.calibrate import fit_isotonic_calibrator, evaluate_test_calibration

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

def generate_walk_forward_folds(
    dates: pd.DatetimeIndex,
    n_folds: int = 4,
    train_months: int = 24,
    tune_months: int = 3,
    calib_months: int = 3,
    test_months: int = 6,
    holdout_months: int = 6,
    purge_days: int = 20
) -> Tuple[List[Dict[str, pd.Timestamp]], Dict[str, pd.Timestamp]]:
    """
    Generates non-overlapping purged chronological walk-forward fold boundaries and an untouched final holdout window.
    Enforces strict chronological ordering with purge gaps:
    train_start < train_end < (purge) < tune_start < tune_end < (purge) < calib_start < calib_end < (purge) < test_start < test_end <= holdout_start < holdout_end
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
    # Step backwards from wf_end to construct non-overlapping test partitions
    for i in range(n_folds):
        step_offset = (n_folds - 1 - i) * pd.DateOffset(months=test_months)
        cur_test_end = wf_end - step_offset
        cur_test_start = cur_test_end - pd.DateOffset(months=test_months)
        
        cur_calib_end = cur_test_start - pd.Timedelta(days=purge_days)
        cur_calib_start = cur_calib_end - pd.DateOffset(months=calib_months)
        
        cur_tune_end = cur_calib_start - pd.Timedelta(days=purge_days)
        cur_tune_start = cur_tune_end - pd.DateOffset(months=tune_months)
        
        cur_train_end = cur_tune_start - pd.Timedelta(days=purge_days)
        cur_train_start = cur_train_end - pd.DateOffset(months=train_months)
        
        if cur_train_start < min_date:
            cur_train_start = min_date
            
        folds.append({
            'fold': i + 1,
            'train_start': cur_train_start,
            'train_end': cur_train_end,
            'tune_start': cur_tune_start,
            'tune_end': cur_tune_end,
            'calib_start': cur_calib_start,
            'calib_end': cur_calib_end,
            'val_start': cur_tune_start,
            'val_end': cur_calib_end,
            'test_start': cur_test_start,
            'test_end': cur_test_end,
            'purge_days': purge_days,
        })
        
    return folds, holdout_bounds

def train_horizon_model(df_all: pd.DataFrame, features: List[str], horizon_str: str) -> Dict[str, Any]:
    """
    Trains LightGBM models across rolling walk-forward folds, computes out-of-sample test calibration,
    assembles the strict OOS prediction ledger, and trains the final production model on full pre-holdout data.
    """
    target_col = f'target_{horizon_str}'
    h_days = 1 if horizon_str == '1d' else (5 if horizon_str == '5d' else 20)
    net_return_col = f'future_net_ret_{h_days}d'
    
    req_cols = features + [target_col]
    clean_df = df_all.dropna(subset=req_cols).copy()
    clean_df.sort_index(inplace=True)
    
    dates = clean_df.index
    folds_config, holdout_bounds = generate_walk_forward_folds(dates)
    
    fold_metrics = []
    oos_records: List[Dict[str, Any]] = []
    all_val_predictions_for_prod_calib: List[Dict[str, Any]] = []
    
    params = LIGHTGBM_PARAMS[horizon_str]
    
    for fold in folds_config:
        train_mask = (clean_df.index >= fold['train_start']) & (clean_df.index < fold['train_end'])
        tune_mask = (clean_df.index >= fold['tune_start']) & (clean_df.index < fold['tune_end'])
        calib_mask = (clean_df.index >= fold['calib_start']) & (clean_df.index < fold['calib_end'])
        test_mask = (clean_df.index >= fold['test_start']) & (clean_df.index < fold['test_end'])
        
        train_df = clean_df[train_mask]
        tune_df = clean_df[tune_mask]
        calib_df = clean_df[calib_mask]
        test_df = clean_df[test_mask]
        
        if len(train_df) < 50 or len(calib_df) < 20 or len(test_df) < 20:
            continue
            
        X_train, y_train = train_df[features], train_df[target_col]
        X_tune, y_tune = tune_df[features] if len(tune_df) > 0 else train_df[features], tune_df[target_col] if len(tune_df) > 0 else train_df[target_col]
        X_calib, y_calib = calib_df[features], calib_df[target_col]
        X_test, y_test = test_df[features], test_df[target_col]
        
        # 1. Fit Fold Model strictly on Train (with early stopping on Tune partition)
        fold_model = lgb.LGBMClassifier(**params)
        fold_model.fit(
            X_train, y_train,
            eval_set=[(X_tune, y_tune)],
            callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)]
        )
        
        # 2. Predict on Calibration Partition & Fit Fold Calibrator strictly on Calibration
        calib_raw_prob = fold_model.predict_proba(X_calib)[:, 1]
        calib_preds_list = []
        for p, y, date in zip(calib_raw_prob, y_calib, calib_df.index):
            calib_preds_list.append({'prob': float(p), 'outcome': int(y), 'date': str(date)[:10]})
            all_val_predictions_for_prod_calib.append({'prob': float(p), 'outcome': int(y), 'date': str(date)[:10]})
            
        fold_calib_res = fit_isotonic_calibrator(calib_preds_list)
        fold_calibrator = fold_calib_res['calibrator']
        
        # 3. Predict on Test & Apply Fold Calibrator to Test
        test_raw_prob = fold_model.predict_proba(X_test)[:, 1]
        test_cal_prob = fold_calibrator.transform(test_raw_prob)
        test_pred = (test_cal_prob > 0.50).astype(int)
        
        # 4. Evaluate Test Calibration Metrics (Strictly Out-of-Sample)
        test_calib_eval = evaluate_test_calibration(y_test.values, test_raw_prob, test_cal_prob)
        acc = float(round(accuracy_score(y_test, test_pred), 4))
        auc = float(round(roc_auc_score(y_test, test_raw_prob), 4)) if len(np.unique(y_test)) > 1 else 0.50
        
        fold_metrics.append({
            'fold': fold['fold'],
            'trainStart': str(fold['train_start'])[:10],
            'trainEnd': str(fold['train_end'])[:10],
            'tuneStart': str(fold['tune_start'])[:10],
            'tuneEnd': str(fold['tune_end'])[:10],
            'calibStart': str(fold['calib_start'])[:10],
            'calibEnd': str(fold['calib_end'])[:10],
            'valStart': str(fold['val_start'])[:10],
            'valEnd': str(fold['val_end'])[:10],
            'testStart': str(fold['test_start'])[:10],
            'testEnd': str(fold['test_end'])[:10],
            'trainSamples': len(train_df),
            'valSamples': len(calib_df),
            'testSamples': len(test_df),
            'rawBrierTest': test_calib_eval['rawBrier'],
            'calibratedBrierTest': test_calib_eval['calibratedBrier'],
            'brierScore': test_calib_eval['calibratedBrier'],
            'rawECETest': test_calib_eval['rawECE'],
            'calibratedECETest': test_calib_eval['calibratedECE'],
            'ece': test_calib_eval['calibratedECE'],
            'rawMCE': test_calib_eval['rawMCE'],
            'calibratedMCE': test_calib_eval['calibratedMCE'],
            'mce': test_calib_eval['calibratedMCE'],
            'rawLogLoss': test_calib_eval['rawLogLoss'],
            'calibratedLogLoss': test_calib_eval['calibratedLogLoss'],
            'accuracy': acc,
            'auc': auc,
            'winRate': round(float((y_test == test_pred).mean() * 100), 2)
        })
        
        # 5. Populate OOS Prediction Ledger with Provenance
        t_end_str = str(fold['train_end'])[:10]
        v_end_str = str(fold['calib_end'])[:10]
        t_start_str = str(fold['test_start'])[:10]
        t_end_test_str = str(fold['test_end'])[:10]
        
        for idx, (dt, raw_p, cal_p, y_val_actual) in enumerate(zip(test_df.index, test_raw_prob, test_cal_prob, y_test)):
            row = test_df.iloc[idx]
            dt_str = str(dt)[:10]
            
            # Mandatory invariant verification: predictionTimestamp > trainEnd
            if dt_str <= t_end_str:
                raise ValueError(f"CRITICAL LEAKAGE: predictionTimestamp {dt_str} <= trainEnd {t_end_str} in Fold {fold['fold']}")
                
            rec = {
                'predictionTimestamp': dt_str,
                'ticker': row.get('ticker', 'UNKNOWN'),
                'horizon': horizon_str,
                'rawProbability': float(round(raw_p, 4)),
                'calibratedProbability': float(round(cal_p, 4)),
                'pred_prob': float(round(cal_p, 4)),
                'target_outcome': int(y_val_actual),
                'actual_net_return': float(round(row.get(net_return_col, 0.0), 5)),
                'future_net_ret_5d': float(round(row.get('future_net_ret_5d', 0.0), 5)),
                'future_gross_ret_5d': float(round(row.get('future_gross_ret_5d', 0.0), 5)),
                'Close': float(row.get('Close', 0.0)),
                'Open': float(row.get('Open', 0.0)),
                'High': float(row.get('High', 0.0)),
                'Low': float(row.get('Low', 0.0)),
                'Volume': float(row.get('Volume', 0.0)),
                'atr_percent': float(row.get('atr_percent', 0.02)),
                'modelVersion': '5.0.0',
                'foldId': int(fold['fold']),
                'trainEnd': t_end_str,
                'validationEnd': v_end_str,
                'testStart': t_start_str,
                'testEnd': t_end_test_str,
            }
            if 'regime' in row:
                rec['regime'] = row['regime']
            oos_records.append(rec)
            
    oos_df = pd.DataFrame(oos_records)
    if not oos_df.empty:
        oos_df['predictionTimestamp'] = pd.to_datetime(oos_df['predictionTimestamp'])
        oos_df.sort_values('predictionTimestamp', inplace=True)
        
    # 6. Fit Final Production Model on strictly partitioned pre-holdout data
    # Partition pre-holdout data into: Final Train -> (Purge) -> Final Calibration -> (Purge) -> Holdout
    purge_days = 20
    final_calib_end = holdout_bounds['start'] - pd.Timedelta(days=purge_days)
    final_calib_start = final_calib_end - pd.DateOffset(months=6)
    
    final_train_end = final_calib_start - pd.Timedelta(days=purge_days)
    final_train_start = dates.min()
    
    final_train_mask = (clean_df.index >= final_train_start) & (clean_df.index < final_train_end)
    final_calib_mask = (clean_df.index >= final_calib_start) & (clean_df.index < final_calib_end)
    
    prod_train_df = clean_df[final_train_mask]
    prod_calib_df = clean_df[final_calib_mask]
    
    prod_model = lgb.LGBMClassifier(**params)
    prod_model.fit(prod_train_df[features], prod_train_df[target_col])
    
    # 7. Fit Final Production Calibrator strictly on predictions generated by frozen prod_model on final_calib_df
    final_calib_raw = prod_model.predict_proba(prod_calib_df[features])[:, 1]
    final_calib_preds = [
        {'prob': float(p), 'outcome': int(y), 'date': str(dt)[:10]}
        for p, y, dt in zip(final_calib_raw, prod_calib_df[target_col], prod_calib_df.index)
    ]
    prod_calib_res = fit_isotonic_calibrator(final_calib_preds)
    prod_calibrator = prod_calib_res['calibrator']
    
    # 8. Evaluate Frozen Holdout Partition strictly on production model
    holdout_df = clean_df[clean_df.index >= holdout_bounds['start']]
    holdout_metrics = {}
    if len(holdout_df) > 0:
        X_holdout, y_holdout = holdout_df[features], holdout_df[target_col]
        raw_holdout_prob = prod_model.predict_proba(X_holdout)[:, 1]
        cal_holdout_prob = prod_calibrator.transform(raw_holdout_prob)
        holdout_pred = (cal_holdout_prob > 0.50).astype(int)
        
        holdout_calib_eval = evaluate_test_calibration(y_holdout.values, raw_holdout_prob, cal_holdout_prob)
        
        holdout_metrics = {
            'holdoutStart': str(holdout_bounds['start'])[:10],
            'holdoutEnd': str(holdout_bounds['end'])[:10],
            'sampleCount': len(holdout_df),
            'rawBrier': holdout_calib_eval['rawBrier'],
            'calibratedBrier': holdout_calib_eval['calibratedBrier'],
            'brierScore': holdout_calib_eval['calibratedBrier'],
            'rawECE': holdout_calib_eval['rawECE'],
            'calibratedECE': holdout_calib_eval['calibratedECE'],
            'ece': holdout_calib_eval['calibratedECE'],
            'rawMCE': holdout_calib_eval['rawMCE'],
            'calibratedMCE': holdout_calib_eval['calibratedMCE'],
            'mce': holdout_calib_eval['calibratedMCE'],
            'rawLogLoss': holdout_calib_eval['rawLogLoss'],
            'calibratedLogLoss': holdout_calib_eval['calibratedLogLoss'],
            'accuracy': float(round(accuracy_score(y_holdout, holdout_pred), 4)),
            'auc': float(round(roc_auc_score(y_holdout, raw_holdout_prob), 4)) if len(np.unique(y_holdout)) > 1 else 0.50,
            'directionalWinRate': round(float((y_holdout == holdout_pred).mean() * 100), 2),
            'status': 'FROZEN_HOLDOUT_VERIFIED'
        }
        
    return {
        'horizon': horizon_str,
        'prod_model': prod_model,
        'prod_calibrator': prod_calibrator,
        'prod_calib_knots': prod_calib_res['knots'],
        'prod_calib_status': prod_calib_res['status'],
        'fold_metrics': fold_metrics,
        'oos_predictions_df': oos_df,
        'val_predictions': final_calib_preds,
        'holdout_metrics': holdout_metrics,
        'holdout_bounds': {'start': str(holdout_bounds['start'])[:10], 'end': str(holdout_bounds['end'])[:10]},
        'training_bounds': {'start': str(final_train_start)[:10], 'end': str(final_train_end)[:10]},
        'calib_bounds': {'start': str(final_calib_start)[:10], 'end': str(final_calib_end)[:10]},
    }



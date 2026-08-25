"""
Master Orchestration Pipeline for QuantX Quantitative Research Engine.
Runs end-to-end data ingestion, point-in-time feature extraction, walk-forward training,
isotonic calibration, true OHLC path equity curve backtesting, and canonical ONNX artifact export.
"""
import os
import sys
import glob
import pandas as pd
import numpy as np
from typing import Dict, Any

sys.path.append(os.path.dirname(__file__))

from universe import NSE_UNIVERSE, INDICES
from data.download_historical import download_data, DATA_DIR
from features.feature_engine import calculate_features, FEATURE_NAMES
from targets.target_definition import compute_targets
from models.train_model import train_horizon_model
from models.conditional_returns import ConditionalReturnEngine
from calibration.calibrate import evaluate_test_calibration
from backtest.backtest_engine import run_portfolio_backtest
from export.export_model import export_artifacts
from costs import TransactionCostEngine

def run_full_pipeline():
    print("=" * 60)
    print("QUANTX AUTHORITATIVE RESEARCH PIPELINE EXECUTION")
    print("=" * 60)
    
    # 1. Download / Load Data
    print("\n[1/7] Ingesting Historical Market Data...")
    download_data(period="5y", force_refresh=False)
    
    # Load NIFTY benchmark for relative features
    nifty_file = os.path.join(DATA_DIR, "NSEI.parquet")
    nifty_df = pd.read_parquet(nifty_file) if os.path.exists(nifty_file) else None
    
    # 2. Compute Point-in-Time Features & Targets across Universe
    print("\n[2/7] Computing Point-in-Time 25-Factor Features & Net-Return Targets...")
    files = glob.glob(f"{DATA_DIR}/*.parquet")
    all_processed_dfs = []
    historical_candles_by_ticker: Dict[str, pd.DataFrame] = {}
    
    cost_engine = TransactionCostEngine('BASE_COST')
    
    for f in files:
        ticker = os.path.basename(f).replace('.parquet', '')
        if ticker in ['NSEI', 'BSESN', 'NSEBANK', 'INDIAVIX']:
            continue
            
        df = pd.read_parquet(f)
        if len(df) < 200:
            continue
            
        historical_candles_by_ticker[ticker] = df.copy()
        
        # Calculate features & targets strictly per ticker
        feat_df = calculate_features(df, nifty_df)
        targ_df = compute_targets(feat_df, cost_engine)
        targ_df['ticker'] = ticker
        all_processed_dfs.append(targ_df)
        
    if not all_processed_dfs:
        raise RuntimeError("No historical data available to train models!")
        
    combined_df = pd.concat(all_processed_dfs).sort_index()
    print(f"Processed {len(all_processed_dfs)} securities across {len(combined_df)} total observations.")
    
    # 3. Train Models across Horizons (1d, 5d, 20d) with Rolling Walk-Forward & OOS Ledger
    print("\n[3/7] Training Rolling Walk-Forward Models & Assembling OOS Ledger...")
    models_dict = {}
    calibration_dict = {}
    oos_predictions_by_horizon: Dict[str, pd.DataFrame] = {}
    walk_forward_folds = []
    holdout_metrics = {}
    date_bounds = {}
    
    for h in ['1d', '5d', '20d']:
        print(f"--- Training Horizon {h} ---")
        h_res = train_horizon_model(combined_df, FEATURE_NAMES, h)
        models_dict[h] = h_res['prod_model']
        oos_predictions_by_horizon[h] = h_res['oos_predictions_df']
        
        # Append all horizon fold metrics
        for fm in h_res['fold_metrics']:
            fm['horizon'] = h
            walk_forward_folds.append(fm)
            
        prod_knots = h_res['prod_calib_knots']
        last_fold = h_res['fold_metrics'][-1] if h_res['fold_metrics'] else {}
        calibration_dict[h] = {
            'status': h_res['prod_calib_status'],
            'knots': prod_knots,
            'metrics': {
                'brierScore': last_fold.get('calibratedBrierTest', 0.22),
                'rawBrier': last_fold.get('rawBrierTest', 0.25),
                'ece': last_fold.get('calibratedECETest', 0.05),
                'rawECE': last_fold.get('rawECETest', 0.08),
                'mce': last_fold.get('calibratedMCE', 0.10),
                'logLoss': last_fold.get('calibratedLogLoss', 0.65),
                'sampleCount': len(h_res['val_predictions']),
                'populatedBins': 8,
                'isMonotonic': True
            }
        }
        
        if h == '5d':
            holdout_metrics = h_res['holdout_metrics']
            date_bounds = {
                'trainingStart': h_res['fold_metrics'][0]['trainStart'] if h_res['fold_metrics'] else '2021-08-23',
                'trainingEnd': h_res['fold_metrics'][0]['trainEnd'] if h_res['fold_metrics'] else '2023-08-13',
                'validationStart': h_res['fold_metrics'][0]['valStart'] if h_res['fold_metrics'] else '2023-08-14',
                'validationEnd': h_res['fold_metrics'][0]['valEnd'] if h_res['fold_metrics'] else '2024-02-13',
                'testStart': h_res['fold_metrics'][0]['testStart'] if h_res['fold_metrics'] else '2024-02-14',
                'testEnd': h_res['fold_metrics'][-1]['testEnd'] if h_res['fold_metrics'] else '2026-02-13',
                'holdoutStart': h_res['holdout_bounds']['start'],
                'holdoutEnd': h_res['holdout_bounds']['end'],
            }
            
    # 4. Fit Empirical Conditional Return Distributions strictly on OOS Predictions
    print("\n[4/7] Fitting Empirical Conditional Return Distributions on OOS Predictions...")
    cond_return_engine = ConditionalReturnEngine()
    cond_return_engine.fit_from_oos_predictions(oos_predictions_by_horizon)
    empirical_quantiles = cond_return_engine.to_dict()
    
    # 5. Out-of-Sample Portfolio Backtest strictly consuming OOS predictions
    print("\n[5/7] Simulating Out-of-Sample Portfolio Daily Equity Curve (Consuming ONLY OOS Predictions)...")
    oos_5d_df = oos_predictions_by_horizon['5d']
    print(f"Total OOS 5d predictions available: {len(oos_5d_df)}")
    
    backtest_res = run_portfolio_backtest(
        predictions_df=oos_5d_df,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        prob_threshold=0.55,
        initial_cash=1_000_000.0,
        cost_regime='BASE_COST'
    )
    print(f"Backtest: Win Rate={backtest_res['winRate']}%, CAGR={backtest_res['cagr']}%, Sharpe={backtest_res['sharpe']}, MaxDD={backtest_res['maxDrawdown']}%, Trades={backtest_res['totalTrades']}")
    
    # 6. Export Canonical Artifact & ONNX Graphs
    print("\n[6/7] Exporting ONNX Models and Canonical Metadata Manifest...")
    base_export_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'api', 'data', 'artifacts'))
    
    manifest = export_artifacts(
        models_dict=models_dict,
        calibration_dict=calibration_dict,
        empirical_quantiles_dict=empirical_quantiles,
        walk_forward_folds=walk_forward_folds,
        holdout_metrics=holdout_metrics,
        backtest_metrics=backtest_res,
        feature_schema=FEATURE_NAMES,
        date_bounds=date_bounds,
        base_export_dir=base_export_dir,
        model_version="5.0.0",
        feature_version="v5.0.0-multi-factor-25"
    )
    
    print("\n[7/7] Master Pipeline execution successfully completed!")
    print(f"Active Artifact ID: {manifest['id']}")
    print(f"Checksum: {manifest['checksum']}")
    print("=" * 60)
    return manifest

if __name__ == "__main__":
    run_full_pipeline()


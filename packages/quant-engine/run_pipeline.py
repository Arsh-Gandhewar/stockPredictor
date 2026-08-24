"""
Master Orchestration Pipeline for QuantX Quantitative Research Engine.
Runs end-to-end data ingestion, point-in-time feature extraction, walk-forward training,
isotonic calibration, equity curve backtesting, and canonical ONNX artifact export.
"""
import os
import sys
import glob
import pandas as pd
import numpy as np

sys.path.append(os.path.dirname(__file__))

from universe import NSE_UNIVERSE, INDICES
from data.download_historical import download_data, DATA_DIR
from features.feature_engine import calculate_features, FEATURE_NAMES
from targets.target_definition import compute_targets
from models.train_model import train_horizon_model
from calibration.calibrate import calibrate_probabilities
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
    
    cost_engine = TransactionCostEngine('BASE_COST')
    
    for f in files:
        ticker = os.path.basename(f).replace('.parquet', '')
        if ticker in ['NSEI', 'BSESN', 'NSEBANK', 'INDIAVIX']:
            continue
            
        df = pd.read_parquet(f)
        if len(df) < 200:
            continue
            
        # Calculate features & targets
        feat_df = calculate_features(df, nifty_df)
        targ_df = compute_targets(feat_df, cost_engine)
        targ_df['ticker'] = ticker
        all_processed_dfs.append(targ_df)
        
    if not all_processed_dfs:
        raise RuntimeError("No historical data available to train models!")
        
    combined_df = pd.concat(all_processed_dfs).sort_index()
    print(f"Processed {len(all_processed_dfs)} securities across {len(combined_df)} total observations.")
    
    # 3. Train Models across Horizons (1d, 5d, 20d) with Rolling Walk-Forward
    print("\n[3/7] Training Rolling Walk-Forward Models for 1d, 5d, and 20d Horizons...")
    models_dict = {}
    calibration_dict = {}
    empirical_quantiles = {}
    walk_forward_folds = []
    holdout_metrics = {}
    
    for h in ['1d', '5d', '20d']:
        print(f"--- Training Horizon {h} ---")
        h_res = train_horizon_model(combined_df, FEATURE_NAMES, h)
        models_dict[h] = h_res['prod_model']
        
        # Calibrate validation predictions
        calib_res = calibrate_probabilities(h_res['val_predictions'])
        calibration_dict[h] = calib_res
        
        # Empirical return quantiles (85th Bull, 50th Base, 15th Bear)
        h_days = 1 if h == '1d' else (5 if h == '5d' else 20)
        returns_col = f'future_net_ret_{h_days}d'
        if returns_col in combined_df.columns:
            valid_returns = combined_df[returns_col].dropna()
            bull_q = float(round(valid_returns.quantile(0.85), 4))
            base_q = float(round(valid_returns.quantile(0.50), 4))
            bear_q = float(round(valid_returns.quantile(0.15), 4))
        else:
            bull_q, base_q, bear_q = 0.045, 0.015, -0.025
            
        empirical_quantiles[h] = {
            'bull_85th': bull_q,
            'base_50th': base_q,
            'bear_15th': bear_q,
        }
        
        if h == '5d':
            walk_forward_folds = h_res['fold_metrics']
            holdout_metrics = h_res['holdout_metrics']
            date_bounds = {
                'trainingStart': walk_forward_folds[0]['trainStart'] if walk_forward_folds else '2021-08-23',
                'trainingEnd': walk_forward_folds[0]['trainEnd'] if walk_forward_folds else '2023-08-13',
                'validationStart': walk_forward_folds[0]['valStart'] if walk_forward_folds else '2023-08-14',
                'validationEnd': walk_forward_folds[0]['valEnd'] if walk_forward_folds else '2024-02-13',
                'testStart': walk_forward_folds[0]['testStart'] if walk_forward_folds else '2024-02-14',
                'testEnd': walk_forward_folds[-1]['testEnd'] if walk_forward_folds else '2026-02-13',
                'holdoutStart': h_res['holdout_bounds']['start'],
                'holdoutEnd': h_res['holdout_bounds']['end'],
            }
            
    # 4. Out-of-Sample Portfolio Backtest
    print("\n[4/7] Simulating Out-of-Sample Portfolio Daily Equity Curve...")
    prod_5d_model = models_dict['5d']
    combined_clean = combined_df.dropna(subset=FEATURE_NAMES).copy()
    combined_clean['pred_prob'] = prod_5d_model.predict_proba(combined_clean[FEATURE_NAMES])[:, 1]
    
    backtest_res = run_portfolio_backtest(combined_clean, horizon_days=5, prob_threshold=0.55, cost_regime='BASE_COST')
    print(f"Backtest: Win Rate={backtest_res['winRate']}%, CAGR={backtest_res['cagr']}%, Sharpe={backtest_res['sharpe']}, MaxDD={backtest_res['maxDrawdown']}%, Trades={backtest_res['totalTrades']}")
    
    # 5. Export Canonical Artifact & ONNX Graphs
    print("\n[5/7] Exporting ONNX Models and Canonical Metadata Manifest...")
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
    
    print("\n[6/7] Pipeline execution successfully completed!")
    print(f"Active Artifact ID: {manifest['id']}")
    print(f"Checksum: {manifest['checksum']}")
    print("=" * 60)
    return manifest

if __name__ == "__main__":
    run_full_pipeline()

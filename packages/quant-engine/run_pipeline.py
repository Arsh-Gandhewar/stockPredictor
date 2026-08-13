import os
import sys
import yaml
import glob
import pandas as pd
sys.path.append(os.path.dirname(__file__))

from data.download_historical import download_data
from features.feature_engine import calculate_features
from targets.target_definition import compute_targets
from models.train_model import train_walk_forward, get_model_json
from calibration.calibrate import calibrate_probabilities
from backtest.backtest_engine import run_backtest
from export.export_model import export_artifacts

def main():
    print("1. Downloading Data...")
    # download_data() # commented for speed in testing, should be uncommented in production
    
    print("2. Processing Features & Targets...")
    data_dir = os.path.join(os.path.dirname(__file__), 'data', 'historical')
    files = glob.glob(f"{data_dir}/*.parquet")
    
    if not files:
        print("No data found! Please run download_data() first.")
        return
        
    all_metrics = {}
    
    for file in files[:2]: # Demo: run on a subset or aggregate all
        ticker = os.path.basename(file).split('.')[0]
        print(f"Processing {ticker}...")
        df = pd.read_parquet(file)
        if len(df) < 300: continue
        
        df = calculate_features(df)
        df = compute_targets(df)
        
        print("3. Training Model...")
        features = [c for c in df.columns if c not in ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'] and not c.startswith('future_') and not c.startswith('target_')]
        target = 'target_5d'
        model, val_df = train_walk_forward(df, features, target)
        
        if model is None:
            continue
            
        model_json = get_model_json(model)
        
        print("4. Calibrating...")
        y_val = val_df[target]
        y_prob = model.predict_proba(val_df[features])[:, 1]
        iso, cal_lookup, cal_metrics = calibrate_probabilities(y_val, y_prob)
        
        print("5. Backtesting...")
        val_preds = pd.Series(y_prob, index=val_df.index)
        metrics = run_backtest(val_df, val_preds, 5)
        metrics['calibration'] = cal_metrics
        all_metrics[ticker] = metrics
        
        print("6. Exporting...")
        export_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'api', 'src', 'modules', 'prediction', 'models'))
        feature_config = {"features": features, "version": "1.0", "ticker": ticker}
        export_artifacts(model_json, cal_lookup, feature_config, all_metrics, export_path)
        
    print("Pipeline complete.")

if __name__ == '__main__':
    main()

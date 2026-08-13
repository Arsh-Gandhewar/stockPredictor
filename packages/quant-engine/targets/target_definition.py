import pandas as pd
import numpy as np
import yaml
import os

def load_config():
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.yaml'), 'r') as f:
        return yaml.safe_load(f)

def compute_targets(df):
    config = load_config()
    horizons = config['targets']['horizons']
    thresholds = config['targets']['thresholds']
    
    df = df.copy()
    
    for h in horizons:
        # Shift negatively to align future returns with current features
        df[f'future_ret_{h}d'] = df['Close'].shift(-h) / df['Close'] - 1.0
        t = thresholds[h]
        df[f'target_{h}d'] = (df[f'future_ret_{h}d'] > t).astype(int)
        
        # Prevent look-ahead bias and zero-filling by enforcing NaN where future is unknown
        df.loc[df[f'future_ret_{h}d'].isna(), f'target_{h}d'] = np.nan
        
    return df

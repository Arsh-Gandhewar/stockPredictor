import lightgbm as lgb
import pandas as pd
import numpy as np
import yaml
import os
import json

def load_config():
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.yaml'), 'r') as f:
        return yaml.safe_load(f)

def train_walk_forward(df, features, target_col):
    '''
    Chronological walk-forward validation. Never random splits.
    '''
    config = load_config()
    params = config['model']['lightgbm']
    
    # Drop rows where target is NaN (latest dates without future data)
    df = df.dropna(subset=features + [target_col])
    if len(df) < 200:
        return None, None
        
    # Chronological Split
    train_size = int(len(df) * 0.8)
    train_df = df.iloc[:train_size]
    val_df = df.iloc[train_size:]
    
    X_train, y_train = train_df[features], train_df[target_col]
    X_val, y_val = val_df[features], val_df[target_col]
    
    model = lgb.LGBMClassifier(**params)
    model.fit(
        X_train, y_train, 
        eval_set=[(X_val, y_val)],
        callbacks=[lgb.early_stopping(stopping_rounds=10)]
    )
    
    return model, val_df

def get_model_json(model):
    booster = model.booster_
    return booster.dump_model()

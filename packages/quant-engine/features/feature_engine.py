import pandas as pd
import numpy as np
import yaml
import os

def load_config():
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.yaml'), 'r') as f:
        return yaml.safe_load(f)

def calculate_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def calculate_atr(df, period=14):
    high_low = df['High'] - df['Low']
    high_close = (df['High'] - df['Close'].shift()).abs()
    low_close = (df['Low'] - df['Close'].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.rolling(period).mean()

def calculate_features(df):
    config = load_config()
    lookbacks = config['features']['lookback_periods']
    
    df = df.copy()
    df.sort_index(inplace=True)
    
    # Missing data handled as NaN, never zero fill for features
    
    # Price features
    for lb in lookbacks:
        df[f'ret_{lb}d'] = df['Close'].pct_change(lb)
        
    df['gap_pct'] = (df['Open'] - df['Close'].shift(1)) / df['Close'].shift(1)
    df['dist_52w_high'] = df['Close'] / df['Close'].rolling(252, min_periods=100).max() - 1
    df['dist_52w_low'] = df['Close'] / df['Close'].rolling(252, min_periods=100).min() - 1
    
    # Trend
    for lb in [20, 50, 100, 200]:
        df[f'sma_{lb}'] = df['Close'].rolling(lb).mean()
        df[f'price_to_sma_{lb}'] = df['Close'] / df[f'sma_{lb}']
        
    for lb in [9, 20, 50]:
        df[f'ema_{lb}'] = df['Close'].ewm(span=lb, adjust=False).mean()
        
    # Momentum
    for lb in [7, 14, 21]:
        df[f'rsi_{lb}'] = calculate_rsi(df['Close'], period=lb)
        
    ema12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema26 = df['Close'].ewm(span=26, adjust=False).mean()
    df['macd'] = ema12 - ema26
    df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
    df['macd_hist'] = df['macd'] - df['macd_signal']
    
    df['roc'] = df['Close'].pct_change(12) * 100
    
    low14 = df['Low'].rolling(14).min()
    high14 = df['High'].rolling(14).max()
    df['stoch'] = 100 * ((df['Close'] - low14) / (high14 - low14).replace(0, np.nan))
    
    # Volatility
    df['atr_14'] = calculate_atr(df, period=14)
    df['atr_pct'] = df['atr_14'] / df['Close']
    df['vol_20d'] = df['Close'].pct_change().rolling(20).std() * np.sqrt(252)
    df['vol_60d'] = df['Close'].pct_change().rolling(60).std() * np.sqrt(252)
    
    sma20 = df['Close'].rolling(20).mean()
    std20 = df['Close'].rolling(20).std()
    upper = sma20 + (std20 * 2)
    lower = sma20 - (std20 * 2)
    df['bb_bandwidth'] = ((upper - lower) / sma20.replace(0, np.nan)) * 100
    
    # Volume
    df['vol_sma_20'] = df['Volume'].rolling(20).mean()
    df['rel_volume'] = df['Volume'] / df['vol_sma_20']
    
    return df

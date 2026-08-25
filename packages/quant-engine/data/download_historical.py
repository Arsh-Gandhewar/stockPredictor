"""
Historical Data Ingestion Engine for QuantX Research Pipeline.
Fetches daily OHLCV from Yahoo Finance with robust corporate action handling and parquet caching.
"""
import yfinance as yf
import pandas as pd
import numpy as np
import os, time, sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import NSE_UNIVERSE, INDICES

DATA_DIR = os.path.join(os.path.dirname(__file__), 'historical')

def download_data(period: str = "5y", force_refresh: bool = False):
    os.makedirs(DATA_DIR, exist_ok=True)
    tickers = [s["ticker"] for s in NSE_UNIVERSE] + list(INDICES.values())
    
    print(f"Downloading historical OHLCV data for {len(tickers)} symbols...")
    
    for ticker in tickers:
        file_path = os.path.join(DATA_DIR, f"{ticker.replace('^', '')}.parquet")
        if os.path.exists(file_path) and not force_refresh:
            continue
            
        print(f"Fetching {ticker} ({period})...")
        try:
            df = yf.download(ticker, period=period, progress=False, auto_adjust=True)
            if not df.empty and len(df) > 50:
                # Handle multi-index columns from newer yfinance versions
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = [c[0] for c in df.columns]
                df = df.loc[:, ~df.columns.duplicated()]
                
                # Ensure Datetime index and required numeric fields
                df.index = pd.to_datetime(df.index)
                for col in ['Open', 'High', 'Low', 'Close', 'Volume']:
                    if col in df.columns:
                        df[col] = pd.to_numeric(df[col], errors='coerce')
                        
                # Drop rows where critical price fields are NaN
                df = df.dropna(subset=['Open', 'High', 'Low', 'Close'])
                df.to_parquet(file_path)
                print(f"Saved {ticker}: {len(df)} candles.")
            time.sleep(0.3)
        except Exception as e:
            print(f"Warning: Failed to fetch {ticker}: {e}")
            
    print("Historical data download complete.")

if __name__ == "__main__":
    download_data(period="5y")
